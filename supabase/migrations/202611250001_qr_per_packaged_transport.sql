BEGIN;

DROP INDEX IF EXISTS public.lot_trace_one_active_per_lot;
CREATE UNIQUE INDEX IF NOT EXISTS lot_trace_one_active_per_transport
  ON public.lot_trace_codes (issuance_transport_id)
  WHERE status = 'ACTIVE' AND issuance_transport_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lot_trace_one_active_legacy_per_lot
  ON public.lot_trace_codes (lot_id)
  WHERE status = 'ACTIVE' AND issuance_transport_id IS NULL;
CREATE INDEX IF NOT EXISTS lot_trace_current_by_transport
  ON public.lot_trace_codes (issuance_transport_id, status, created_at DESC, trace_code DESC)
  WHERE issuance_transport_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.manage_received_lot_qr_before_packaging(UUID, UUID, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.revoke_legacy_lot_qr(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.received_lot_packaging(UUID, UUID, JSONB);

-- Persist an already validated snapshot and its outbox job in one transaction.
CREATE OR REPLACE FUNCTION public.persist_lot_packaging(p_transport UUID, p_recipient UUID, p_snapshot JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  trip public.transport_logs;
  saved JSONB;
  proof_id TEXT := 'QUALITY_INSPECTION_RECORDED:' || p_transport;
BEGIN
  SELECT * INTO trip FROM public.transport_logs
    WHERE id = p_transport AND recipient_organization_id = p_recipient FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT snapshot INTO saved FROM public.lot_packaging WHERE transport_id = trip.id;
  IF FOUND THEN RETURN saved; END IF;

  INSERT INTO public.lot_packaging(transport_id, lot_id, event_id, snapshot)
    VALUES (trip.id, trip.harvest_lot_id, proof_id, p_snapshot);
  INSERT INTO public.blockchain_outbox(event_id, batch_id, entity_type, entity_id, event_type, payload)
    VALUES (proof_id, trip.batch_id, 'LOT_PACKAGING', trip.id, 'QUALITY_INSPECTION_RECORDED', p_snapshot);
  RETURN p_snapshot;
END;
$$;

-- Serialize inserts and reject a stale QR state observed by the backend.
CREATE OR REPLACE FUNCTION public.insert_lot_trace_code_if_current(
  p_transport UUID, p_recipient UUID, p_actor UUID, p_expected_code UUID, p_expected_status TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  trip public.transport_logs;
  qr public.lot_trace_codes;
BEGIN
  SELECT * INTO trip FROM public.transport_logs
    WHERE id = p_transport AND recipient_organization_id = p_recipient FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO qr FROM public.lot_trace_codes WHERE issuance_transport_id = trip.id
    ORDER BY status, created_at DESC, trace_code DESC LIMIT 1 FOR UPDATE;
  IF qr.trace_code IS DISTINCT FROM p_expected_code OR qr.status IS DISTINCT FROM p_expected_status THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.lot_trace_codes(lot_id, issued_by, issuer_organization_id, issuance_transport_id, created_at)
    VALUES (trip.harvest_lot_id, p_actor, p_recipient, trip.id, clock_timestamp()) RETURNING * INTO qr;
  RETURN to_jsonb(qr);
END;
$$;

REVOKE ALL ON FUNCTION public.persist_lot_packaging(UUID, UUID, JSONB),
  public.insert_lot_trace_code_if_current(UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_lot_packaging(UUID, UUID, JSONB),
  public.insert_lot_trace_code_if_current(UUID, UUID, UUID, UUID, TEXT) TO service_role;
GRANT UPDATE (status, revoked_at, revocation_reason) ON public.lot_trace_codes TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
