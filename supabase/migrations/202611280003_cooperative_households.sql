BEGIN;

CREATE TABLE public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations,
  sender_id uuid NOT NULL REFERENCES public.user_profiles,
  target_organization_id uuid REFERENCES public.organizations,
  target_user_id uuid REFERENCES public.user_profiles,
  kind text NOT NULL CHECK (kind IN ('HOUSEHOLD', 'STAFF')),
  intended_role text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','CANCELLED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  responded_at timestamptz,
  responded_by uuid REFERENCES public.user_profiles,
  CHECK (expires_at > created_at),
  CHECK ((kind = 'HOUSEHOLD' AND target_organization_id IS NOT NULL AND target_user_id IS NULL AND intended_role IS NULL)
    OR (kind = 'STAFF' AND target_user_id IS NOT NULL AND target_organization_id IS NULL AND intended_role IS NOT DISTINCT FROM 'STAFF'))
);
CREATE UNIQUE INDEX pending_household_invite_key ON public.organization_invitations(organization_id, target_organization_id)
  WHERE kind='HOUSEHOLD' AND status='PENDING';
CREATE UNIQUE INDEX pending_staff_invite_key ON public.organization_invitations(organization_id, target_user_id)
  WHERE kind='STAFF' AND status='PENDING';
CREATE INDEX org_invite_received ON public.organization_invitations(target_organization_id, created_at DESC);
CREATE INDEX org_invite_sent ON public.organization_invitations(organization_id, created_at DESC);
CREATE INDEX org_invite_user ON public.organization_invitations(target_user_id, created_at DESC) WHERE target_user_id IS NOT NULL;

CREATE TABLE public.cooperative_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id uuid NOT NULL REFERENCES public.organizations,
  household_id uuid NOT NULL REFERENCES public.organizations,
  invitation_id uuid NOT NULL UNIQUE REFERENCES public.organization_invitations,
  joined_at timestamptz NOT NULL,
  joined_by uuid NOT NULL REFERENCES public.user_profiles,
  ended_at timestamptz,
  ended_by uuid REFERENCES public.user_profiles,
  share_logs boolean NOT NULL DEFAULT false,
  shared_batch_ids uuid[] NOT NULL DEFAULT '{}' CHECK (array_position(shared_batch_ids,NULL) IS NULL),
  CHECK (cooperative_id <> household_id),
  CHECK ((ended_at IS NULL AND ended_by IS NULL) OR (ended_at IS NOT NULL AND ended_at >= joined_at AND ended_by IS NOT NULL)),
  EXCLUDE USING gist (household_id WITH =, tstzrange(joined_at, ended_at, '[)') WITH &&)
);
CREATE INDEX cooperative_households_by_coop ON public.cooperative_households(cooperative_id, joined_at DESC);
CREATE INDEX cooperative_households_history ON public.cooperative_households(household_id, joined_at DESC);
CREATE INDEX org_relationship_audit_idx ON public.audit_logs(entity_id, created_at)
  WHERE entity_type='cooperative_household_sharing';

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cooperative_households ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_invitations, public.cooperative_households FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE ON public.organization_invitations, public.cooperative_households TO service_role;

CREATE FUNCTION public.org_audit(p_actor uuid, p_entity text, p_id uuid, p_action public.audit_action,
  p_before jsonb, p_after jsonb) RETURNS void
LANGUAGE sql SET search_path=pg_catalog,public AS $$
  INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data,created_at)
  VALUES(p_actor,p_entity,p_id,p_action,p_before,p_after,clock_timestamp());
$$;

CREATE FUNCTION public.org_require_manager(p_actor uuid, p_org uuid) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
BEGIN
  IF NOT public.org_is_manager(p_actor,p_org) THEN
    RAISE EXCEPTION 'Bạn không có quyền quản lý đơn vị này' USING ERRCODE='42501';
  END IF;
END $$;

CREATE FUNCTION public.org_update_profile(p_actor uuid, p_org uuid, p_name text, p_address text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.organizations; v_after public.organizations;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  IF length(trim(coalesce(p_name,''))) NOT BETWEEN 1 AND 255 OR length(p_address)>1000 THEN
    RAISE EXCEPTION 'Tên hoặc địa chỉ đơn vị không hợp lệ' USING ERRCODE='22023';
  END IF;
  SELECT * INTO STRICT v_prior FROM public.organizations WHERE id=p_org FOR UPDATE;
  UPDATE public.organizations SET name=trim(p_name),address=nullif(trim(p_address),'') WHERE id=p_org RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'organizations',p_org,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN jsonb_build_object('id',v_after.id,'name',v_after.name,'address',v_after.address);
END $$;

CREATE FUNCTION public.org_household_search(p_actor uuid, p_org uuid, p_query text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  IF NOT EXISTS(SELECT FROM public.organizations WHERE id=p_org AND type='COOPERATIVE') THEN
    RAISE EXCEPTION 'Chỉ hợp tác xã được tìm hộ thành viên' USING ERRCODE='42501';
  END IF;
  IF length(trim(coalesce(p_query,''))) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'Nhập tên hộ từ 2 đến 100 ký tự' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('households',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.name,h.id)
    FROM (SELECT id,name,address FROM public.organizations
      WHERE status AND type='FARMER_HOUSEHOLD' AND position(lower(trim(p_query)) in lower(name))>0
      ORDER BY name,id LIMIT 30) h),'[]'::jsonb));
END $$;

CREATE FUNCTION public.org_invite_household(p_actor uuid, p_org uuid, p_household uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_inv public.organization_invitations; v_expired public.organization_invitations;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  IF NOT EXISTS (SELECT FROM public.organizations WHERE id=p_org AND type='COOPERATIVE') THEN
    RAISE EXCEPTION 'Chỉ hợp tác xã được mời hộ nuôi' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id=p_household AND status AND type='FARMER_HOUSEHOLD' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy hộ nuôi' USING ERRCODE='PT404'; END IF;
  IF EXISTS(SELECT FROM public.cooperative_households WHERE household_id=p_household AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Hộ nuôi đang là thành viên của một hợp tác xã' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO v_inv FROM public.organization_invitations
  WHERE organization_id=p_org AND target_organization_id=p_household AND status='PENDING' FOR UPDATE;
  IF v_inv.id IS NOT NULL AND v_inv.expires_at>clock_timestamp() THEN RETURN to_jsonb(v_inv); END IF;
  IF v_inv.id IS NOT NULL THEN
    UPDATE public.organization_invitations SET status='EXPIRED' WHERE id=v_inv.id RETURNING * INTO v_expired;
    PERFORM public.org_audit(p_actor,'organization_invitations',v_inv.id,'UPDATE',to_jsonb(v_inv),to_jsonb(v_expired));
  END IF;
  INSERT INTO public.organization_invitations(organization_id,sender_id,target_organization_id,kind)
  VALUES(p_org,p_actor,p_household,'HOUSEHOLD') RETURNING * INTO v_inv;
  PERFORM public.org_audit(p_actor,'organization_invitations',v_inv.id,'CREATE',NULL,to_jsonb(v_inv));
  RETURN to_jsonb(v_inv);
END $$;

CREATE FUNCTION public.org_invitations(p_actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('invitations',coalesce(jsonb_agg(jsonb_build_object(
   'id',i.id,'kind',i.kind,'status',CASE WHEN i.status='PENDING' AND i.expires_at<=now() THEN 'EXPIRED' ELSE i.status END,
   'created_at',i.created_at,'expires_at',i.expires_at,'sender_name',u.full_name,'organization_id',o.id,
   'organization_name',o.name,'target_organization_id',h.id,'target_organization_name',h.name,'target_user_id',i.target_user_id,
   'target_user_name',target.full_name,'canRespond',i.status='PENDING' AND i.expires_at>now() AND o.status AND rights.recipient,
   'canCancel',i.status='PENDING' AND i.expires_at>now() AND rights.sender)
   ORDER BY i.created_at DESC,i.id),'[]'::jsonb))
 FROM public.organization_invitations i
 JOIN public.organizations o ON o.id=i.organization_id
 JOIN public.user_profiles u ON u.id=i.sender_id
 LEFT JOIN public.organizations h ON h.id=i.target_organization_id
 LEFT JOIN public.user_profiles target ON target.id=i.target_user_id
 CROSS JOIN LATERAL (SELECT public.org_is_manager(p_actor,o.id) AS sender,
   (public.org_is_manager(p_actor,h.id) OR
     (i.target_user_id IS NOT DISTINCT FROM p_actor AND target.status IS TRUE AND target.role='FARMER')) AS recipient) rights
 WHERE rights.sender OR rights.recipient;
$$;

CREATE FUNCTION public.org_cancel_invite(p_actor uuid, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.organization_invitations; v_after public.organization_invitations;
BEGIN
  SELECT * INTO v_prior FROM public.organization_invitations WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR NOT public.org_is_manager(p_actor,v_prior.organization_id) THEN
    RAISE EXCEPTION 'Không tìm thấy lời mời' USING ERRCODE='PT404';
  END IF;
  IF v_prior.status='CANCELLED' THEN RETURN to_jsonb(v_prior); END IF;
  IF v_prior.status<>'PENDING' OR v_prior.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Lời mời đã được xử lý hoặc hết hạn' USING ERRCODE='PT409';
  END IF;
  UPDATE public.organization_invitations SET status='CANCELLED',responded_by=p_actor,responded_at=clock_timestamp()
    WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'organization_invitations',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

CREATE FUNCTION public.org_validate_shared_batches(p_household uuid,p_batches uuid[],p_previous uuid[],p_joined timestamptz) RETURNS void
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_batches IS NULL OR cardinality(p_batches)>200 OR EXISTS(
    SELECT FROM unnest(p_batches) AS selected(id)
    WHERE NOT EXISTS(SELECT FROM public.batches b JOIN public.ponds p ON p.id=b.pond_id
      JOIN public.farms f ON f.id=p.farm_id
      WHERE b.id=selected.id AND f.organization_id=p_household
      AND (b.id=ANY(p_previous) OR (b.status IN ('PREPARING','GROWING','READY_FOR_HARVEST')
        AND (b.created_at<p_joined OR (b.stocking_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date<(p_joined AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))))
  ) THEN
    RAISE EXCEPTION 'Danh sách vụ nuôi được chia sẻ không hợp lệ' USING ERRCODE='22023';
  END IF;
END $$;

CREATE FUNCTION public.org_respond_household_invite(p_actor uuid, p_id uuid, p_accept boolean, p_share_logs boolean,
  p_batch_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.organization_invitations; v_after public.organization_invitations;
  v_relation public.cooperative_households; v_house uuid; v_now timestamptz;
BEGIN
  SELECT target_organization_id INTO v_house FROM public.organization_invitations WHERE id=p_id AND kind='HOUSEHOLD';
  IF NOT public.org_is_manager(p_actor,v_house) THEN
    RAISE EXCEPTION 'Không tìm thấy lời mời' USING ERRCODE='PT404';
  END IF;
  -- One order for accepting competing invitations and changes to the household relationship.
  PERFORM 1 FROM public.organizations WHERE id=v_house FOR UPDATE;
  PERFORM public.org_require_manager(p_actor,v_house);
  SELECT * INTO STRICT v_prior FROM public.organization_invitations WHERE id=p_id FOR UPDATE;
  v_now := clock_timestamp();
  IF v_prior.status<>'PENDING' OR v_prior.expires_at<=v_now
    OR NOT EXISTS(SELECT FROM public.organizations WHERE id=v_prior.organization_id AND status) THEN
    RAISE EXCEPTION 'Lời mời đã được xử lý hoặc hết hạn' USING ERRCODE='PT409';
  END IF;
  IF p_accept IS NULL OR p_share_logs IS NULL THEN
    RAISE EXCEPTION 'Lựa chọn lời mời hoặc phạm vi chia sẻ không hợp lệ' USING ERRCODE='22023';
  END IF;
  IF p_accept THEN
    IF EXISTS(SELECT FROM public.cooperative_households WHERE household_id=v_house AND ended_at IS NULL) THEN
      RAISE EXCEPTION 'Hộ nuôi đang là thành viên của một hợp tác xã' USING ERRCODE='PT409';
    END IF;
    PERFORM public.org_validate_shared_batches(v_house,p_batch_ids,'{}',v_now);
    INSERT INTO public.cooperative_households(cooperative_id,household_id,invitation_id,joined_at,joined_by,share_logs,shared_batch_ids)
    VALUES(v_prior.organization_id,v_house,v_prior.id,v_now,p_actor,p_share_logs,p_batch_ids) RETURNING * INTO v_relation;
    PERFORM public.org_audit(p_actor,'cooperative_household_sharing',v_relation.id,'CREATE',NULL,to_jsonb(v_relation));
  END IF;
  UPDATE public.organization_invitations
    SET status=CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'REJECTED' END,responded_by=p_actor,responded_at=v_now
    WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'organization_invitations',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

CREATE FUNCTION public.org_respond_invite(p_actor uuid, p_id uuid, p_accept boolean, p_share_logs boolean,
  p_batch_ids uuid[]) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog,public AS $$
  SELECT public.org_respond_household_invite(p_actor,p_id,p_accept,p_share_logs,p_batch_ids);
$$;

CREATE FUNCTION public.org_households(p_actor uuid, p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  RETURN jsonb_build_object('households',coalesce((SELECT jsonb_agg(
    to_jsonb(r) || jsonb_build_object('household_name',h.name,'cooperative_name',c.name)
    ORDER BY r.joined_at DESC,r.id)
    FROM public.cooperative_households r JOIN public.organizations h ON h.id=r.household_id
    JOIN public.organizations c ON c.id=r.cooperative_id
    WHERE r.household_id=p_org OR r.cooperative_id=p_org),'[]'::jsonb));
END $$;

CREATE FUNCTION public.org_share_candidates(p_actor uuid,p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  RETURN jsonb_build_object('batches',coalesce((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.stocking_date DESC,item.id)
    FROM (SELECT b.id,b.batch_code,b.stocking_date,b.status,p.pond_name
      FROM public.batches b JOIN public.ponds p ON p.id=b.pond_id JOIN public.farms f ON f.id=p.farm_id
      LEFT JOIN public.cooperative_households r ON r.household_id=f.organization_id AND r.ended_at IS NULL
      WHERE f.organization_id=p_org AND ((b.status IN ('PREPARING','GROWING','READY_FOR_HARVEST')
        AND (r.id IS NULL OR b.created_at<r.joined_at
          OR (b.stocking_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date<(r.joined_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))
        OR b.id=ANY(r.shared_batch_ids))) item),'[]'::jsonb));
END $$;

CREATE FUNCTION public.org_change_sharing(p_actor uuid,p_org uuid,p_id uuid,p_share_logs boolean,p_batch_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.cooperative_households; v_after public.cooperative_households;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  SELECT * INTO v_prior FROM public.cooperative_households WHERE id=p_id AND household_id=p_org AND ended_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy quan hệ đang hoạt động' USING ERRCODE='PT404'; END IF;
  PERFORM public.org_validate_shared_batches(p_org,p_batch_ids,v_prior.shared_batch_ids,v_prior.joined_at);
  IF p_share_logs IS NULL THEN RAISE EXCEPTION 'Phạm vi chia sẻ không hợp lệ' USING ERRCODE='22023'; END IF;
  IF v_prior.share_logs=p_share_logs AND v_prior.shared_batch_ids=p_batch_ids THEN RETURN to_jsonb(v_prior); END IF;
  UPDATE public.cooperative_households SET share_logs=p_share_logs,shared_batch_ids=p_batch_ids WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'cooperative_household_sharing',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

CREATE FUNCTION public.org_household_data(p_actor uuid,p_org uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE v_rel public.cooperative_households;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  SELECT r.* INTO v_rel FROM public.cooperative_households r JOIN public.organizations h ON h.id=r.household_id AND h.status
  WHERE r.id=p_id AND r.cooperative_id=p_org AND r.ended_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy hộ thành viên đang chia sẻ' USING ERRCODE='PT404'; END IF;
  RETURN (WITH owned_batches AS (
    SELECT b.id,b.batch_code,b.species,b.stocking_date,b.status,b.created_at,p.pond_name,p.pond_code
    FROM public.batches b JOIN public.ponds p ON p.id=b.pond_id JOIN public.farms f ON f.id=p.farm_id
    WHERE f.organization_id=v_rel.household_id
  ), shared_batches AS (
    SELECT id,batch_code,species,stocking_date,status,pond_name,pond_code FROM owned_batches
    WHERE ((stocking_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date>=(v_rel.joined_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
      AND created_at>=v_rel.joined_at) OR id=ANY(v_rel.shared_batch_ids)
  ), shared_lots AS (
    SELECT l.id,l.lot_code,l.quantity,h.harvest_date,b.batch_code,b.species,b.pond_name,b.pond_code
    FROM public.harvest_lots l JOIN public.harvests h ON h.id=l.harvest_id JOIN owned_batches b ON b.id=l.batch_id
    WHERE l.created_at>=v_rel.joined_at
  ), shared_logs AS (
    SELECT l.id,l.batch_id,l.log_type,l.log_date,l.details
    FROM public.farming_logs l JOIN shared_batches b ON b.id=l.batch_id
    WHERE v_rel.share_logs AND l.lifecycle_status='CONFIRMED'
      AND ((l.log_date>=v_rel.joined_at AND l.created_at>=v_rel.joined_at) OR l.batch_id=ANY(v_rel.shared_batch_ids))
  ), sharing_history AS (
    SELECT created_at,action,new_data->'share_logs' AS share_logs,new_data->'shared_batch_ids' AS shared_batch_ids
    FROM public.audit_logs WHERE entity_type='cooperative_household_sharing' AND entity_id=v_rel.id
  )
  SELECT jsonb_build_object('relationship',to_jsonb(v_rel),
    'household',(SELECT jsonb_build_object('id',id,'name',name,'address',address) FROM public.organizations WHERE id=v_rel.household_id),
    'batches',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY stocking_date DESC,id) FROM shared_batches b),'[]'::jsonb),
    'lots',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY harvest_date DESC,id) FROM shared_lots l),'[]'::jsonb),
    'logs',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY log_date DESC,id) FROM shared_logs l),'[]'::jsonb),
    'sharingHistory',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY created_at DESC) FROM sharing_history a),'[]'::jsonb)));
END $$;

CREATE FUNCTION public.org_leave_cooperative(p_actor uuid,p_org uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.cooperative_households; v_after public.cooperative_households;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  SELECT * INTO v_prior FROM public.cooperative_households WHERE id=p_id AND household_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy quan hệ thành viên' USING ERRCODE='PT404'; END IF;
  IF v_prior.ended_at IS NOT NULL THEN RETURN to_jsonb(v_prior); END IF;
  IF EXISTS(SELECT FROM public.pond_operating_periods op
    JOIN public.ponds p ON p.id=op.pond_id JOIN public.farms f ON f.id=p.farm_id
    WHERE f.organization_id=p_org AND op.organization_id=v_prior.cooperative_id
      AND (op.ends_at IS NULL OR op.ends_at>clock_timestamp())) THEN
    RAISE EXCEPTION 'Cần hoàn tất bàn giao các ao đang do hợp tác xã vận hành trước khi rời' USING ERRCODE='PT409';
  END IF;
  UPDATE public.cooperative_households SET ended_at=clock_timestamp(),ended_by=p_actor WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'cooperative_households',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
    ('org_audit','org_require_manager','org_update_profile','org_household_search','org_invite_household','org_invitations',
     'org_cancel_invite','org_validate_shared_batches','org_respond_household_invite','org_respond_invite','org_households',
     'org_share_candidates','org_change_sharing','org_household_data','org_leave_cooperative')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
