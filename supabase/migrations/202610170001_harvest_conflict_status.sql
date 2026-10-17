-- Business conflicts must return HTTP 409 rather than a retryable serialization error.
BEGIN;
CREATE OR REPLACE FUNCTION public.record_batch_harvest(
  p_batch UUID, p_pond UUID, p_actor UUID, p_request UUID,
  p_date DATE, p_quantity NUMERIC, p_final BOOLEAN, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  b public.batches;
  h public.harvests;
  l public.harvest_lots;
  f public.farms;
  p public.ponds;
  lot_id UUID := gen_random_uuid();
  origin JSONB;
BEGIN
  SELECT * INTO b FROM public.batches WHERE id = p_batch AND pond_id = p_pond FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing batch' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO p FROM public.ponds WHERE id = p_pond;
  SELECT * INTO f FROM public.farms WHERE id = p.farm_id AND owner_id = p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing owned farm' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO l FROM public.harvest_lots WHERE request_id = p_request;
  IF FOUND THEN
    SELECT * INTO h FROM public.harvests WHERE id = l.harvest_id;
    IF l.batch_id <> p_batch OR h.created_by <> p_actor OR
      (h.harvest_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE IS DISTINCT FROM p_date OR
      h.quantity IS DISTINCT FROM p_quantity OR h.is_final IS DISTINCT FROM p_final OR
      h.note IS DISTINCT FROM NULLIF(BTRIM(p_note), '') THEN
      RAISE EXCEPTION 'Request already used' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('batch', to_jsonb(b), 'harvest', to_jsonb(h), 'lot', to_jsonb(l), 'replayed', true);
  END IF;
  IF b.status NOT IN ('GROWING', 'READY_FOR_HARVEST') THEN
    RAISE EXCEPTION 'Batch cannot be harvested' USING ERRCODE = 'PT409';
  END IF;
  IF p_request IS NULL OR p_final IS NULL OR p_quantity IS NULL OR p_quantity <= 0 OR
    p_quantity > 999999999999.99 OR p_quantity <> ROUND(p_quantity, 2) OR
    p_date IS NULL OR p_date < (b.stocking_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE OR
    p_date > (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE OR LENGTH(p_note) > 5000 OR
    (p_final AND EXISTS (SELECT 1 FROM public.harvests WHERE batch_id = b.id AND
      (harvest_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE > p_date)) THEN
    RAISE EXCEPTION 'Invalid harvest' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.harvests(batch_id, harvest_date, quantity, created_by, note, is_final)
    VALUES (b.id, GREATEST(b.stocking_date, p_date::TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh'), p_quantity, p_actor, NULLIF(BTRIM(p_note), ''), p_final)
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
    VALUES (b.id, b.current_version, to_jsonb(b), 'Ghi nhận thu hoạch ' || l.lot_code, p_actor, l.blockchain_event_id);
  RETURN jsonb_build_object('batch', to_jsonb(b), 'harvest', to_jsonb(h), 'lot', to_jsonb(l), 'replayed', false);
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
