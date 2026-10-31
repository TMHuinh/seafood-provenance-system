-- Add an explicit request owner and transporter claim workflow.
BEGIN;
ALTER TABLE public.transport_logs
  ADD COLUMN created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN claimed_at TIMESTAMPTZ;

UPDATE public.transport_logs SET created_by = handler_id WHERE created_by IS NULL;
UPDATE public.transport_logs t SET handler_id = NULL
  FROM public.user_profiles p
  WHERE t.handler_id = p.id AND p.role <> 'TRANSPORTER' AND t.status = 'PLANNING';

CREATE OR REPLACE FUNCTION public.record_lot_transport(
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
    IF t.harvest_lot_id <> p_lot OR t.created_by IS DISTINCT FROM p_actor OR t.quantity <> p_quantity OR t.transport_code <> p_code THEN
      RAISE EXCEPTION 'Request already used' USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object('transport', to_jsonb(t), 'replayed', true);
  END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO shipped FROM public.transport_logs
    WHERE harvest_lot_id = p_lot AND status <> 'CANCELLED';
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> ROUND(p_quantity, 2) OR shipped + p_quantity > l.quantity THEN
    RAISE EXCEPTION 'Transport quantity exceeds available lot quantity' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.transport_logs(batch_id, harvest_lot_id, created_by, handler_id, request_id, transport_code,
    transport_date, quantity, vehicle, driver, from_location, to_location, temperature, note)
  VALUES (p_batch, p_lot, p_actor, NULL, p_request, p_code, p_date, p_quantity, p_vehicle, p_driver,
    p_from, p_to, p_temperature, p_note) RETURNING * INTO t;
  RETURN jsonb_build_object('transport', to_jsonb(t), 'replayed', false);
END;
$$;

CREATE FUNCTION public.claim_lot_transport(p_transport UUID, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE t public.transport_logs;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_actor AND role = 'TRANSPORTER' AND status = TRUE) THEN
    RAISE EXCEPTION 'Transporter role required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.transport_logs SET handler_id = p_actor, claimed_at = NOW()
    WHERE id = p_transport AND handler_id IS NULL AND status = 'PLANNING' RETURNING * INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transport request already claimed' USING ERRCODE = '40001'; END IF;
  RETURN to_jsonb(t);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_lot_transport(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lot_transport(UUID, UUID) TO service_role;
COMMIT;
