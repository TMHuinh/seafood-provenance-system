-- Bind each new transport request to its receiving distributor organization.
BEGIN;

ALTER TABLE public.transport_logs
  ADD COLUMN recipient_organization_id UUID
    REFERENCES public.organizations(id) ON DELETE RESTRICT;

CREATE INDEX transport_logs_recipient_organization_id_idx
  ON public.transport_logs(recipient_organization_id);

ALTER TABLE public.transport_events
  DROP CONSTRAINT IF EXISTS transport_events_event_type_check;
ALTER TABLE public.transport_events
  ADD CONSTRAINT transport_events_event_type_check CHECK (event_type IN (
    'REQUESTED', 'CLAIMED', 'IN_TRANSIT', 'CHECKPOINT', 'DELIVERY_REPORTED',
    'RECIPIENT_ASSIGNED', 'DELIVERED', 'CANCELLED'
  ));

-- Replace the old RPC so every new request has a real receiving organization.
DROP FUNCTION public.record_lot_transport(
  UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT
);

CREATE FUNCTION public.record_lot_transport(
  p_batch UUID, p_lot UUID, p_actor UUID, p_request UUID, p_code TEXT,
  p_date TIMESTAMPTZ, p_quantity NUMERIC, p_vehicle TEXT, p_driver TEXT,
  p_from TEXT, p_to TEXT, p_temperature NUMERIC, p_note TEXT,
  p_recipient_organization UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.harvest_lots; t public.transport_logs; shipped NUMERIC; v_event UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role IN ('FARMER', 'ADMIN') AND status = TRUE
  ) THEN RAISE EXCEPTION 'Farm owner role required' USING ERRCODE = '42501'; END IF;
  IF p_recipient_organization IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.organizations o
    JOIN public.user_profiles u ON u.organization_id = o.id
    WHERE o.id = p_recipient_organization AND o.status = TRUE
      AND u.role = 'DISTRIBUTOR' AND u.status = TRUE
  ) THEN RAISE EXCEPTION 'Active distributor recipient required' USING ERRCODE = '23514'; END IF;

  SELECT * INTO l FROM public.harvest_lots
  WHERE id = p_lot AND batch_id = p_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing lot' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO t FROM public.transport_logs WHERE request_id = p_request;
  IF FOUND THEN
    IF t.harvest_lot_id IS DISTINCT FROM p_lot OR t.created_by IS DISTINCT FROM p_actor
       OR t.recipient_organization_id IS DISTINCT FROM p_recipient_organization
       OR t.quantity IS DISTINCT FROM p_quantity OR t.transport_code IS DISTINCT FROM p_code
       OR t.transport_date IS DISTINCT FROM p_date OR t.vehicle IS DISTINCT FROM p_vehicle
       OR t.driver IS DISTINCT FROM p_driver OR t.from_location IS DISTINCT FROM p_from
       OR t.to_location IS DISTINCT FROM p_to OR t.temperature IS DISTINCT FROM p_temperature
       OR t.note IS DISTINCT FROM p_note THEN
      RAISE EXCEPTION 'Request already used with different data' USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object('transport', to_jsonb(t), 'replayed', TRUE);
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO shipped FROM public.transport_logs
  WHERE harvest_lot_id = p_lot AND status <> 'CANCELLED';
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> ROUND(p_quantity, 2)
     OR shipped + p_quantity > l.quantity THEN
    RAISE EXCEPTION 'Transport quantity exceeds available lot quantity' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.transport_logs(
    batch_id, harvest_lot_id, created_by, recipient_organization_id, handler_id,
    request_id, transport_code, transport_date, quantity, vehicle, driver,
    from_location, to_location, temperature, note
  ) VALUES (
    p_batch, p_lot, p_actor, p_recipient_organization, NULL,
    p_request, p_code, p_date, p_quantity, p_vehicle, p_driver,
    p_from, p_to, p_temperature, p_note
  ) RETURNING * INTO t;

  v_event := public.append_transport_event(t.id, p_actor, 'REQUESTED', jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'quantity', t.quantity, 'status', t.status,
    'transportDate', t.transport_date, 'fromLocation', t.from_location,
    'toLocation', t.to_location, 'recipientOrganizationId', t.recipient_organization_id,
    'vehicle', t.vehicle, 'driver', t.driver, 'temperature', t.temperature, 'note', t.note
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'replayed', FALSE, 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.record_lot_transport(
  UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_lot_transport(
  UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_lot_transport_delivery(
  p_transport UUID, p_actor UUID, p_confirmation_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event UUID; v_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'DISTRIBUTOR' AND status = TRUE
      AND organization_id = t.recipient_organization_id
  ) THEN RAISE EXCEPTION 'Only the receiving distributor can confirm delivery' USING ERRCODE = '42501'; END IF;
  IF t.status <> 'IN_TRANSIT' OR t.delivery_reported_at IS NULL OR t.delivery_report IS NULL THEN
    RAISE EXCEPTION 'No delivery report is awaiting confirmation' USING ERRCODE = '40001';
  END IF;
  IF LENGTH(COALESCE(p_confirmation_note, '')) > 1000 THEN
    RAISE EXCEPTION 'Confirmation note is too long' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transport_logs SET status = 'DELIVERED'
  WHERE id = p_transport RETURNING * INTO t;
  v_event := public.append_transport_event(t.id, p_actor, 'DELIVERED', jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'quantity', t.quantity, 'status', t.status,
    'deliveryReport', t.delivery_report,
    'receiverConfirmation', jsonb_build_object('organizationId', t.recipient_organization_id,
      'confirmedAt', v_at, 'note', NULLIF(BTRIM(COALESCE(p_confirmation_note, '')), ''))
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_lot_transport_delivery(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_lot_transport_delivery(UUID, UUID, TEXT) TO service_role;

CREATE FUNCTION public.assign_lot_transport_recipient(
  p_transport UUID, p_actor UUID, p_recipient_organization UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role IN ('FARMER', 'ADMIN') AND status = TRUE
  ) THEN RAISE EXCEPTION 'Farm owner role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF (p_actor IS DISTINCT FROM t.created_by AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles WHERE id = p_actor AND role = 'ADMIN'
  )) THEN RAISE EXCEPTION 'Only the requesting farm can assign the recipient' USING ERRCODE = '42501'; END IF;
  IF t.recipient_organization_id IS NOT NULL OR t.status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Recipient is already assigned or trip is closed' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations o
    JOIN public.user_profiles u ON u.organization_id = o.id
    WHERE o.id = p_recipient_organization AND o.status = TRUE
      AND u.role = 'DISTRIBUTOR' AND u.status = TRUE
  ) THEN RAISE EXCEPTION 'Active distributor recipient required' USING ERRCODE = '23514'; END IF;

  UPDATE public.transport_logs SET recipient_organization_id = p_recipient_organization
  WHERE id = p_transport RETURNING * INTO t;
  v_event := public.append_transport_event(t.id, p_actor, 'RECIPIENT_ASSIGNED', jsonb_build_object(
    'transportId', t.id, 'transportCode', t.transport_code,
    'recipientOrganizationId', t.recipient_organization_id, 'toLocation', t.to_location
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.assign_lot_transport_recipient(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lot_transport_recipient(UUID, UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
