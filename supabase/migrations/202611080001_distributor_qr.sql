-- Apply after 202611070001_lot_trace_codes.sql. Existing QR codes remain unchanged.
BEGIN;
ALTER TABLE public.lot_trace_codes
  ADD COLUMN issued_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN issuer_organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN issuance_transport_id UUID REFERENCES public.transport_logs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT lot_trace_issuer_complete CHECK (
    (issued_by IS NULL AND issuer_organization_id IS NULL AND issuance_transport_id IS NULL)
    OR (issued_by IS NOT NULL AND issuer_organization_id IS NOT NULL AND issuance_transport_id IS NOT NULL)
  );

-- Only these SECURITY DEFINER routines may mutate publication via the API role.
-- This also prevents an older backend from issuing owner-created codes after upgrade.
REVOKE INSERT, UPDATE, DELETE ON public.lot_trace_codes FROM service_role;

CREATE FUNCTION public.manage_received_lot_qr(
  p_actor UUID, p_transport UUID, p_action TEXT DEFAULT 'GET', p_reason TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.user_profiles;
  trip public.transport_logs;
  qr public.lot_trace_codes;
  publisher_name TEXT;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('GET', 'ISSUE', 'REVOKE') THEN
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
  -- Serialize all writers by lot, including the first insert and legacy revocation.
  -- Other recipients can reuse a code but never replace its publisher or reactivate it.
  IF p_action <> 'GET' THEN
    PERFORM 1 FROM public.harvest_lots WHERE id = trip.harvest_lot_id FOR UPDATE;
  END IF;
  IF p_action = 'ISSUE' THEN
    INSERT INTO public.lot_trace_codes(lot_id, issued_by, issuer_organization_id, issuance_transport_id)
    VALUES (trip.harvest_lot_id, actor.id, actor.organization_id, trip.id)
    ON CONFLICT (lot_id) DO NOTHING;
  END IF;
  SELECT * INTO qr FROM public.lot_trace_codes WHERE lot_id = trip.harvest_lot_id;
  IF p_action = 'REVOKE' THEN
    IF qr.lot_id IS NULL THEN RAISE EXCEPTION 'Missing QR' USING ERRCODE = 'P0002'; END IF;
    IF qr.issuer_organization_id IS DISTINCT FROM actor.organization_id THEN
      RAISE EXCEPTION 'Only publishing organization can revoke' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR LENGTH(BTRIM(p_reason)) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Invalid revocation reason' USING ERRCODE = '22023';
    END IF;
    UPDATE public.lot_trace_codes SET status = 'REVOKED', revoked_at = clock_timestamp(), revocation_reason = BTRIM(p_reason)
    WHERE lot_id = qr.lot_id AND status = 'ACTIVE' RETURNING * INTO qr;
    -- Repeated revocation preserves the original timestamp and reason.
    IF NOT FOUND THEN SELECT * INTO qr FROM public.lot_trace_codes WHERE lot_id = trip.harvest_lot_id; END IF;
  END IF;
  SELECT name INTO publisher_name FROM public.organizations WHERE id = qr.issuer_organization_id;
  RETURN jsonb_build_object(
    'qr', CASE WHEN qr.lot_id IS NULL THEN NULL ELSE
      (to_jsonb(qr) - 'issued_by' - 'issuance_transport_id') || jsonb_build_object(
        'issuer', CASE WHEN qr.issuer_organization_id IS NULL THEN NULL ELSE jsonb_build_object('name', publisher_name) END
      ) END,
    'canIssue', qr.lot_id IS NULL,
    'canRevoke', COALESCE(qr.status = 'ACTIVE' AND qr.issuer_organization_id = actor.organization_id, FALSE)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT) TO service_role;

CREATE FUNCTION public.revoke_legacy_lot_qr(p_actor UUID, p_lot UUID, p_reason TEXT)
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
  SELECT * INTO qr FROM public.lot_trace_codes WHERE lot_id = p_lot;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing QR' USING ERRCODE = 'P0002'; END IF;
  IF qr.issuer_organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only legacy owner codes can be revoked here' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR LENGTH(BTRIM(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Invalid revocation reason' USING ERRCODE = '22023';
  END IF;
  UPDATE public.lot_trace_codes SET status = 'REVOKED', revoked_at = clock_timestamp(), revocation_reason = BTRIM(p_reason)
  WHERE lot_id = p_lot AND status = 'ACTIVE' RETURNING * INTO qr;
  IF NOT FOUND THEN SELECT * INTO qr FROM public.lot_trace_codes WHERE lot_id = p_lot; END IF;
  RETURN (to_jsonb(qr) - 'issued_by' - 'issuance_transport_id') || jsonb_build_object('issuer', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_legacy_lot_qr(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_legacy_lot_qr(UUID, UUID, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
