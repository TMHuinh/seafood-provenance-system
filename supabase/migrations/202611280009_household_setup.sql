BEGIN;

CREATE FUNCTION public.org_household_setup_options(p_actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  WITH active_farmer AS (
    SELECT id,organization_id FROM public.user_profiles WHERE id=p_actor AND status AND role='FARMER'
  ), households AS (
    SELECT h.id,h.name,r.cooperative_id,c.name AS cooperative_name
    FROM public.organization_memberships m
    JOIN active_farmer u ON u.id=m.user_id
    JOIN public.organizations h ON h.id=m.organization_id AND h.type='FARMER_HOUSEHOLD' AND h.status
    LEFT JOIN public.cooperative_households r ON r.household_id=h.id AND r.ended_at IS NULL
    LEFT JOIN public.organizations c ON c.id=r.cooperative_id
    WHERE m.role='REPRESENTATIVE' AND tstzrange(m.starts_at,m.ends_at,'[)') @> statement_timestamp()
  ), farms AS (
    SELECT f.id,f.farm_name,f.address,(SELECT count(*) FROM public.ponds p WHERE p.farm_id=f.id) AS pond_count
    FROM public.farms f JOIN active_farmer u ON u.id=f.owner_id
    WHERE f.organization_id IS NULL
  )
  SELECT jsonb_build_object(
    'can_create',EXISTS(SELECT FROM active_farmer WHERE organization_id IS NULL) AND NOT EXISTS(SELECT FROM households),
    'households',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.name,h.id) FROM households h),'[]'::jsonb),
    'farms',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.farm_name,f.id) FROM farms f),'[]'::jsonb)
  );
$$;

CREATE FUNCTION public.org_link_owned_farms(p_actor uuid,p_org uuid,p_farm_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_before public.farms; v_after public.farms; v_seen integer:=0; v_linked integer:=0;
BEGIN
  IF p_farm_ids IS NULL OR array_position(p_farm_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Danh sách cơ sở không hợp lệ' USING ERRCODE='22023';
  END IF;
  FOR v_before IN SELECT f.* FROM public.farms f WHERE f.id=ANY(p_farm_ids) ORDER BY f.id FOR UPDATE
  LOOP
    IF v_before.owner_id<>p_actor OR (v_before.organization_id IS NOT NULL AND v_before.organization_id<>p_org) THEN
      RAISE EXCEPTION 'Có cơ sở không còn đủ điều kiện để gắn vào hộ' USING ERRCODE='PT404';
    END IF;
    v_seen:=v_seen+1;
    IF v_before.organization_id IS NULL THEN
      UPDATE public.farms SET organization_id=p_org WHERE id=v_before.id RETURNING * INTO v_after;
      PERFORM public.org_audit(p_actor,'farms',v_before.id,'UPDATE',to_jsonb(v_before),to_jsonb(v_after));
      v_linked:=v_linked+1;
    END IF;
  END LOOP;
  IF v_seen<>(SELECT count(DISTINCT farm_id) FROM unnest(p_farm_ids) farm_id) THEN
    RAISE EXCEPTION 'Có cơ sở không còn đủ điều kiện để gắn vào hộ' USING ERRCODE='PT404';
  END IF;
  RETURN v_linked;
END $$;

CREATE FUNCTION public.org_create_household_profile(
  p_actor uuid,p_request uuid,p_name text,p_address text,p_farm_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_actor public.user_profiles; v_household public.organizations;
  v_membership public.organization_memberships; v_request jsonb; v_previous jsonb; v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.user_profiles WHERE id=p_actor AND status AND role='FARMER' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chỉ tài khoản người nuôi được tạo hồ sơ hộ' USING ERRCODE='42501'; END IF;
  IF p_request IS NULL OR length(trim(coalesce(p_name,''))) NOT BETWEEN 1 AND 255
    OR length(p_address)>1000 OR p_farm_ids IS NULL OR array_position(p_farm_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Thông tin hộ hoặc danh sách cơ sở không hợp lệ' USING ERRCODE='22023';
  END IF;
  v_request:=jsonb_build_object('name',trim(p_name),'address',nullif(trim(p_address),''),
    'farm_ids',ARRAY(SELECT DISTINCT farm_id FROM unnest(p_farm_ids) farm_id ORDER BY farm_id));
  SELECT new_data INTO v_previous FROM public.audit_logs
    WHERE entity_type='household_setup' AND entity_id=p_request AND user_id=p_actor AND action='CREATE';
  IF FOUND THEN
    PERFORM public.org_require_manager(p_actor,p_request);
    IF v_previous->'request' = v_request THEN RETURN v_previous->'result'; END IF;
    RAISE EXCEPTION 'Yêu cầu đã lưu với thông tin khác. Hãy mở lại hồ sơ hộ' USING ERRCODE='PT409';
  END IF;
  IF v_actor.organization_id IS NOT NULL OR EXISTS(
    SELECT FROM public.organization_memberships m JOIN public.organizations h ON h.id=m.organization_id
    WHERE m.user_id=p_actor AND m.role='REPRESENTATIVE' AND h.type='FARMER_HOUSEHOLD' AND h.status
    AND tstzrange(m.starts_at,m.ends_at,'[)') @> clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Tài khoản đã có hồ sơ tổ chức. Hãy mở lại Tổ chức của tôi' USING ERRCODE='PT409';
  END IF;
  INSERT INTO public.organizations(id,name,type,address)
    VALUES(p_request,v_request->>'name','FARMER_HOUSEHOLD',v_request->>'address') RETURNING * INTO v_household;
  UPDATE public.user_profiles SET organization_id=v_household.id WHERE id=p_actor;
  INSERT INTO public.organization_memberships(user_id,organization_id,role,granted_by)
    VALUES(p_actor,v_household.id,'REPRESENTATIVE',p_actor) RETURNING * INTO v_membership;
  PERFORM public.org_audit(p_actor,'organization_memberships',v_membership.id,'CREATE',NULL,to_jsonb(v_membership));
  v_result:=jsonb_build_object('id',v_household.id,'name',v_household.name,
    'linked_count',public.org_link_owned_farms(p_actor,v_household.id,p_farm_ids));
  PERFORM public.org_audit(p_actor,'household_setup',v_household.id,'CREATE',NULL,
    jsonb_build_object('request',v_request,'result',v_result));
  RETURN v_result;
END $$;

CREATE FUNCTION public.org_attach_household_farms(p_actor uuid,p_org uuid,p_farm_ids uuid[],p_cooperative uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_household public.organizations; v_coop uuid;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  SELECT * INTO v_household FROM public.organizations WHERE id=p_org AND type='FARMER_HOUSEHOLD' AND status FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy hộ nuôi' USING ERRCODE='PT404'; END IF;
  SELECT cooperative_id INTO v_coop FROM public.cooperative_households
    WHERE household_id=p_org AND ended_at IS NULL FOR UPDATE;
  PERFORM public.org_require_manager(p_actor,p_org);
  IF v_coop IS DISTINCT FROM p_cooperative THEN
    RAISE EXCEPTION 'Quan hệ HTX đã thay đổi. Hãy tải lại để xem phạm vi chia sẻ trước khi lưu' USING ERRCODE='PT409';
  END IF;
  IF cardinality(p_farm_ids)=0 THEN RAISE EXCEPTION 'Hãy chọn ít nhất một cơ sở nuôi' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('id',p_org,'name',v_household.name,
    'linked_count',public.org_link_owned_farms(p_actor,p_org,p_farm_ids));
END $$;

REVOKE ALL ON FUNCTION public.org_household_setup_options(uuid),public.org_link_owned_farms(uuid,uuid,uuid[]),
  public.org_create_household_profile(uuid,uuid,text,text,uuid[]),public.org_attach_household_farms(uuid,uuid,uuid[],uuid)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.org_household_setup_options(uuid),public.org_link_owned_farms(uuid,uuid,uuid[]),
  public.org_create_household_profile(uuid,uuid,text,text,uuid[]),public.org_attach_household_farms(uuid,uuid,uuid[],uuid)
TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
