BEGIN;

CREATE TABLE public.pond_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id uuid NOT NULL REFERENCES public.ponds,
  relationship_id uuid NOT NULL REFERENCES public.cooperative_households,
  household_id uuid NOT NULL REFERENCES public.organizations,
  cooperative_id uuid NOT NULL REFERENCES public.organizations,
  operating_period_id uuid UNIQUE REFERENCES public.pond_operating_periods,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','RETURNED','CANCELLED')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  requested_by uuid NOT NULL REFERENCES public.user_profiles,
  responded_at timestamptz,
  responded_by uuid REFERENCES public.user_profiles,
  returned_at timestamptz,
  returned_by uuid REFERENCES public.user_profiles,
  CHECK (household_id <> cooperative_id),
  CHECK ((status IN ('ACCEPTED','RETURNED')) = (operating_period_id IS NOT NULL)),
  CHECK ((status <> 'PENDING') = (responded_at IS NOT NULL) AND (responded_at IS NULL) = (responded_by IS NULL)),
  CHECK ((status = 'RETURNED') = (returned_at IS NOT NULL) AND (returned_at IS NULL) = (returned_by IS NULL)),
  CHECK (responded_at >= requested_at AND returned_at >= responded_at)
);
CREATE UNIQUE INDEX pond_handovers_open_idx ON public.pond_handovers(pond_id) WHERE status IN ('PENDING','ACCEPTED');
CREATE INDEX pond_handovers_relationship_idx ON public.pond_handovers(relationship_id);
CREATE INDEX pond_handovers_household_idx ON public.pond_handovers(household_id,requested_at DESC);
CREATE INDEX pond_handovers_cooperative_idx ON public.pond_handovers(cooperative_id,requested_at DESC);
ALTER TABLE public.pond_handovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pond_handovers FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.pond_handovers TO service_role;
-- The pond row serializes assignment changes. Record the predecessor so cancellation can
-- restore only the assignment whose end was originally scheduled by that successor.
ALTER TABLE public.pond_assignments ADD COLUMN previous_assignment_id uuid REFERENCES public.pond_assignments;

CREATE FUNCTION public.org_staff(p_actor uuid,p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  RETURN (SELECT jsonb_build_object(
    'staff',coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.full_name,item.id)
      FILTER (WHERE u.role='FARMER' AND u.status AND tstzrange(item.starts_at,item.ends_at,'[)') @> v_now),'[]'::jsonb),
    'history',coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.ends_at DESC,item.id)
      FILTER (WHERE item.ends_at<=v_now),'[]'::jsonb))
    FROM public.organization_memberships m JOIN public.user_profiles u ON u.id=m.user_id
    CROSS JOIN LATERAL (SELECT m.id,m.organization_id,m.user_id,u.full_name,m.role,m.permissions,m.starts_at,m.ends_at) item
    WHERE m.organization_id=p_org);
END $$;

CREATE FUNCTION public.org_member_permissions(p_actor uuid,p_org uuid,p_id uuid,p_permissions text[]) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.organization_memberships; v_after public.organization_memberships; v_permissions text[];
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  IF p_permissions IS NULL OR NOT p_permissions <@ ARRAY['LOG_CONFIRM','HARVEST_CONFIRM']
    OR array_position(p_permissions,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Quyền xác nhận không hợp lệ' USING ERRCODE='22023';
  END IF;
  SELECT m.* INTO v_prior FROM public.organization_memberships m JOIN public.organizations o ON o.id=m.organization_id
  WHERE m.id=p_id AND m.organization_id=p_org
    AND ((o.type='COOPERATIVE' AND m.role='MANAGER') OR (o.type='FARMER_HOUSEHOLD' AND m.role='REPRESENTATIVE'))
  FOR UPDATE OF m;
  PERFORM public.org_require_manager(p_actor,p_org);
  IF v_prior.id IS NULL OR NOT tstzrange(v_prior.starts_at,v_prior.ends_at,'[)') @> clock_timestamp()
    OR NOT public.org_is_manager(v_prior.user_id,p_org) THEN
    RAISE EXCEPTION 'Không tìm thấy người quản lý đang hoạt động' USING ERRCODE='PT404';
  END IF;
  SELECT ARRAY(SELECT DISTINCT permission FROM unnest(p_permissions) permission ORDER BY permission) INTO v_permissions;
  IF v_prior.permissions=v_permissions THEN RETURN to_jsonb(v_prior); END IF;
  UPDATE public.organization_memberships SET permissions=v_permissions WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'organization_memberships',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

CREATE FUNCTION public.org_pond_operator(p_pond uuid,p_at timestamptz) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT coalesce(op.organization_id,f.organization_id)
  FROM public.ponds p JOIN public.farms f ON f.id=p.farm_id
  LEFT JOIN public.pond_operating_periods op ON op.pond_id=p.id
    AND tstzrange(op.starts_at,op.ends_at,'[)') @> p_at
  WHERE p.id=p_pond;
$$;

CREATE FUNCTION public.org_pond_operations(p_actor uuid,p_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  RETURN (WITH operating AS (
    SELECT p.id,p.farm_id,p.pond_name,p.pond_code,f.organization_id AS owner_organization_id,
      public.org_pond_operator(p.id,v_now) AS operator_organization_id
    FROM public.ponds p JOIN public.farms f ON f.id=p.farm_id
    WHERE f.organization_id=p_org OR EXISTS(SELECT FROM public.pond_operating_periods op
      WHERE op.pond_id=p.id AND op.organization_id=p_org AND tstzrange(op.starts_at,op.ends_at,'[)') @> v_now)
  ), visible AS (
    SELECT p.*,
      (SELECT a.id FROM public.pond_assignments a WHERE a.pond_id=p.id AND a.organization_id=p_org
        AND tstzrange(a.starts_at,a.ends_at,'[)') @> v_now) AS current_assignment_id,
      (SELECT a.id FROM public.pond_assignments a WHERE a.pond_id=p.id AND a.organization_id=p_org AND a.starts_at>v_now
        AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(v_now,NULL,'[)') ORDER BY a.starts_at LIMIT 1) AS scheduled_assignment_id
    FROM operating p
  ), assignments AS (
    SELECT a.id,a.pond_id,a.organization_id,a.user_id,u.full_name,a.permissions,a.note,a.starts_at,a.ends_at,a.granted_by
    FROM public.pond_assignments a JOIN public.user_profiles u ON u.id=a.user_id WHERE a.organization_id=p_org
  ), handovers AS (
    SELECT h.id,h.pond_id,p.pond_name,p.pond_code,h.household_id,o.name AS household_name,
      h.cooperative_id,c.name AS cooperative_name,h.status,h.requested_at,h.responded_at,h.returned_at
    FROM public.pond_handovers h JOIN public.ponds p ON p.id=h.pond_id
    JOIN public.organizations o ON o.id=h.household_id JOIN public.organizations c ON c.id=h.cooperative_id
    WHERE h.household_id=p_org OR h.cooperative_id=p_org
  )
  SELECT jsonb_build_object(
    'ponds',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.pond_name,v.id) FROM visible v),'[]'::jsonb),
    'assignments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.starts_at DESC,a.id) FROM assignments a),'[]'::jsonb),
    'handovers',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.requested_at DESC,h.id) FROM handovers h),'[]'::jsonb)));
END $$;

-- Callers hold the pond lock before changing its timeline.
CREATE FUNCTION public.org_close_pond_assignment(p_actor uuid,p_id uuid,p_at timestamptz,p_restore boolean)
RETURNS public.pond_assignments LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.pond_assignments; v_after public.pond_assignments;
  v_prev public.pond_assignments; v_restored public.pond_assignments;
BEGIN
  SELECT * INTO STRICT v_prior FROM public.pond_assignments WHERE id=p_id FOR UPDATE;
  IF NOT tstzrange(v_prior.starts_at,v_prior.ends_at,'[)') && tstzrange(p_at,NULL,'[)') THEN RETURN v_prior; END IF;
  UPDATE public.pond_assignments SET ends_at=greatest(v_prior.starts_at,p_at) WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'pond_assignments',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  IF p_restore AND v_prior.starts_at>p_at AND v_prior.previous_assignment_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.pond_assignments a WHERE a.id=v_prior.previous_assignment_id
      AND a.ends_at=v_prior.starts_at AND tstzrange(a.starts_at,a.ends_at,'[)') @> p_at
      AND EXISTS(SELECT FROM public.organization_memberships m JOIN public.user_profiles u ON u.id=m.user_id AND u.status
        WHERE m.organization_id=a.organization_id AND m.user_id=a.user_id AND m.role='STAFF'
        AND tstzrange(m.starts_at,m.ends_at,'[)') @> p_at) FOR UPDATE;
    IF FOUND THEN
      UPDATE public.pond_assignments SET ends_at=NULL WHERE id=v_prev.id RETURNING * INTO v_restored;
      PERFORM public.org_audit(p_actor,'pond_assignments',v_prev.id,'UPDATE',to_jsonb(v_prev),to_jsonb(v_restored));
    END IF;
  END IF;
  RETURN v_after;
END $$;

CREATE FUNCTION public.org_set_assignment(p_actor uuid,p_org uuid,p_pond uuid,p_user uuid,p_permissions text[],p_note text,
  p_expected_assignment uuid,p_starts_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_now timestamptz; v_start timestamptz; v_member public.organization_memberships;
  v_prior public.pond_assignments; v_clipped public.pond_assignments; v_future public.pond_assignments;
  v_after public.pond_assignments; v_permissions text[]; v_note text := nullif(trim(p_note),'');
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  IF p_permissions IS NULL OR NOT p_permissions <@ ARRAY['READ','BATCH_CREATE','BATCH_EDIT','LOG_CREATE','LOG_EDIT','LOG_CONFIRM','HARVEST_CREATE','HARVEST_EDIT','HARVEST_CONFIRM']
    OR NOT 'READ'=ANY(p_permissions) OR array_position(p_permissions,NULL) IS NOT NULL OR length(v_note)>2000 THEN
    RAISE EXCEPTION 'Quyền phân công hoặc ghi chú không hợp lệ' USING ERRCODE='22023';
  END IF;
  SELECT ARRAY(SELECT DISTINCT permission FROM unnest(p_permissions) permission ORDER BY permission) INTO v_permissions;
  SELECT * INTO v_member FROM public.organization_memberships WHERE organization_id=p_org AND user_id=p_user AND role='STAFF'
    AND tstzrange(starts_at,ends_at,'[)') @> clock_timestamp() FOR UPDATE;
  PERFORM 1 FROM public.ponds WHERE id=p_pond FOR UPDATE;
  v_now := clock_timestamp();
  v_start := coalesce(p_starts_at,v_now);
  PERFORM public.org_require_manager(p_actor,p_org);
  IF public.org_pond_operator(p_pond,v_now) IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'Không tìm thấy ao thuộc phạm vi vận hành' USING ERRCODE='PT404';
  END IF;
  IF v_member.id IS NULL OR NOT tstzrange(v_member.starts_at,v_member.ends_at,'[)') @> greatest(v_start,v_now)
    OR NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_user AND role='FARMER' AND status) THEN
    RAISE EXCEPTION 'Không tìm thấy nhân sự đang hoạt động' USING ERRCODE='PT404';
  END IF;
  SELECT * INTO v_prior FROM public.pond_assignments WHERE pond_id=p_pond
    AND tstzrange(starts_at,ends_at,'[)') @> v_now FOR UPDATE;
  SELECT * INTO v_future FROM public.pond_assignments WHERE pond_id=p_pond AND starts_at>v_now
    AND tstzrange(starts_at,ends_at,'[)') && tstzrange(v_now,NULL,'[)') ORDER BY starts_at LIMIT 1 FOR UPDATE;
  IF v_future.id IS NOT NULL THEN
    IF v_future.organization_id=p_org AND v_future.user_id=p_user AND v_future.permissions=v_permissions
      AND v_future.note IS NOT DISTINCT FROM v_note AND v_future.starts_at=p_starts_at THEN RETURN to_jsonb(v_future); END IF;
    RAISE EXCEPTION 'Ao đã có phân công lên lịch. Hãy hủy phân công đó trước' USING ERRCODE='PT409';
  END IF;
  IF v_prior.organization_id=p_org AND v_prior.user_id=p_user AND v_prior.permissions=v_permissions
    AND v_prior.note IS NOT DISTINCT FROM v_note AND (p_starts_at IS NULL OR p_starts_at=v_prior.starts_at) THEN
    RETURN to_jsonb(v_prior);
  END IF;
  IF v_prior.id IS DISTINCT FROM p_expected_assignment THEN
    RAISE EXCEPTION 'Phân công hiện tại đã thay đổi. Hãy tải lại dữ liệu' USING ERRCODE='PT409';
  END IF;
  IF v_start<v_now OR NOT isfinite(v_start) THEN
    RAISE EXCEPTION 'Thời điểm bắt đầu phân công phải ở hiện tại hoặc tương lai' USING ERRCODE='22023';
  END IF;
  IF v_prior.id IS NOT NULL THEN
    UPDATE public.pond_assignments SET ends_at=v_start WHERE id=v_prior.id RETURNING * INTO v_clipped;
    PERFORM public.org_audit(p_actor,'pond_assignments',v_prior.id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_clipped));
  END IF;
  INSERT INTO public.pond_assignments(pond_id,organization_id,user_id,permissions,starts_at,granted_by,note,previous_assignment_id)
  VALUES(p_pond,p_org,p_user,v_permissions,v_start,p_actor,v_note,v_prior.id) RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'pond_assignments',v_after.id,'CREATE',NULL,to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

CREATE FUNCTION public.org_end_assignment(p_actor uuid,p_org uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_pond uuid;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  SELECT pond_id INTO v_pond FROM public.pond_assignments WHERE id=p_id AND organization_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phân công' USING ERRCODE='PT404'; END IF;
  PERFORM 1 FROM public.ponds WHERE id=v_pond FOR UPDATE;
  PERFORM public.org_require_manager(p_actor,p_org);
  RETURN to_jsonb(public.org_close_pond_assignment(p_actor,p_id,clock_timestamp(),true));
END $$;

CREATE FUNCTION public.org_finish_staff_membership(p_actor uuid,p_org uuid,p_id uuid,p_self boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.organization_memberships; v_after public.organization_memberships;
  v_pond uuid; v_assignment uuid; v_now timestamptz;
BEGIN
  IF NOT p_self THEN PERFORM public.org_require_manager(p_actor,p_org); END IF;
  SELECT * INTO v_prior FROM public.organization_memberships WHERE id=p_id AND organization_id=p_org AND role='STAFF'
    AND (NOT p_self OR user_id=p_actor) FOR UPDATE;
  IF v_prior.id IS NULL THEN RAISE EXCEPTION 'Không tìm thấy nhân sự' USING ERRCODE='PT404'; END IF;
  IF NOT p_self THEN PERFORM public.org_require_manager(p_actor,p_org); END IF;
  v_now := clock_timestamp();
  IF NOT tstzrange(v_prior.starts_at,v_prior.ends_at,'[)') @> v_now THEN RETURN to_jsonb(v_prior); END IF;
  PERFORM p.id FROM public.ponds p WHERE EXISTS(SELECT FROM public.pond_assignments a
    WHERE a.pond_id=p.id AND a.organization_id=p_org AND a.user_id=v_prior.user_id
    AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(v_now,NULL,'[)')) ORDER BY p.id FOR UPDATE;
  IF NOT p_self THEN PERFORM public.org_require_manager(p_actor,p_org); END IF;
  v_now := clock_timestamp();
  IF NOT tstzrange(v_prior.starts_at,v_prior.ends_at,'[)') @> v_now THEN RETURN to_jsonb(v_prior); END IF;
  UPDATE public.organization_memberships SET ends_at=v_now WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'organization_memberships',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  FOR v_pond IN
    SELECT p.id FROM public.ponds p WHERE EXISTS(SELECT FROM public.pond_assignments a
      WHERE a.pond_id=p.id AND a.organization_id=p_org AND a.user_id=v_prior.user_id
      AND tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(v_now,NULL,'[)'))
  LOOP
    FOR v_assignment IN SELECT id FROM public.pond_assignments WHERE pond_id=v_pond AND organization_id=p_org AND user_id=v_prior.user_id
      AND tstzrange(starts_at,ends_at,'[)') && tstzrange(v_now,NULL,'[)') ORDER BY starts_at DESC
    LOOP
      PERFORM public.org_close_pond_assignment(p_actor,v_assignment,v_now,true);
    END LOOP;
  END LOOP;
  RETURN to_jsonb(v_after);
END $$;

CREATE FUNCTION public.org_leave_staff(p_actor uuid,p_org uuid,p_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog,public AS $$
  SELECT public.org_finish_staff_membership(p_actor,p_org,p_id,true);
$$;
CREATE FUNCTION public.org_remove_staff(p_actor uuid,p_org uuid,p_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog,public AS $$
  SELECT public.org_finish_staff_membership(p_actor,p_org,p_id,false);
$$;

CREATE FUNCTION public.org_request_pond_handover(p_actor uuid,p_org uuid,p_pond uuid,p_cooperative uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_relation uuid; v_owner uuid; v_now timestamptz; v_handover public.pond_handovers;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  SELECT r.id INTO v_relation FROM public.cooperative_households r
  JOIN public.organizations c ON c.id=r.cooperative_id AND c.type='COOPERATIVE' AND c.status
  WHERE r.household_id=p_org AND r.cooperative_id=p_cooperative AND r.ended_at IS NULL FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy quan hệ hợp tác xã đang hoạt động' USING ERRCODE='PT404'; END IF;
  SELECT f.organization_id INTO v_owner FROM public.ponds p JOIN public.farms f ON f.id=p.farm_id
    WHERE p.id=p_pond FOR UPDATE OF p;
  PERFORM public.org_require_manager(p_actor,p_org);
  IF v_owner IS DISTINCT FROM p_org THEN RAISE EXCEPTION 'Không tìm thấy ao thuộc sở hữu của hộ' USING ERRCODE='PT404'; END IF;
  v_now := clock_timestamp();
  SELECT * INTO v_handover FROM public.pond_handovers WHERE pond_id=p_pond AND status IN ('PENDING','ACCEPTED') FOR UPDATE;
  IF v_handover.status='PENDING' AND v_handover.relationship_id=v_relation THEN RETURN to_jsonb(v_handover); END IF;
  IF v_handover.id IS NOT NULL OR public.org_pond_operator(p_pond,v_now) IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'Ao đang có bàn giao' USING ERRCODE='PT409';
  END IF;
  INSERT INTO public.pond_handovers(pond_id,relationship_id,household_id,cooperative_id,requested_at,requested_by)
  VALUES (p_pond,v_relation,p_org,p_cooperative,v_now,p_actor) RETURNING * INTO v_handover;
  PERFORM public.org_audit(p_actor,'pond_handovers',v_handover.id,'CREATE',NULL,to_jsonb(v_handover));
  RETURN to_jsonb(v_handover);
END $$;

CREATE FUNCTION public.org_respond_pond_handover(p_actor uuid,p_org uuid,p_id uuid,p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.pond_handovers; v_after public.pond_handovers; v_owner uuid;
  v_now timestamptz; v_period public.pond_operating_periods; v_assignment uuid; v_relation_active boolean;
BEGIN
  SELECT * INTO v_prior FROM public.pond_handovers WHERE id=p_id AND cooperative_id=p_org;
  IF NOT FOUND OR NOT public.org_is_manager(p_actor,p_org) THEN
    RAISE EXCEPTION 'Không tìm thấy yêu cầu bàn giao' USING ERRCODE='PT404';
  END IF;
  IF p_accept IS NULL THEN RAISE EXCEPTION 'Lựa chọn bàn giao không hợp lệ' USING ERRCODE='22023'; END IF;
  SELECT ended_at IS NULL INTO STRICT v_relation_active FROM public.cooperative_households
    WHERE id=v_prior.relationship_id FOR UPDATE;
  SELECT f.organization_id INTO STRICT v_owner FROM public.ponds p JOIN public.farms f ON f.id=p.farm_id
    WHERE p.id=v_prior.pond_id FOR UPDATE OF p;
  SELECT * INTO STRICT v_prior FROM public.pond_handovers WHERE id=p_id FOR UPDATE;
  PERFORM public.org_require_manager(p_actor,p_org);
  IF (p_accept AND v_prior.status='ACCEPTED') OR (NOT p_accept AND v_prior.status='REJECTED') THEN RETURN to_jsonb(v_prior); END IF;
  IF v_prior.status<>'PENDING' OR NOT v_relation_active OR v_owner IS DISTINCT FROM v_prior.household_id THEN
    RAISE EXCEPTION 'Yêu cầu bàn giao đã xử lý hoặc quan hệ đã kết thúc' USING ERRCODE='PT409';
  END IF;
  v_now := clock_timestamp();
  IF p_accept THEN
    IF public.org_pond_operator(v_prior.pond_id,v_now) IS DISTINCT FROM v_prior.household_id
      OR NOT EXISTS(SELECT FROM public.organizations WHERE id=v_prior.household_id AND status) THEN
      RAISE EXCEPTION 'Hộ không còn vận hành ao này' USING ERRCODE='PT409';
    END IF;
    FOR v_assignment IN SELECT id FROM public.pond_assignments WHERE pond_id=v_prior.pond_id
      AND tstzrange(starts_at,ends_at,'[)') && tstzrange(v_now,NULL,'[)')
    LOOP
      PERFORM public.org_close_pond_assignment(p_actor,v_assignment,v_now,false);
    END LOOP;
    INSERT INTO public.pond_operating_periods(pond_id,organization_id,starts_at,granted_by)
    VALUES(v_prior.pond_id,p_org,v_now,p_actor) RETURNING * INTO v_period;
    PERFORM public.org_audit(p_actor,'pond_operating_periods',v_period.id,'CREATE',NULL,to_jsonb(v_period));
  END IF;
  UPDATE public.pond_handovers SET status=CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'REJECTED' END,
    operating_period_id=v_period.id,responded_at=v_now,responded_by=p_actor WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'pond_handovers',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

CREATE FUNCTION public.org_end_pond_handover(p_actor uuid,p_org uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.pond_handovers; v_after public.pond_handovers; v_now timestamptz; v_assignment uuid;
  v_old_period public.pond_operating_periods; v_period public.pond_operating_periods;
BEGIN
  SELECT * INTO v_prior FROM public.pond_handovers WHERE id=p_id AND p_org IN (household_id,cooperative_id);
  IF NOT FOUND OR NOT public.org_is_manager(p_actor,p_org) THEN
    RAISE EXCEPTION 'Không tìm thấy bàn giao' USING ERRCODE='PT404';
  END IF;
  PERFORM 1 FROM public.cooperative_households WHERE id=v_prior.relationship_id FOR UPDATE;
  PERFORM 1 FROM public.ponds WHERE id=v_prior.pond_id FOR UPDATE;
  SELECT * INTO STRICT v_prior FROM public.pond_handovers WHERE id=p_id FOR UPDATE;
  PERFORM public.org_require_manager(p_actor,p_org);
  v_now := clock_timestamp();
  IF v_prior.status IN ('RETURNED','CANCELLED') THEN RETURN to_jsonb(v_prior); END IF;
  IF v_prior.status='PENDING' AND p_org=v_prior.household_id THEN
    UPDATE public.pond_handovers SET status='CANCELLED',responded_at=v_now,responded_by=p_actor WHERE id=p_id RETURNING * INTO v_after;
  ELSIF v_prior.status='ACCEPTED' THEN
    IF NOT EXISTS(SELECT FROM public.ponds p JOIN public.farms f ON f.id=p.farm_id
      JOIN public.organizations o ON o.id=f.organization_id AND o.status
      WHERE p.id=v_prior.pond_id AND f.organization_id=v_prior.household_id) THEN
      RAISE EXCEPTION 'Không có hộ sở hữu đang hoạt động để nhận lại ao' USING ERRCODE='PT409';
    END IF;
    FOR v_assignment IN SELECT id FROM public.pond_assignments WHERE pond_id=v_prior.pond_id
      AND tstzrange(starts_at,ends_at,'[)') && tstzrange(v_now,NULL,'[)')
    LOOP
      PERFORM public.org_close_pond_assignment(p_actor,v_assignment,v_now,false);
    END LOOP;
    SELECT * INTO STRICT v_old_period FROM public.pond_operating_periods WHERE id=v_prior.operating_period_id FOR UPDATE;
    UPDATE public.pond_operating_periods SET ends_at=v_now WHERE id=v_old_period.id RETURNING * INTO v_period;
    PERFORM public.org_audit(p_actor,'pond_operating_periods',v_period.id,'UPDATE',to_jsonb(v_old_period),to_jsonb(v_period));
    UPDATE public.pond_handovers SET status='RETURNED',returned_at=v_now,returned_by=p_actor WHERE id=p_id RETURNING * INTO v_after;
  ELSE
    RAISE EXCEPTION 'Không thể kết thúc bàn giao ở trạng thái này' USING ERRCODE='PT409';
  END IF;
  PERFORM public.org_audit(p_actor,'pond_handovers',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

CREATE OR REPLACE FUNCTION public.org_leave_cooperative(p_actor uuid,p_org uuid,p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.cooperative_households; v_after public.cooperative_households;
  v_handover public.pond_handovers; v_cancelled public.pond_handovers; v_now timestamptz;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  SELECT * INTO v_prior FROM public.cooperative_households WHERE id=p_id AND household_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy quan hệ thành viên' USING ERRCODE='PT404'; END IF;
  PERFORM public.org_require_manager(p_actor,p_org);
  IF v_prior.ended_at IS NOT NULL THEN RETURN to_jsonb(v_prior); END IF;
  v_now := clock_timestamp();
  IF EXISTS(SELECT FROM public.pond_operating_periods op
    JOIN public.ponds p ON p.id=op.pond_id JOIN public.farms f ON f.id=p.farm_id
    WHERE f.organization_id=p_org AND op.organization_id=v_prior.cooperative_id
      AND tstzrange(op.starts_at,op.ends_at,'[)') && tstzrange(v_now,NULL,'[)')) THEN
    RAISE EXCEPTION 'Cần hoàn tất bàn giao các ao đang do hợp tác xã vận hành trước khi rời' USING ERRCODE='PT409';
  END IF;
  FOR v_handover IN SELECT * FROM public.pond_handovers WHERE relationship_id=p_id AND status='PENDING' FOR UPDATE
  LOOP
    UPDATE public.pond_handovers SET status='CANCELLED',responded_at=v_now,responded_by=p_actor
      WHERE id=v_handover.id RETURNING * INTO v_cancelled;
    PERFORM public.org_audit(p_actor,'pond_handovers',v_handover.id,'UPDATE',to_jsonb(v_handover),to_jsonb(v_cancelled));
  END LOOP;
  UPDATE public.cooperative_households SET ended_at=v_now,ended_by=p_actor WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'cooperative_households',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
    ('org_staff','org_member_permissions','org_pond_operator','org_pond_operations','org_close_pond_assignment',
     'org_set_assignment','org_end_assignment','org_finish_staff_membership','org_leave_staff','org_remove_staff',
     'org_request_pond_handover','org_respond_pond_handover','org_end_pond_handover')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
  END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
