BEGIN;

-- Scope in SQL before PostgREST applies embedded filters, counts and pagination.
CREATE FUNCTION public.production_batches(p_actor uuid)
RETURNS SETOF public.batches LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT b.* FROM public.batches b
  JOIN public.pond_accessible(p_actor,'READ') a ON a.pond_id=b.pond_id
$$;
CREATE FUNCTION public.production_lots(p_actor uuid)
RETURNS SETOF public.harvest_lots LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT l.* FROM public.harvest_lots l
  JOIN public.production_batches(p_actor) b ON b.id=l.batch_id
$$;
CREATE FUNCTION public.production_harvests(p_actor uuid)
RETURNS SETOF public.harvests LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT h.* FROM public.harvests h
  JOIN public.production_batches(p_actor) b ON b.id=h.batch_id
$$;
CREATE FUNCTION public.production_farms(p_actor uuid)
RETURNS TABLE(id uuid, owner_id uuid, organization_id uuid, farm_name text, address text,
  area numeric, certification text, status boolean, created_at timestamptz, updated_at timestamptz, can_manage boolean)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH managed AS (SELECT farm_id FROM public.farm_manageable(p_actor)),
  visible AS (SELECT farm_id FROM managed UNION SELECT farm_id FROM public.pond_accessible(p_actor,'READ'))
  SELECT f.id, CASE WHEN m.farm_id IS NOT NULL THEN f.owner_id END, f.organization_id, f.farm_name::text,
    CASE WHEN m.farm_id IS NOT NULL THEN f.address::text END, CASE WHEN m.farm_id IS NOT NULL THEN f.area END,
    CASE WHEN m.farm_id IS NOT NULL THEN f.certification::text END, f.status, f.created_at, f.updated_at, m.farm_id IS NOT NULL
  FROM public.farms f JOIN visible v ON v.farm_id=f.id LEFT JOIN managed m ON m.farm_id=f.id
$$;
CREATE FUNCTION public.production_ponds(p_actor uuid)
RETURNS TABLE(id uuid, farm_id uuid, pond_code text, pond_name text, area numeric, depth numeric,
  water_type text, status text, created_at timestamptz, updated_at timestamptz, permissions text[])
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id,p.farm_id,p.pond_code::text,p.pond_name::text,p.area,p.depth,p.water_type::text,p.status::text,
    p.created_at,p.updated_at,ARRAY(SELECT action FROM unnest(ARRAY['READ','MANAGE','BATCH_CREATE','BATCH_EDIT','LOG_CREATE',
      'LOG_EDIT','LOG_CONFIRM','HARVEST_CREATE','HARVEST_EDIT','HARVEST_CONFIRM']) action
      WHERE public.pond_can(p_actor,p.id,action))
  FROM public.ponds p JOIN public.pond_accessible(p_actor,'READ') a ON a.pond_id=p.id
$$;

REVOKE EXECUTE ON FUNCTION public.production_batches(uuid),public.production_lots(uuid),public.production_harvests(uuid),
  public.production_farms(uuid),public.production_ponds(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_batches(uuid),public.production_lots(uuid),public.production_harvests(uuid),
  public.production_farms(uuid),public.production_ponds(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
