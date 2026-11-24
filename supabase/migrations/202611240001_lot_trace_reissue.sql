BEGIN;

ALTER TABLE public.lot_trace_codes
  DROP CONSTRAINT lot_trace_codes_pkey,
  DROP CONSTRAINT lot_trace_codes_trace_code_key,
  ADD PRIMARY KEY (trace_code);

CREATE UNIQUE INDEX lot_trace_one_active_per_lot
  ON public.lot_trace_codes (lot_id) WHERE status = 'ACTIVE';
CREATE INDEX lot_trace_current_by_lot
  ON public.lot_trace_codes (lot_id, status, created_at DESC, trace_code DESC);

DROP FUNCTION public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT);
CREATE FUNCTION public.manage_received_lot_qr(
  p_actor UUID, p_transport UUID, p_action TEXT DEFAULT 'GET', p_reason TEXT DEFAULT NULL,
  p_trace_code UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.user_profiles;
  trip public.transport_logs;
  qr public.lot_trace_codes;
  publisher_name TEXT;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('GET', 'ISSUE', 'REVOKE', 'REISSUE') THEN
    RAISE EXCEPTION 'Invalid QR action' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO actor FROM public.user_profiles WHERE id = p_actor FOR SHARE;
  IF NOT FOUND OR actor.role IS DISTINCT FROM 'DISTRIBUTOR' OR actor.status IS DISTINCT FROM TRUE OR actor.organization_id IS NULL THEN
    RAISE EXCEPTION 'Active distributor required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id = actor.organization_id AND status = TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Inactive distributor organization' USING ERRCODE = '42501'; END IF;
  SELECT * INTO trip FROM public.transport_logs WHERE id = p_transport FOR SHARE;
  IF NOT FOUND OR trip.recipient_organization_id IS DISTINCT FROM actor.organization_id THEN
    RAISE EXCEPTION 'Missing receiving transport' USING ERRCODE = 'P0002';
  END IF;
  IF trip.status IS DISTINCT FROM 'DELIVERED' OR NOT EXISTS (
    SELECT 1 FROM public.transport_events e
    WHERE e.transport_id = trip.id AND e.event_type = 'DELIVERED'
      AND e.payload #>> '{receiverConfirmation,organizationId}' = actor.organization_id::TEXT
  ) THEN
    RAISE EXCEPTION 'Confirmed receipt required' USING ERRCODE = '40001';
  END IF;

  IF p_action <> 'GET' THEN
    PERFORM 1 FROM public.harvest_lots WHERE id = trip.harvest_lot_id FOR UPDATE;
  END IF;
  SELECT * INTO qr FROM public.lot_trace_codes WHERE lot_id = trip.harvest_lot_id
    ORDER BY status, created_at DESC, trace_code DESC LIMIT 1;

  IF p_action IN ('REVOKE', 'REISSUE') THEN
    IF qr.trace_code IS NULL THEN RAISE EXCEPTION 'Missing QR' USING ERRCODE = 'P0002'; END IF;
    IF qr.issuer_organization_id IS DISTINCT FROM actor.organization_id THEN
      RAISE EXCEPTION 'Only publishing organization can manage this QR' USING ERRCODE = '42501';
    END IF;
    -- Older clients may omit the code on revocation only before the first replacement.
    IF p_trace_code IS DISTINCT FROM qr.trace_code AND (
      p_trace_code IS NOT NULL OR p_action = 'REISSUE' OR EXISTS (
        SELECT 1 FROM public.lot_trace_codes
        WHERE lot_id = qr.lot_id AND trace_code <> qr.trace_code
      )
    ) THEN
      RAISE EXCEPTION 'QR changed' USING ERRCODE = 'PT409';
    END IF;
  END IF;

  IF p_action = 'REISSUE' AND qr.status <> 'REVOKED' THEN
    RAISE EXCEPTION 'Current QR is active' USING ERRCODE = 'PT409';
  END IF;
  IF p_action = 'REISSUE' OR (p_action = 'ISSUE' AND qr.trace_code IS NULL) THEN
    INSERT INTO public.lot_trace_codes(lot_id, issued_by, issuer_organization_id, issuance_transport_id, created_at)
    VALUES (trip.harvest_lot_id, actor.id, actor.organization_id, trip.id, clock_timestamp())
    RETURNING * INTO qr;
  ELSIF p_action = 'REVOKE' THEN
    IF p_reason IS NULL OR LENGTH(BTRIM(p_reason)) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Invalid revocation reason' USING ERRCODE = '22023';
    END IF;
    IF qr.status = 'ACTIVE' THEN
      UPDATE public.lot_trace_codes
      SET status = 'REVOKED', revoked_at = clock_timestamp(), revocation_reason = BTRIM(p_reason)
      WHERE trace_code = qr.trace_code RETURNING * INTO qr;
    END IF;
  END IF;

  SELECT name INTO publisher_name FROM public.organizations WHERE id = qr.issuer_organization_id;
  RETURN jsonb_build_object(
    'qr', CASE WHEN qr.trace_code IS NULL THEN NULL ELSE
      (to_jsonb(qr) - 'issued_by' - 'issuance_transport_id') || jsonb_build_object(
        'issuer', CASE WHEN qr.issuer_organization_id IS NULL THEN NULL ELSE jsonb_build_object('name', publisher_name) END
      ) END,
    'canIssue', qr.trace_code IS NULL,
    'canRevoke', COALESCE(qr.status = 'ACTIVE' AND qr.issuer_organization_id = actor.organization_id, FALSE),
    'canReissue', COALESCE(qr.status = 'REVOKED' AND qr.issuer_organization_id = actor.organization_id, FALSE)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_legacy_lot_qr(p_actor UUID, p_lot UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE qr public.lot_trace_codes;
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id = p_actor AND status = TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active profile required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.harvest_lots WHERE id = p_lot FOR UPDATE;
  PERFORM 1 FROM public.harvest_lots l
    JOIN public.batches b ON b.id = l.batch_id
    JOIN public.ponds p ON p.id = b.pond_id
    JOIN public.farms f ON f.id = p.farm_id
    WHERE l.id = p_lot AND f.owner_id = p_actor FOR SHARE OF f;
  IF NOT FOUND THEN RAISE EXCEPTION 'Farm owner required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO qr FROM public.lot_trace_codes WHERE lot_id = p_lot
    ORDER BY status, created_at DESC, trace_code DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing QR' USING ERRCODE = 'P0002'; END IF;
  IF qr.issuer_organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only legacy owner codes can be revoked here' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR LENGTH(BTRIM(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid revocation reason' USING ERRCODE = '22023';
  END IF;
  IF qr.status = 'ACTIVE' THEN
    UPDATE public.lot_trace_codes SET status = 'REVOKED', revoked_at = clock_timestamp(), revocation_reason = BTRIM(p_reason)
    WHERE trace_code = qr.trace_code RETURNING * INTO qr;
  END IF;
  RETURN (to_jsonb(qr) - 'issued_by' - 'issuance_transport_id') || jsonb_build_object('issuer', NULL);
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
