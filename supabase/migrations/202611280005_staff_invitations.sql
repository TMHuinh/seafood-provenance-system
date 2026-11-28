BEGIN;

CREATE INDEX organization_staff_email_idx ON public.user_profiles(lower(trim(email)))
  WHERE status AND role='FARMER' AND email IS NOT NULL;

CREATE FUNCTION public.org_invite_staff(p_actor uuid,p_org uuid,p_email text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_candidates uuid[]; v_user uuid; v_inv public.organization_invitations;
  v_expired public.organization_invitations;
BEGIN
  PERFORM public.org_require_manager(p_actor,p_org);
  IF length(coalesce(trim(p_email),'')) NOT BETWEEN 3 AND 255 THEN
    RAISE EXCEPTION 'Email tài khoản không hợp lệ' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(u.id) INTO v_candidates FROM (
    SELECT id FROM public.user_profiles
    WHERE email IS NOT NULL AND lower(trim(email))=lower(trim(p_email)) AND status AND role='FARMER'
    ORDER BY id LIMIT 2 FOR UPDATE
  ) u;
  IF coalesce(cardinality(v_candidates),0)<>1 THEN
    RAISE EXCEPTION 'Không tìm thấy tài khoản người nuôi phù hợp' USING ERRCODE='PT404';
  END IF;
  v_user:=v_candidates[1];
  PERFORM public.org_require_manager(p_actor,p_org);
  IF EXISTS(SELECT FROM public.organization_memberships
    WHERE organization_id=p_org AND user_id=v_user AND tstzrange(starts_at,ends_at,'[)') @> clock_timestamp()) THEN
    RAISE EXCEPTION 'Tài khoản này đã tham gia đơn vị' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO v_inv FROM public.organization_invitations
    WHERE organization_id=p_org AND target_user_id=v_user AND status='PENDING' FOR UPDATE;
  IF v_inv.id IS NOT NULL AND v_inv.expires_at>clock_timestamp() THEN RETURN to_jsonb(v_inv); END IF;
  IF v_inv.id IS NOT NULL THEN
    UPDATE public.organization_invitations SET status='EXPIRED' WHERE id=v_inv.id RETURNING * INTO v_expired;
    PERFORM public.org_audit(p_actor,'organization_invitations',v_inv.id,'UPDATE',to_jsonb(v_inv),to_jsonb(v_expired));
  END IF;
  INSERT INTO public.organization_invitations(organization_id,sender_id,target_user_id,kind,intended_role)
    VALUES(p_org,p_actor,v_user,'STAFF','STAFF') RETURNING * INTO v_inv;
  PERFORM public.org_audit(p_actor,'organization_invitations',v_inv.id,'CREATE',NULL,to_jsonb(v_inv));
  RETURN to_jsonb(v_inv);
END $$;

CREATE FUNCTION public.org_respond_staff_invite(p_actor uuid,p_id uuid,p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_prior public.organization_invitations; v_after public.organization_invitations;
  v_membership public.organization_memberships; v_now timestamptz;
BEGIN
  PERFORM FROM public.user_profiles WHERE id=p_actor AND status AND role='FARMER' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy lời mời' USING ERRCODE='PT404'; END IF;
  SELECT * INTO v_prior FROM public.organization_invitations
    WHERE id=p_id AND target_user_id=p_actor AND kind='STAFF' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy lời mời' USING ERRCODE='PT404'; END IF;
  v_now:=clock_timestamp();
  IF v_prior.status<>'PENDING' OR v_prior.expires_at<=v_now
    OR NOT EXISTS(SELECT FROM public.organizations WHERE id=v_prior.organization_id AND status) THEN
    RAISE EXCEPTION 'Lời mời đã được xử lý hoặc hết hạn' USING ERRCODE='PT409';
  END IF;
  IF p_accept IS NULL THEN RAISE EXCEPTION 'Lựa chọn phản hồi không hợp lệ' USING ERRCODE='22023'; END IF;
  IF p_accept THEN
    IF EXISTS(SELECT FROM public.organization_memberships WHERE organization_id=v_prior.organization_id AND user_id=p_actor
        AND tstzrange(starts_at,ends_at,'[)') @> v_now) THEN
      RAISE EXCEPTION 'Tài khoản này đã tham gia đơn vị' USING ERRCODE='PT409';
    END IF;
    INSERT INTO public.organization_memberships(organization_id,user_id,role,starts_at,granted_by)
      VALUES(v_prior.organization_id,p_actor,'STAFF',v_now,v_prior.sender_id) RETURNING * INTO v_membership;
    PERFORM public.org_audit(p_actor,'organization_memberships',v_membership.id,'CREATE',NULL,to_jsonb(v_membership));
  END IF;
  UPDATE public.organization_invitations
    SET status=CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'REJECTED' END,responded_by=p_actor,responded_at=v_now
    WHERE id=p_id RETURNING * INTO v_after;
  PERFORM public.org_audit(p_actor,'organization_invitations',p_id,'UPDATE',to_jsonb(v_prior),to_jsonb(v_after));
  RETURN to_jsonb(v_after);
END $$;

CREATE OR REPLACE FUNCTION public.org_respond_invite(p_actor uuid,p_id uuid,p_accept boolean,p_share_logs boolean,
  p_batch_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT FROM public.organization_invitations WHERE id=p_id AND target_user_id=p_actor AND kind='STAFF') THEN
    RETURN public.org_respond_staff_invite(p_actor,p_id,p_accept);
  END IF;
  RETURN public.org_respond_household_invite(p_actor,p_id,p_accept,p_share_logs,p_batch_ids);
END $$;

CREATE OR REPLACE FUNCTION public.org_workspace(p_actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('invitations','[]'::jsonb,'memberships',coalesce(jsonb_agg(jsonb_build_object(
   'membership_id',m.id,'organization_id',o.id,'organization_name',o.name,'organization_type',o.type,'organization_address',o.address,
   'role',m.role,'permissions',m.permissions,
   'assigned_ponds',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'farm_id',p.farm_id,
       'pond_name',p.pond_name,'pond_code',p.pond_code,'permissions',a.permissions) ORDER BY p.pond_name,p.id)
     FROM public.pond_assignments a JOIN public.ponds p ON p.id=a.pond_id JOIN public.farms f ON f.id=p.farm_id
     LEFT JOIN public.pond_operating_periods op ON op.pond_id=p.id AND tstzrange(op.starts_at,op.ends_at,'[)') @> statement_timestamp()
     WHERE m.role='STAFF' AND a.organization_id=o.id AND a.user_id=m.user_id
       AND coalesce(op.organization_id,f.organization_id)=o.id
       AND tstzrange(a.starts_at,a.ends_at,'[)') @> statement_timestamp()),'[]'::jsonb)
   ) ORDER BY o.name,o.id),'[]'::jsonb))
 FROM public.organization_memberships m JOIN public.organizations o ON o.id=m.organization_id AND o.status
 JOIN public.user_profiles u ON u.id=m.user_id AND u.status AND u.role='FARMER'
 WHERE m.user_id=p_actor AND tstzrange(m.starts_at,m.ends_at,'[)') @> statement_timestamp();
$$;

REVOKE EXECUTE ON FUNCTION public.org_invite_staff(uuid,uuid,text),
  public.org_respond_staff_invite(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.org_invite_staff(uuid,uuid,text),
  public.org_respond_staff_invite(uuid,uuid,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
