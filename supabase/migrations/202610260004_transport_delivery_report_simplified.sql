-- The transporter reports arrival; the assigned distributor remains the party
-- that confirms receipt. Do not require receiver identity or receipt numbers.
BEGIN;

DROP FUNCTION IF EXISTS public.report_lot_transport_delivery(UUID, UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION public.report_lot_transport_delivery(
  p_transport UUID, p_actor UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event UUID; v_report JSONB; v_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'TRANSPORTER' AND status = TRUE
  ) THEN RAISE EXCEPTION 'Transporter role required' USING ERRCODE = '42501'; END IF;
  IF LENGTH(COALESCE(p_note, '')) > 1000 THEN
    RAISE EXCEPTION 'Delivery note is too long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF t.handler_id IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Transporter does not own this trip' USING ERRCODE = '42501';
  END IF;
  IF t.status <> 'IN_TRANSIT' OR t.delivery_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'Trip is not awaiting a delivery report' USING ERRCODE = '40001';
  END IF;

  v_report := jsonb_build_object(
    'reportedBy', p_actor,
    'reportedAt', v_at,
    'note', NULLIF(BTRIM(COALESCE(p_note, '')), '')
  );
  UPDATE public.transport_logs SET
    delivery_reported_at = v_at,
    delivery_reported_by = p_actor,
    delivery_report = v_report
  WHERE id = p_transport RETURNING * INTO t;
  v_event := public.append_transport_event(t.id, p_actor, 'DELIVERY_REPORTED', jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'quantity', t.quantity, 'status', t.status,
    'deliveryReport', v_report
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;

REVOKE ALL ON FUNCTION public.report_lot_transport_delivery(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_lot_transport_delivery(UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
