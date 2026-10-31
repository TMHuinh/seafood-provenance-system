-- Allow transporters to append detailed parcel-style journey updates.
BEGIN;

ALTER TABLE public.transport_events
  DROP CONSTRAINT IF EXISTS transport_events_event_type_check;
ALTER TABLE public.transport_events
  ADD CONSTRAINT transport_events_event_type_check CHECK (event_type IN (
    'REQUESTED', 'CLAIMED', 'IN_TRANSIT', 'CHECKPOINT', 'DELIVERY_REPORTED',
    'RECIPIENT_ASSIGNED', 'TRACKING_UPDATE', 'DELIVERED', 'CANCELLED'
  ));

CREATE FUNCTION public.record_lot_transport_tracking_update(
  p_transport UUID, p_actor UUID, p_tracking_status TEXT,
  p_location TEXT, p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event UUID; v_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'TRANSPORTER' AND status = TRUE
  ) THEN RAISE EXCEPTION 'Transporter role required' USING ERRCODE = '42501'; END IF;
  IF p_tracking_status IS NULL OR p_tracking_status NOT IN (
    'PICKED_UP', 'IN_TRANSIT', 'AT_SORTING_FACILITY', 'DEPARTED_FACILITY',
    'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPT_FAILED', 'OTHER'
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

  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF t.handler_id IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Transporter does not own this trip' USING ERRCODE = '42501';
  END IF;
  IF t.status <> 'IN_TRANSIT' OR t.delivery_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'Tracking updates are only allowed while the trip is in transit' USING ERRCODE = '40001';
  END IF;

  v_event := public.append_transport_event(t.id, p_actor, 'TRACKING_UPDATE', jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'trackingStatus', p_tracking_status,
    'location', BTRIM(p_location), 'note', NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    'updatedAt', v_at
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.record_lot_transport_tracking_update(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_lot_transport_tracking_update(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
