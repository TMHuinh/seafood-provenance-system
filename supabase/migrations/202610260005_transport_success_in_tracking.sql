-- A successful delivery report is one tracking update. Receipt is still
-- finalized only when the assigned distributor confirms it.
BEGIN;

DROP FUNCTION IF EXISTS public.record_lot_transport_tracking_update(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.report_lot_transport_delivery(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.report_lot_transport_delivery(UUID, UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION public.record_lot_transport_tracking_update(
  p_transport UUID, p_actor UUID, p_tracking_status TEXT,
  p_location TEXT, p_note TEXT DEFAULT NULL, p_temperature NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.transport_logs;
  v_event UUID;
  v_at TIMESTAMPTZ := clock_timestamp();
  v_report JSONB := NULL;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'TRANSPORTER' AND status = TRUE
  ) THEN RAISE EXCEPTION 'Transporter role required' USING ERRCODE = '42501'; END IF;
  IF p_tracking_status IS NULL OR p_tracking_status NOT IN (
    'PICKED_UP', 'IN_TRANSIT', 'AT_SORTING_FACILITY', 'DEPARTED_FACILITY',
    'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPT_FAILED', 'DELIVERED_REPORTED', 'OTHER'
  ) THEN RAISE EXCEPTION 'Invalid tracking status' USING ERRCODE = '22023'; END IF;
  IF LENGTH(BTRIM(COALESCE(p_location, ''))) < 2 OR LENGTH(p_location) > 500 THEN
    RAISE EXCEPTION 'A valid tracking location is required' USING ERRCODE = '22023';
  END IF;
  IF LENGTH(COALESCE(p_note, '')) > 1000 THEN
    RAISE EXCEPTION 'Tracking note is too long' USING ERRCODE = '22023';
  END IF;
  IF p_tracking_status = 'OTHER' AND LENGTH(BTRIM(COALESCE(p_note, ''))) < 2 THEN
    RAISE EXCEPTION 'A note is required for other tracking updates' USING ERRCODE = '22023';
  END IF;
  IF p_temperature IS NOT NULL AND (
    p_temperature < -100 OR p_temperature > 100 OR p_temperature <> ROUND(p_temperature, 2)
  ) THEN
    RAISE EXCEPTION 'Invalid tracking temperature' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF t.handler_id IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Transporter does not own this trip' USING ERRCODE = '42501';
  END IF;
  IF t.status <> 'IN_TRANSIT' OR t.delivery_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'Tracking updates are only allowed while the trip is in transit' USING ERRCODE = '40001';
  END IF;

  IF p_tracking_status = 'DELIVERED_REPORTED' THEN
    v_report := jsonb_build_object(
      'reportedBy', p_actor, 'reportedAt', v_at, 'trackingStatus', p_tracking_status,
      'location', BTRIM(p_location), 'temperature', p_temperature,
      'note', NULLIF(BTRIM(COALESCE(p_note, '')), '')
    );
    UPDATE public.transport_logs SET
      delivery_reported_at = v_at,
      delivery_reported_by = p_actor,
      delivery_report = v_report
    WHERE id = p_transport RETURNING * INTO t;
  END IF;

  v_event := public.append_transport_event(t.id, p_actor, 'TRACKING_UPDATE', jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'trackingStatus', p_tracking_status,
    'location', BTRIM(p_location), 'temperature', p_temperature,
    'note', NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    'awaitingRecipientConfirmation', p_tracking_status = 'DELIVERED_REPORTED',
    'deliveryReport', v_report, 'updatedAt', v_at
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;

REVOKE ALL ON FUNCTION public.record_lot_transport_tracking_update(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_lot_transport_tracking_update(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
