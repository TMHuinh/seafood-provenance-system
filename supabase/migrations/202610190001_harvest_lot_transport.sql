-- Apply after 202610050001_harvest_lots.sql.
-- Transport entries are attached to the harvested lot they physically carry.
BEGIN;
ALTER TABLE public.transport_logs
  ADD COLUMN harvest_lot_id UUID REFERENCES public.harvest_lots(id) ON DELETE RESTRICT,
  ADD COLUMN quantity NUMERIC(14,2),
  ADD COLUMN request_id UUID;

ALTER TABLE public.transport_logs
  ADD CONSTRAINT transport_quantity_positive CHECK (quantity IS NULL OR quantity > 0),
  ADD CONSTRAINT transport_request_unique UNIQUE (request_id);
CREATE INDEX transport_logs_harvest_lot_id_idx ON public.transport_logs(harvest_lot_id);

-- Serialize allocations per lot so parallel requests cannot ship more than was harvested.
CREATE FUNCTION public.record_lot_transport(
  p_batch UUID, p_lot UUID, p_actor UUID, p_request UUID, p_code TEXT,
  p_date TIMESTAMPTZ, p_quantity NUMERIC, p_vehicle TEXT, p_driver TEXT,
  p_from TEXT, p_to TEXT, p_temperature NUMERIC, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE l public.harvest_lots; t public.transport_logs; shipped NUMERIC;
BEGIN
  SELECT * INTO l FROM public.harvest_lots WHERE id = p_lot AND batch_id = p_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing lot' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO t FROM public.transport_logs WHERE request_id = p_request;
  IF FOUND THEN
    IF t.harvest_lot_id <> p_lot OR t.handler_id <> p_actor OR t.quantity <> p_quantity OR t.transport_code <> p_code THEN
      RAISE EXCEPTION 'Request already used' USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object('transport', to_jsonb(t), 'replayed', true);
  END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO shipped FROM public.transport_logs
    WHERE harvest_lot_id = p_lot AND status <> 'CANCELLED';
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> ROUND(p_quantity, 2) OR shipped + p_quantity > l.quantity THEN
    RAISE EXCEPTION 'Transport quantity exceeds available lot quantity' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.transport_logs(batch_id, harvest_lot_id, handler_id, request_id, transport_code,
    transport_date, quantity, vehicle, driver, from_location, to_location, temperature, note)
  VALUES (p_batch, p_lot, p_actor, p_request, p_code, p_date, p_quantity, p_vehicle, p_driver,
    p_from, p_to, p_temperature, p_note) RETURNING * INTO t;
  RETURN jsonb_build_object('transport', to_jsonb(t), 'replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.record_lot_transport(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_lot_transport(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO service_role;
COMMIT;
