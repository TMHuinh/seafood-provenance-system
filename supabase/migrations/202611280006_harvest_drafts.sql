BEGIN;

CREATE FUNCTION public.commit_pond_harvest(
  p_batch UUID, p_pond UUID, p_creator UUID, p_confirmer UUID, p_request UUID,
  p_date DATE, p_quantity NUMERIC, p_final BOOLEAN, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SET search_path = pg_catalog,public AS $$
DECLARE
  b public.batches;
  h public.harvests;
  l public.harvest_lots;
  f public.farms;
  p public.ponds;
  lot_id UUID := gen_random_uuid();
  origin JSONB;
BEGIN
  SELECT * INTO p FROM public.ponds WHERE id = p_pond FOR UPDATE;
  IF NOT FOUND OR NOT public.pond_can(p_confirmer,p_pond,'HARVEST_CONFIRM') THEN
    RAISE EXCEPTION 'Missing accessible pond' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO b FROM public.batches WHERE id = p_batch AND pond_id = p_pond FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing batch' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO STRICT f FROM public.farms WHERE id = p.farm_id;

  SELECT * INTO l FROM public.harvest_lots WHERE request_id = p_request;
  IF FOUND THEN
    SELECT * INTO h FROM public.harvests WHERE id = l.harvest_id;
    IF l.batch_id <> p_batch OR h.created_by <> p_creator OR
      (h.harvest_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE IS DISTINCT FROM p_date OR
      h.quantity IS DISTINCT FROM p_quantity OR h.is_final IS DISTINCT FROM p_final OR
      h.note IS DISTINCT FROM NULLIF(BTRIM(p_note), '') THEN
      RAISE EXCEPTION 'Request already used' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('batch', to_jsonb(b), 'harvest', to_jsonb(h), 'lot', to_jsonb(l), 'replayed', true);
  END IF;
  PERFORM public.validate_harvest_draft(b,p_date,p_quantity,p_final,p_note);
  IF p_request IS NULL OR
    (p_final AND EXISTS (SELECT 1 FROM public.harvests WHERE batch_id = b.id AND
      (harvest_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE > p_date)) THEN
    RAISE EXCEPTION 'Invalid harvest' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.harvests(batch_id, harvest_date, quantity, created_by, note, is_final)
    VALUES (b.id, GREATEST(b.stocking_date, p_date::TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh'), p_quantity, p_creator, NULLIF(BTRIM(p_note), ''), p_final)
    RETURNING * INTO h;
  origin := jsonb_build_object(
    'lotId', lot_id, 'lotCode', 'LO-' || UPPER(lot_id::TEXT),
    'batch', to_jsonb(b), 'harvest', to_jsonb(h),
    'farm', jsonb_build_object('id', f.id, 'name', f.farm_name, 'address', f.address,
      'organizationId', f.organization_id, 'ownerId', f.owner_id),
    'pond', jsonb_build_object('id', p.id, 'code', p.pond_code, 'name', p.pond_name)
  );
  INSERT INTO public.harvest_lots(id, lot_code, batch_id, harvest_id, request_id, quantity, provenance, blockchain_event_id)
    VALUES (lot_id, 'LO-' || UPPER(lot_id::TEXT), b.id, h.id, p_request, p_quantity, origin, 'HARVEST_RECORDED:' || h.id::TEXT)
    RETURNING * INTO l;
  UPDATE public.batches SET
    yield_quantity = (SELECT SUM(quantity) FROM public.harvests WHERE batch_id = b.id),
    actual_harvest_date = CASE WHEN p_final THEN h.harvest_date ELSE NULL END,
    status = CASE WHEN p_final THEN 'HARVESTED'::public.batch_status ELSE b.status END,
    current_version = current_version + 1
    WHERE id = b.id RETURNING * INTO b;
  INSERT INTO public.batch_versions(batch_id, version_number, snapshot, correction_reason, corrected_by, blockchain_event_id)
    VALUES (b.id, b.current_version, to_jsonb(b), 'Ghi nhận thu hoạch ' || l.lot_code, p_confirmer, l.blockchain_event_id);
  PERFORM public.org_audit(p_confirmer,'HARVEST',h.id,'CONFIRM',NULL,to_jsonb(h));
  RETURN jsonb_build_object('batch', to_jsonb(b), 'harvest', to_jsonb(h), 'lot', to_jsonb(l), 'replayed', false);
END;
$$;

-- Drafts remain separate from the append-only harvest/lot provenance.
CREATE TABLE public.harvest_drafts (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.batches(id),
  harvest_date date NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0 AND quantity <= 999999999999.99 AND quantity = round(quantity,2)),
  is_final boolean NOT NULL,
  note text CHECK (length(note) <= 5000),
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  confirmed_harvest_id uuid UNIQUE REFERENCES public.harvests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX harvest_drafts_open_by_batch ON public.harvest_drafts(batch_id,created_at) WHERE confirmed_harvest_id IS NULL;
CREATE TRIGGER harvest_drafts_updated BEFORE UPDATE ON public.harvest_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_traceability_updated_at();
ALTER TABLE public.harvest_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.harvest_drafts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.harvest_drafts TO service_role;

CREATE FUNCTION public.require_harvest_batch(p_batch uuid,p_pond uuid,p_actor uuid,p_action text) RETURNS public.batches
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b public.batches;
BEGIN
  PERFORM 1 FROM public.ponds WHERE id=p_pond FOR UPDATE;
  IF NOT FOUND OR NOT public.pond_can(p_actor,p_pond,p_action) THEN
    RAISE EXCEPTION 'Missing accessible batch' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO b FROM public.batches WHERE id=p_batch AND pond_id=p_pond FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing accessible batch' USING ERRCODE='P0002'; END IF;
  RETURN b;
END
$$;

CREATE FUNCTION public.validate_harvest_draft(p_batch public.batches,p_date date,p_quantity numeric,p_final boolean,p_note text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_batch.status NOT IN ('GROWING','READY_FOR_HARVEST') THEN
    RAISE EXCEPTION 'Batch cannot be harvested' USING ERRCODE='PT409';
  END IF;
  IF p_date IS NULL OR p_date < (p_batch.stocking_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    OR p_date > (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date OR p_quantity IS NULL OR p_quantity <= 0
    OR p_quantity > 999999999999.99 OR round(p_quantity,2) <> p_quantity OR p_final IS NULL OR length(p_note) > 5000 THEN
    RAISE EXCEPTION 'Invalid harvest' USING ERRCODE='22023';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.record_batch_harvest(p_batch uuid,p_pond uuid,p_actor uuid,p_request uuid,
  p_date date,p_quantity numeric,p_final boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.require_harvest_batch(p_batch,p_pond,p_actor,'HARVEST_CREATE');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  IF EXISTS(SELECT FROM public.harvest_drafts WHERE id=p_request) THEN
    RAISE EXCEPTION 'Request already used' USING ERRCODE='PT409';
  END IF;
  RETURN public.commit_pond_harvest(p_batch,p_pond,p_actor,p_actor,p_request,p_date,p_quantity,p_final,p_note);
END
$$;

CREATE FUNCTION public.create_harvest_draft(p_batch uuid,p_pond uuid,p_actor uuid,p_request uuid,p_date date,
  p_quantity numeric,p_final boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b public.batches; d public.harvest_drafts;
BEGIN
  b := public.require_harvest_batch(p_batch,p_pond,p_actor,'HARVEST_CREATE');
  IF p_request IS NULL THEN RAISE EXCEPTION 'Missing request ID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  SELECT * INTO d FROM public.harvest_drafts WHERE id=p_request FOR UPDATE;
  IF FOUND THEN
    IF d.batch_id = p_batch AND d.created_by = p_actor AND d.harvest_date = p_date
      AND d.quantity = p_quantity AND d.is_final = p_final AND d.note IS NOT DISTINCT FROM nullif(btrim(p_note),'')
      AND d.version = 1 AND d.confirmed_harvest_id IS NULL THEN
      RETURN to_jsonb(d);
    END IF;
    RAISE EXCEPTION 'Request already used' USING ERRCODE='PT409';
  END IF;
  IF EXISTS(SELECT FROM public.harvest_lots WHERE request_id=p_request) THEN
    RAISE EXCEPTION 'Request already used' USING ERRCODE='PT409';
  END IF;
  PERFORM public.validate_harvest_draft(b,p_date,p_quantity,p_final,p_note);
  INSERT INTO public.harvest_drafts(id,batch_id,harvest_date,quantity,is_final,note,created_by)
  VALUES(p_request,p_batch,p_date,p_quantity,p_final,nullif(btrim(p_note),''),p_actor) RETURNING * INTO d;
  PERFORM public.org_audit(p_actor,'HARVEST_DRAFT',d.id,'CREATE',NULL,to_jsonb(d));
  RETURN to_jsonb(d);
END
$$;

CREATE FUNCTION public.edit_harvest_draft(p_batch uuid,p_pond uuid,p_actor uuid,p_draft uuid,p_version integer,
  p_date date,p_quantity numeric,p_final boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE b public.batches; before public.harvest_drafts; d public.harvest_drafts;
BEGIN
  b := public.require_harvest_batch(p_batch,p_pond,p_actor,'HARVEST_EDIT');
  SELECT * INTO before FROM public.harvest_drafts WHERE id=p_draft AND batch_id=p_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing draft' USING ERRCODE='P0002'; END IF;
  IF before.version IS DISTINCT FROM p_version OR before.confirmed_harvest_id IS NOT NULL THEN
    RAISE EXCEPTION 'Harvest draft changed or confirmed' USING ERRCODE='PT409';
  END IF;
  PERFORM public.validate_harvest_draft(b,p_date,p_quantity,p_final,p_note);
  UPDATE public.harvest_drafts SET harvest_date=p_date,quantity=p_quantity,is_final=p_final,note=nullif(btrim(p_note),''),
    version=version+1 WHERE id=before.id RETURNING * INTO d;
  PERFORM public.org_audit(p_actor,'HARVEST_DRAFT',d.id,'UPDATE',to_jsonb(before),to_jsonb(d));
  RETURN to_jsonb(d);
END
$$;

CREATE FUNCTION public.confirm_harvest_draft(p_batch uuid,p_pond uuid,p_actor uuid,p_draft uuid,p_version integer) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE d public.harvest_drafts; result jsonb;
BEGIN
  PERFORM public.require_harvest_batch(p_batch,p_pond,p_actor,'HARVEST_CONFIRM');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_draft::text,0));
  SELECT * INTO d FROM public.harvest_drafts WHERE id=p_draft AND batch_id=p_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing draft' USING ERRCODE='P0002'; END IF;
  IF d.version IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'Harvest draft changed' USING ERRCODE='PT409';
  END IF;
  result := public.commit_pond_harvest(p_batch,p_pond,d.created_by,p_actor,d.id,d.harvest_date,d.quantity,d.is_final,d.note);
  IF d.confirmed_harvest_id IS NULL THEN
    UPDATE public.harvest_drafts SET confirmed_harvest_id=(result->'harvest'->>'id')::uuid WHERE id=d.id;
  END IF;
  RETURN result;
END
$$;

CREATE FUNCTION public.harvest_actor_names(p_actor uuid,p_batch uuid,p_pond uuid)
RETURNS TABLE(harvest_id uuid,author_name text,confirmer_name text)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT h.id,a.full_name::text,c.full_name::text
  FROM public.harvest_lots l JOIN public.harvests h ON h.id=l.harvest_id
  JOIN public.batches b ON b.id=h.batch_id AND b.pond_id=p_pond
  LEFT JOIN public.user_profiles a ON a.id=h.created_by
  LEFT JOIN LATERAL (
    SELECT al.user_id FROM public.audit_logs al
    WHERE al.entity_id=h.id AND al.entity_type='HARVEST' AND al.action='CONFIRM'
    ORDER BY al.created_at DESC LIMIT 1
  ) verifier ON true
  LEFT JOIN public.user_profiles c ON c.id=verifier.user_id
  WHERE b.id=p_batch AND public.pond_can(p_actor,p_pond,'READ')
  ORDER BY l.created_at DESC,l.id
$$;

REVOKE ALL ON FUNCTION
  public.commit_pond_harvest(uuid,uuid,uuid,uuid,uuid,date,numeric,boolean,text),
  public.require_harvest_batch(uuid,uuid,uuid,text),
  public.validate_harvest_draft(public.batches,date,numeric,boolean,text),
  public.create_harvest_draft(uuid,uuid,uuid,uuid,date,numeric,boolean,text),
  public.edit_harvest_draft(uuid,uuid,uuid,uuid,integer,date,numeric,boolean,text),
  public.confirm_harvest_draft(uuid,uuid,uuid,uuid,integer),
  public.harvest_actor_names(uuid,uuid,uuid)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.commit_pond_harvest(uuid,uuid,uuid,uuid,uuid,date,numeric,boolean,text),
  public.require_harvest_batch(uuid,uuid,uuid,text),
  public.validate_harvest_draft(public.batches,date,numeric,boolean,text),
  public.create_harvest_draft(uuid,uuid,uuid,uuid,date,numeric,boolean,text),
  public.edit_harvest_draft(uuid,uuid,uuid,uuid,integer,date,numeric,boolean,text),
  public.confirm_harvest_draft(uuid,uuid,uuid,uuid,integer),
  public.harvest_actor_names(uuid,uuid,uuid)
TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
