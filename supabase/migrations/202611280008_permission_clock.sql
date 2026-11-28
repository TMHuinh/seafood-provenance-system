BEGIN;

CREATE FUNCTION public.org_is_manager_at(p_actor uuid,p_org uuid,p_at timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS (SELECT FROM public.organization_memberships m
 JOIN public.user_profiles u ON u.id=m.user_id JOIN public.organizations o ON o.id=m.organization_id
 WHERE m.user_id=p_actor AND m.organization_id=p_org AND u.status AND u.role='FARMER' AND o.status
 AND ((o.type='COOPERATIVE' AND m.role='MANAGER') OR (o.type='FARMER_HOUSEHOLD' AND m.role='REPRESENTATIVE'))
 AND tstzrange(m.starts_at,m.ends_at,'[)') @> p_at);
$$;

CREATE OR REPLACE FUNCTION public.org_is_manager(p_actor uuid,p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT public.org_is_manager_at(p_actor,p_org,clock_timestamp());
$$;

CREATE OR REPLACE FUNCTION public.pond_accessible(p_actor uuid,p_action text) RETURNS TABLE(pond_id uuid,farm_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 -- A serialized mutation can wait for a pond lock across a scheduled or explicit
 -- permission change. All range checks in this lookup use the same current instant.
 WITH permission_time AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
 SELECT p.id,f.id FROM permission_time
 CROSS JOIN public.ponds p JOIN public.farms f ON f.id=p.farm_id
 JOIN public.user_profiles u ON u.id=p_actor AND u.status AND u.role IN ('ADMIN','FARMER')
 LEFT JOIN public.organizations owner_org ON owner_org.id=f.organization_id
 LEFT JOIN public.pond_operating_periods op ON op.pond_id=p.id AND tstzrange(op.starts_at,op.ends_at,'[)') @> checked_at
 LEFT JOIN public.organizations o ON o.id=coalesce(op.organization_id,f.organization_id) AND o.status
 LEFT JOIN public.organization_memberships m ON m.organization_id=o.id AND m.user_id=u.id
   AND tstzrange(m.starts_at,m.ends_at,'[)') @> checked_at
 LEFT JOIN public.pond_assignments a ON a.pond_id=p.id AND a.organization_id=m.organization_id AND a.user_id=m.user_id
   AND tstzrange(a.starts_at,a.ends_at,'[)') @> checked_at
 WHERE p_action=ANY(ARRAY['READ','MANAGE','BATCH_CREATE','BATCH_EDIT','LOG_CREATE','LOG_EDIT','LOG_CONFIRM','HARVEST_CREATE','HARVEST_EDIT','HARVEST_CONFIRM'])
 AND ((u.role='ADMIN' AND (f.organization_id IS NULL OR owner_org.type NOT IN ('COOPERATIVE','FARMER_HOUSEHOLD'))
       AND (op.id IS NULL OR op.organization_id=f.organization_id)
       AND (u.id=f.owner_id OR p_action IN ('READ','LOG_CREATE','LOG_EDIT','LOG_CONFIRM')))
   OR (u.role='FARMER' AND (
       (u.id=f.owner_id AND (op.id IS NULL OR op.organization_id=f.organization_id)
       AND (p_action NOT IN ('LOG_CONFIRM','HARVEST_CONFIRM') OR f.organization_id IS NULL
            OR o.type NOT IN ('COOPERATIVE','FARMER_HOUSEHOLD') OR p_action=ANY(m.permissions)))
   OR (p_action='READ' AND (u.id=f.owner_id OR public.org_is_manager_at(u.id,f.organization_id,checked_at)))
   OR (((m.role='MANAGER' AND o.type='COOPERATIVE') OR (m.role='REPRESENTATIVE' AND o.type='FARMER_HOUSEHOLD'))
      AND (p_action NOT IN ('LOG_CONFIRM','HARVEST_CONFIRM') OR p_action=ANY(m.permissions)))
   OR p_action=ANY(a.permissions))));
$$;

REVOKE ALL ON FUNCTION public.org_is_manager_at(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.org_is_manager_at(uuid,uuid,timestamptz) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
