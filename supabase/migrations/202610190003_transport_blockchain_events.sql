-- Append-only transport timeline with a retryable blockchain outbox.
-- Safe to run after 202610190001; the transporter workflow columns/functions
-- are included here as IF NOT EXISTS / CREATE OR REPLACE for upgraded installs.
BEGIN;

ALTER TABLE public.transport_logs
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_reported_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_report JSONB;

UPDATE public.transport_logs
SET created_by = handler_id
WHERE created_by IS NULL AND handler_id IS NOT NULL;

UPDATE public.transport_logs t
SET handler_id = NULL
FROM public.user_profiles p
WHERE t.handler_id = p.id AND p.role <> 'TRANSPORTER' AND t.status = 'PLANNING';

CREATE TABLE public.transport_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_id UUID NOT NULL REFERENCES public.transport_logs(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'REQUESTED', 'CLAIMED', 'IN_TRANSIT', 'CHECKPOINT', 'DELIVERY_REPORTED', 'DELIVERED', 'CANCELLED'
  )),
  actor_id UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  payload JSONB NOT NULL,
  previous_hash TEXT,
  data_hash TEXT,
  blockchain_status public.blockchain_status NOT NULL DEFAULT 'PENDING',
  transaction_hash TEXT,
  block_number BIGINT CHECK (block_number IS NULL OR block_number >= 0),
  contract_address TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  retry_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transport_events_sequence_unique UNIQUE (transport_id, sequence)
);

CREATE INDEX transport_events_pending_idx
  ON public.transport_events(retry_after, created_at)
  WHERE blockchain_status IN ('PENDING', 'FAILED');
CREATE INDEX transport_events_transport_sequence_idx
  ON public.transport_events(transport_id, sequence);
CREATE INDEX transport_events_batch_idx
  ON public.transport_events(batch_id, created_at);

ALTER TABLE public.transport_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transport_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.transport_events TO service_role;

CREATE FUNCTION public.guard_transport_event_immutability()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Transport events are append-only' USING ERRCODE = '55000';
  END IF;

  IF ROW(NEW.transport_id, NEW.batch_id, NEW.sequence, NEW.event_id, NEW.event_type,
         NEW.actor_id, NEW.occurred_at, NEW.payload)
     IS DISTINCT FROM
     ROW(OLD.transport_id, OLD.batch_id, OLD.sequence, OLD.event_id, OLD.event_type,
         OLD.actor_id, OLD.occurred_at, OLD.payload) THEN
    RAISE EXCEPTION 'Transport event facts are immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.data_hash IS NOT NULL
     AND ROW(NEW.data_hash, NEW.previous_hash) IS DISTINCT FROM ROW(OLD.data_hash, OLD.previous_hash) THEN
    RAISE EXCEPTION 'Anchored transport event hash is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transport_events_immutable
BEFORE UPDATE OR DELETE ON public.transport_events
FOR EACH ROW EXECUTE FUNCTION public.guard_transport_event_immutability();

CREATE FUNCTION public.append_transport_event(
  p_transport UUID, p_actor UUID, p_event_type TEXT, p_payload JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_sequence INTEGER; v_event_id TEXT; v_id UUID;
BEGIN
  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  SELECT COALESCE(MAX(sequence), 0) + 1 INTO v_sequence
    FROM public.transport_events WHERE transport_id = p_transport;
  v_event_id := 'TRANSPORT:' || p_transport::TEXT || ':' || v_sequence::TEXT;
  INSERT INTO public.transport_events(
    transport_id, batch_id, sequence, event_id, event_type, actor_id, payload
  ) VALUES (
    p_transport, t.batch_id, v_sequence, v_event_id, p_event_type, p_actor, p_payload
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.append_transport_event(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_lot_transport(
  p_batch UUID, p_lot UUID, p_actor UUID, p_request UUID, p_code TEXT,
  p_date TIMESTAMPTZ, p_quantity NUMERIC, p_vehicle TEXT, p_driver TEXT,
  p_from TEXT, p_to TEXT, p_temperature NUMERIC, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.harvest_lots; t public.transport_logs; shipped NUMERIC; v_event UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role IN ('FARMER', 'ADMIN') AND status = TRUE
  ) THEN RAISE EXCEPTION 'Farm owner role required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO l FROM public.harvest_lots
  WHERE id = p_lot AND batch_id = p_batch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing lot' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO t FROM public.transport_logs WHERE request_id = p_request;
  IF FOUND THEN
    IF t.harvest_lot_id IS DISTINCT FROM p_lot OR t.created_by IS DISTINCT FROM p_actor
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
    batch_id, harvest_lot_id, created_by, handler_id, request_id, transport_code,
    transport_date, quantity, vehicle, driver, from_location, to_location, temperature, note
  ) VALUES (
    p_batch, p_lot, p_actor, NULL, p_request, p_code, p_date, p_quantity,
    p_vehicle, p_driver, p_from, p_to, p_temperature, p_note
  ) RETURNING * INTO t;

  v_event := public.append_transport_event(t.id, p_actor, 'REQUESTED', jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'quantity', t.quantity, 'status', t.status,
    'transportDate', t.transport_date, 'fromLocation', t.from_location,
    'toLocation', t.to_location, 'vehicle', t.vehicle, 'driver', t.driver,
    'temperature', t.temperature, 'note', t.note
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'replayed', FALSE, 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.record_lot_transport(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_lot_transport(UUID, UUID, UUID, UUID, TEXT, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_lot_transport(p_transport UUID, p_actor UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'TRANSPORTER' AND status = TRUE
  ) THEN RAISE EXCEPTION 'Transporter role required' USING ERRCODE = '42501'; END IF;

  UPDATE public.transport_logs
  SET handler_id = p_actor, claimed_at = clock_timestamp()
  WHERE id = p_transport AND handler_id IS NULL AND status = 'PLANNING'
  RETURNING * INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transport request already claimed' USING ERRCODE = '40001'; END IF;

  v_event := public.append_transport_event(t.id, p_actor, 'CLAIMED', jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'quantity', t.quantity,
    'claimedAt', t.claimed_at, 'status', t.status
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_lot_transport(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lot_transport(UUID, UUID) TO service_role;

CREATE FUNCTION public.update_lot_transport_status(
  p_transport UUID, p_actor UUID, p_status public.transport_status,
  p_vehicle TEXT, p_driver TEXT, p_temperature NUMERIC,
  p_temperature_supplied BOOLEAN, p_evidence JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event_type TEXT; v_event UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'TRANSPORTER' AND status = TRUE
  ) THEN RAISE EXCEPTION 'Transporter role required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF t.handler_id IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Transporter does not own this trip' USING ERRCODE = '42501';
  END IF;
  IF NOT ((t.status = 'PLANNING' AND p_status IN ('IN_TRANSIT', 'CANCELLED'))
       OR (t.status = 'IN_TRANSIT' AND p_status = 'CANCELLED')) THEN
    RAISE EXCEPTION 'Invalid transport status transition' USING ERRCODE = '40001';
  END IF;
  IF t.delivery_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'Delivery was reported; waiting for farm confirmation' USING ERRCODE = '40001';
  END IF;
  IF p_temperature_supplied AND p_temperature IS NOT NULL AND (p_temperature < -100 OR p_temperature > 100) THEN
    RAISE EXCEPTION 'Invalid temperature' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'IN_TRANSIT' AND (NULLIF(BTRIM(COALESCE(p_vehicle, '')), '') IS NULL
                                  OR NULLIF(BTRIM(COALESCE(p_driver, '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Vehicle and driver are required before departure' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'CANCELLED' AND LENGTH(BTRIM(COALESCE(p_evidence->>'cancellationReason', ''))) < 3 THEN
    RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transport_logs SET
    status = p_status,
    vehicle = COALESCE(p_vehicle, vehicle),
    driver = COALESCE(p_driver, driver),
    temperature = CASE WHEN p_temperature_supplied THEN p_temperature ELSE temperature END
  WHERE id = p_transport RETURNING * INTO t;

  v_event_type := CASE p_status
    WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT'
    WHEN 'CANCELLED' THEN 'CANCELLED'
  END;
  v_event := public.append_transport_event(t.id, p_actor, v_event_type, jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'quantity', t.quantity, 'status', t.status,
    'vehicle', t.vehicle, 'driver', t.driver, 'temperature', t.temperature,
    'fromLocation', t.from_location, 'toLocation', t.to_location, 'evidence', COALESCE(p_evidence, '{}'::JSONB)
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.update_lot_transport_status(UUID, UUID, public.transport_status, TEXT, TEXT, NUMERIC, BOOLEAN, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_lot_transport_status(UUID, UUID, public.transport_status, TEXT, TEXT, NUMERIC, BOOLEAN, JSONB) TO service_role;

CREATE FUNCTION public.report_lot_transport_delivery(
  p_transport UUID, p_actor UUID, p_recipient_name TEXT,
  p_receipt_reference TEXT, p_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event UUID; v_report JSONB; v_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'TRANSPORTER' AND status = TRUE
  ) THEN RAISE EXCEPTION 'Transporter role required' USING ERRCODE = '42501'; END IF;
  IF LENGTH(BTRIM(COALESCE(p_recipient_name, ''))) < 2
     OR LENGTH(BTRIM(COALESCE(p_receipt_reference, ''))) < 2 THEN
    RAISE EXCEPTION 'Recipient and receipt reference are required' USING ERRCODE = '22023';
  END IF;
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
    'recipientName', BTRIM(p_recipient_name),
    'receiptReference', BTRIM(p_receipt_reference),
    'note', NULLIF(BTRIM(COALESCE(p_note, '')), ''),
    'reportedAt', v_at
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
REVOKE ALL ON FUNCTION public.report_lot_transport_delivery(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_lot_transport_delivery(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

CREATE FUNCTION public.confirm_lot_transport_delivery(
  p_transport UUID, p_actor UUID, p_confirmation_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event UUID; v_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role IN ('FARMER', 'ADMIN') AND status = TRUE
  ) THEN RAISE EXCEPTION 'Farm owner role required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND (role = 'ADMIN' OR id = t.created_by)
  ) THEN RAISE EXCEPTION 'Only the requesting farm can confirm delivery' USING ERRCODE = '42501'; END IF;
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
    'farmConfirmation', jsonb_build_object('confirmedAt', v_at, 'note', NULLIF(BTRIM(COALESCE(p_confirmation_note, '')), ''))
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_lot_transport_delivery(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_lot_transport_delivery(UUID, UUID, TEXT) TO service_role;

CREATE FUNCTION public.record_transport_checkpoint(
  p_transport UUID, p_actor UUID, p_temperature NUMERIC,
  p_location TEXT, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.transport_logs; v_event UUID; v_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'TRANSPORTER' AND status = TRUE
  ) THEN RAISE EXCEPTION 'Transporter role required' USING ERRCODE = '42501'; END IF;
  IF p_temperature IS NULL OR p_temperature < -100 OR p_temperature > 100 THEN
    RAISE EXCEPTION 'Invalid temperature' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF t.handler_id IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Transporter does not own this trip' USING ERRCODE = '42501';
  END IF;
  IF t.status <> 'IN_TRANSIT' OR t.delivery_reported_at IS NOT NULL THEN
    RAISE EXCEPTION 'Checkpoints are only allowed while in transit' USING ERRCODE = '40001';
  END IF;

  UPDATE public.transport_logs SET temperature = p_temperature
  WHERE id = p_transport RETURNING * INTO t;
  v_event := public.append_transport_event(t.id, p_actor, 'CHECKPOINT', jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'status', t.status, 'temperature', p_temperature,
    'location', NULLIF(BTRIM(COALESCE(p_location, '')), ''),
    'note', NULLIF(BTRIM(COALESCE(p_note, '')), ''), 'measuredAt', v_at
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.record_transport_checkpoint(UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_transport_checkpoint(UUID, UUID, NUMERIC, TEXT, TEXT) TO service_role;

CREATE FUNCTION public.claim_transport_event_outbox(p_limit INTEGER DEFAULT 10, p_lease_seconds INTEGER DEFAULT 180)
RETURNS SETOF public.transport_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM public.transport_events e
    WHERE e.blockchain_status IN ('PENDING', 'FAILED')
      AND e.retry_after <= NOW()
      AND (e.lease_until IS NULL OR e.lease_until < NOW())
      AND NOT EXISTS (
        SELECT 1 FROM public.transport_events previous
        WHERE previous.transport_id = e.transport_id
          AND previous.sequence < e.sequence
          AND previous.blockchain_status <> 'SUCCESS'
      )
    ORDER BY e.created_at, e.sequence
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.transport_events e
  SET lease_token = gen_random_uuid(),
      lease_until = NOW() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 180), 30), 900))
  FROM candidates c
  WHERE e.id = c.id
  RETURNING e.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_transport_event_outbox(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_transport_event_outbox(INTEGER, INTEGER) TO service_role;

COMMIT;
