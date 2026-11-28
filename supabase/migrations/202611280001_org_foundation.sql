-- migrate:up
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations,
  user_id uuid NOT NULL REFERENCES public.user_profiles,
  role text NOT NULL CHECK (role IN ('MANAGER','REPRESENTATIVE','STAFF')),
  permissions text[] NOT NULL DEFAULT '{}' CHECK (permissions <@ ARRAY['LOG_CONFIRM','HARVEST_CONFIRM'] AND array_position(permissions,NULL) IS NULL),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  granted_by uuid REFERENCES public.user_profiles,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  EXCLUDE USING gist (user_id WITH =, organization_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
);
CREATE INDEX organization_memberships_org_idx ON public.organization_memberships (organization_id,user_id);
CREATE TRIGGER organization_memberships_updated BEFORE UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_traceability_updated_at();

-- The original owning organization stays on the farm. Periods record explicit changes of operator.
CREATE TABLE public.pond_operating_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id uuid NOT NULL REFERENCES public.ponds,
  organization_id uuid NOT NULL REFERENCES public.organizations,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  granted_by uuid NOT NULL REFERENCES public.user_profiles,
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  EXCLUDE USING gist (pond_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
);
CREATE TABLE public.pond_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id uuid NOT NULL REFERENCES public.ponds,
  organization_id uuid NOT NULL REFERENCES public.organizations,
  user_id uuid NOT NULL REFERENCES public.user_profiles,
  permissions text[] NOT NULL CHECK (permissions <@ ARRAY['READ','BATCH_CREATE','BATCH_EDIT','LOG_CREATE','LOG_EDIT','LOG_CONFIRM','HARVEST_CREATE','HARVEST_EDIT','HARVEST_CONFIRM']
    AND 'READ' = ANY(permissions) AND array_position(permissions,NULL) IS NULL),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  granted_by uuid NOT NULL REFERENCES public.user_profiles,
  note text CHECK (length(note) <= 2000),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  EXCLUDE USING gist (pond_id WITH =, tstzrange(starts_at,ends_at,'[)') WITH &&)
);
CREATE INDEX pond_assignments_by_user ON public.pond_assignments(user_id,organization_id,starts_at);

-- An existing organization link proves affiliation only. It never proves representation.
INSERT INTO public.organization_memberships(organization_id,user_id,role)
SELECT o.id,u.id,'STAFF' FROM public.user_profiles u JOIN public.organizations o ON o.id=u.organization_id
WHERE u.role='FARMER' AND o.type IN ('COOPERATIVE','FARMER_HOUSEHOLD');

CREATE VIEW public.org_legacy_review AS
SELECT 'VERIFY_REPRESENTATIVE'::text AS issue,o.id AS organization_id,NULL::uuid AS resource_id
FROM public.organizations o WHERE o.type IN ('COOPERATIVE','FARMER_HOUSEHOLD')
AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m JOIN public.user_profiles u ON u.id=m.user_id
  WHERE m.organization_id=o.id AND u.role='FARMER' AND u.status
  AND ((o.type='COOPERATIVE' AND m.role='MANAGER') OR (o.type='FARMER_HOUSEHOLD' AND m.role='REPRESENTATIVE'))
  AND tstzrange(m.starts_at,m.ends_at,'[)') @> now())
UNION ALL
SELECT 'UNLINKED_FARM',NULL,f.id FROM public.farms f WHERE f.organization_id IS NULL
UNION ALL
SELECT 'UNSUPPORTED_FARM_ORGANIZATION',o.id,f.id FROM public.farms f JOIN public.organizations o ON o.id=f.organization_id
WHERE o.type NOT IN ('COOPERATIVE','FARMER_HOUSEHOLD');

CREATE FUNCTION public.org_is_manager(p_actor uuid,p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS (SELECT FROM public.organization_memberships m
 JOIN public.user_profiles u ON u.id=m.user_id JOIN public.organizations o ON o.id=m.organization_id
 WHERE m.user_id=p_actor AND m.organization_id=p_org AND u.status AND u.role='FARMER' AND o.status
 AND ((o.type='COOPERATIVE' AND m.role='MANAGER') OR (o.type='FARMER_HOUSEHOLD' AND m.role='REPRESENTATIVE'))
 AND tstzrange(m.starts_at,m.ends_at,'[)') @> now());
$$;

CREATE FUNCTION public.farm_manageable(p_actor uuid) RETURNS TABLE(farm_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT f.id FROM public.farms f JOIN public.user_profiles u ON u.id=p_actor AND u.status
 LEFT JOIN public.organizations o ON o.id=f.organization_id
 WHERE (u.role='ADMIN' AND u.id=f.owner_id AND (f.organization_id IS NULL OR o.type NOT IN ('COOPERATIVE','FARMER_HOUSEHOLD')))
    OR (u.role='FARMER' AND (u.id=f.owner_id OR public.org_is_manager(u.id,f.organization_id)));
$$;
CREATE FUNCTION public.farm_can_manage(p_actor uuid,p_farm uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS (SELECT FROM public.farm_manageable(p_actor) f WHERE f.farm_id=p_farm);
$$;
CREATE FUNCTION public.farm_org_can_create(p_actor uuid,p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT public.org_is_manager(p_actor,p_org) OR EXISTS (
   SELECT FROM public.user_profiles u JOIN public.organizations o ON o.id=u.organization_id
   WHERE u.id=p_actor AND u.status AND u.role IN ('ADMIN','FARMER') AND o.id=p_org AND o.status
   AND o.type NOT IN ('COOPERATIVE','FARMER_HOUSEHOLD'));
$$;

CREATE FUNCTION public.pond_accessible(p_actor uuid,p_action text) RETURNS TABLE(pond_id uuid,farm_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT p.id,f.id FROM public.ponds p JOIN public.farms f ON f.id=p.farm_id
 JOIN public.user_profiles u ON u.id=p_actor AND u.status AND u.role IN ('ADMIN','FARMER')
 LEFT JOIN public.organizations owner_org ON owner_org.id=f.organization_id
 LEFT JOIN public.pond_operating_periods op ON op.pond_id=p.id AND tstzrange(op.starts_at,op.ends_at,'[)') @> now()
 LEFT JOIN public.organizations o ON o.id=coalesce(op.organization_id,f.organization_id) AND o.status
 LEFT JOIN public.organization_memberships m ON m.organization_id=o.id AND m.user_id=u.id
   AND tstzrange(m.starts_at,m.ends_at,'[)') @> now()
 LEFT JOIN public.pond_assignments a ON a.pond_id=p.id AND a.organization_id=m.organization_id AND a.user_id=m.user_id
   AND tstzrange(a.starts_at,a.ends_at,'[)') @> now()
 WHERE p_action=ANY(ARRAY['READ','MANAGE','BATCH_CREATE','BATCH_EDIT','LOG_CREATE','LOG_EDIT','LOG_CONFIRM','HARVEST_CREATE','HARVEST_EDIT','HARVEST_CONFIRM'])
 AND ((u.role='ADMIN' AND (f.organization_id IS NULL OR owner_org.type NOT IN ('COOPERATIVE','FARMER_HOUSEHOLD'))
       AND (op.id IS NULL OR op.organization_id=f.organization_id)
       AND (u.id=f.owner_id OR p_action IN ('READ','LOG_CREATE','LOG_EDIT','LOG_CONFIRM')))
   OR (u.role='FARMER' AND (
       (u.id=f.owner_id AND (op.id IS NULL OR op.organization_id=f.organization_id)
       AND (p_action NOT IN ('LOG_CONFIRM','HARVEST_CONFIRM') OR f.organization_id IS NULL
            OR o.type NOT IN ('COOPERATIVE','FARMER_HOUSEHOLD') OR p_action=ANY(m.permissions)))
   OR (p_action='READ' AND (u.id=f.owner_id OR public.org_is_manager(u.id,f.organization_id)))
   OR (((m.role='MANAGER' AND o.type='COOPERATIVE') OR (m.role='REPRESENTATIVE' AND o.type='FARMER_HOUSEHOLD'))
      AND (p_action NOT IN ('LOG_CONFIRM','HARVEST_CONFIRM') OR p_action=ANY(m.permissions)))
   OR p_action=ANY(a.permissions))));
$$;
CREATE FUNCTION public.pond_can(p_actor uuid,p_pond uuid,p_action text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS (SELECT FROM public.pond_accessible(p_actor,p_action) x WHERE x.pond_id=p_pond);
$$;

CREATE FUNCTION public.org_workspace(p_actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('invitations','[]'::jsonb,'memberships',coalesce(jsonb_agg(jsonb_build_object(
   'organization_id',o.id,'organization_name',o.name,'organization_type',o.type,'organization_address',o.address,
   'role',m.role,'permissions',m.permissions) ORDER BY o.name,o.id),'[]'::jsonb))
 FROM public.organization_memberships m JOIN public.organizations o ON o.id=m.organization_id AND o.status
 JOIN public.user_profiles u ON u.id=m.user_id AND u.status AND u.role='FARMER'
 WHERE m.user_id=p_actor AND tstzrange(m.starts_at,m.ends_at,'[)') @> now();
$$;

CREATE FUNCTION public.register_production_profile(p_user uuid,p_name text,p_email text,p_phone text,p_role public.user_role,
 p_wallet text,p_org_name text,p_org_type public.organization_type,p_org_address text)
RETURNS public.user_profiles LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE v_org public.organizations; v_user public.user_profiles; v_membership public.organization_memberships;
BEGIN
 IF p_role IS NULL OR p_role='ADMIN' THEN RAISE EXCEPTION 'Vai trò đăng ký không hợp lệ' USING ERRCODE='22023'; END IF;
 IF nullif(trim(p_org_name),'') IS NOT NULL THEN
   INSERT INTO public.organizations(name,type,address) VALUES (trim(p_org_name),coalesce(p_org_type,'COMPANY'),p_org_address) RETURNING * INTO v_org;
 END IF;
 INSERT INTO public.user_profiles(id,full_name,email,phone,role,wallet_address,organization_id)
 VALUES (p_user,trim(p_name),lower(trim(p_email)),p_phone,p_role,p_wallet,v_org.id) RETURNING * INTO v_user;
 IF p_role='FARMER' AND v_org.type IN ('COOPERATIVE','FARMER_HOUSEHOLD') THEN
   INSERT INTO public.organization_memberships(user_id,organization_id,role,granted_by)
   VALUES (p_user,v_org.id,CASE WHEN v_org.type='COOPERATIVE' THEN 'MANAGER' ELSE 'REPRESENTATIVE' END,p_user) RETURNING * INTO v_membership;
   INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,new_data)
   VALUES(p_user,'organization_memberships',v_membership.id,'CREATE',to_jsonb(v_membership));
 END IF;
 RETURN v_user;
END $$;

CREATE FUNCTION public.org_provision_manager(p_actor uuid,p_org uuid,p_user uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE org public.organizations; previous public.organization_memberships; result public.organization_memberships; wanted_role text;
BEGIN
 IF NOT EXISTS(SELECT FROM public.user_profiles WHERE id=p_actor AND status AND role='ADMIN') THEN
   RAISE EXCEPTION 'Chỉ quản trị viên được xác minh đại diện' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT org FROM public.organizations WHERE id=p_org AND status AND type IN ('COOPERATIVE','FARMER_HOUSEHOLD') FOR UPDATE;
 PERFORM 1 FROM public.user_profiles WHERE id=p_user AND status AND role='FARMER' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tài khoản người nuôi không hợp lệ' USING ERRCODE='22023'; END IF;
 wanted_role := CASE WHEN org.type='COOPERATIVE' THEN 'MANAGER' ELSE 'REPRESENTATIVE' END;
 SELECT * INTO previous FROM public.organization_memberships WHERE organization_id=p_org AND user_id=p_user
 AND tstzrange(starts_at,ends_at,'[)') @> now() FOR UPDATE;
 IF previous.role=wanted_role THEN RETURN previous.id; END IF;
 IF previous.id IS NOT NULL THEN
   UPDATE public.organization_memberships SET ends_at=now() WHERE id=previous.id;
 END IF;
 INSERT INTO public.organization_memberships(organization_id,user_id,role,granted_by)
 VALUES (p_org,p_user,wanted_role,p_actor) RETURNING * INTO result;
 INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
 VALUES (p_actor,'organization_memberships',result.id,'CREATE',CASE WHEN previous.id IS NOT NULL THEN to_jsonb(previous) END,to_jsonb(result));
 RETURN result.id;
END $$;

-- Frontend uses Express, including public QR lookup. Protect underlying tables from direct Data API access.
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['organizations','user_profiles','farms','ponds','batches','batch_versions','farming_logs',
  'farming_log_versions','harvests','harvest_lots','transport_logs','distribution_logs','blockchain_records','qr_codes',
  'audit_logs','alerts','organization_memberships','pond_operating_periods','pond_assignments'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 END LOOP;
END $$;
REVOKE ALL ON public.org_legacy_review FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.org_legacy_review TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.organization_memberships,public.pond_operating_periods,public.pond_assignments TO service_role;
GRANT SELECT,INSERT ON public.audit_logs TO service_role;
DO $$
DECLARE fn regprocedure;
BEGIN
 FOR fn IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('org_is_manager','pond_accessible','pond_can','farm_manageable','farm_can_manage','farm_org_can_create','org_workspace','org_provision_manager','register_production_profile')
 LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
 END LOOP;
END $$;
COMMIT;
