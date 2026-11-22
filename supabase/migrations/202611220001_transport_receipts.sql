BEGIN;

ALTER TYPE public.transport_status ADD VALUE 'REJECTED';
ALTER TABLE public.transport_logs
  ADD COLUMN receipt_outcome TEXT,
  ADD COLUMN received_quantity NUMERIC(14,2),
  ADD CONSTRAINT transport_receipt_consistent CHECK (
    (receipt_outcome IS NULL AND received_quantity IS NULL AND status::text <> 'REJECTED')
    OR (receipt_outcome IS NOT NULL AND received_quantity IS NOT NULL AND quantity IS NOT NULL AND (
      (receipt_outcome = 'FULL' AND received_quantity = quantity AND status::text = 'DELIVERED')
      OR (receipt_outcome = 'PARTIAL' AND received_quantity > 0 AND received_quantity < quantity AND status::text = 'DELIVERED')
      OR (receipt_outcome = 'REJECTED' AND received_quantity = 0 AND status::text = 'REJECTED')
    ))
  );

ALTER TABLE public.transport_events DROP CONSTRAINT transport_events_event_type_check;
ALTER TABLE public.transport_events ADD CONSTRAINT transport_events_event_type_check CHECK (event_type IN (
  'REQUESTED', 'CLAIMED', 'IN_TRANSIT', 'CHECKPOINT', 'DELIVERY_REPORTED',
  'RECIPIENT_ASSIGNED', 'TRACKING_UPDATE', 'DELIVERED', 'CANCELLED', 'REJECTED'
));

DROP FUNCTION public.confirm_lot_transport_delivery(UUID, UUID, TEXT);
CREATE FUNCTION public.confirm_lot_transport_delivery(
  p_transport UUID, p_actor UUID, p_outcome TEXT, p_received_quantity NUMERIC, p_confirmation_note TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.transport_logs;
  v_event UUID;
  v_note TEXT := NULLIF(BTRIM(p_confirmation_note), '');
BEGIN
  SELECT * INTO t FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing transport' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = p_actor AND role = 'DISTRIBUTOR' AND status = TRUE
      AND organization_id = t.recipient_organization_id
  ) THEN RAISE EXCEPTION 'Receiving distributor required' USING ERRCODE = '42501'; END IF;
  IF t.status <> 'IN_TRANSIT' OR t.delivery_reported_at IS NULL OR t.delivery_report IS NULL THEN
    RAISE EXCEPTION 'No pending delivery report' USING ERRCODE = '40001';
  END IF;
  -- Validate before NUMERIC(14,2) rounds the input. The table constraint checks the stored outcome and weight.
  IF p_outcome IS NULL OR p_received_quantity IS DISTINCT FROM ROUND(p_received_quantity, 2)
     OR (p_outcome <> 'FULL' AND v_note IS NULL) OR LENGTH(v_note) > 1000 THEN
    RAISE EXCEPTION 'Invalid receipt' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transport_logs SET
    status = CASE WHEN p_outcome = 'REJECTED' THEN 'REJECTED' ELSE 'DELIVERED' END::public.transport_status,
    receipt_outcome = p_outcome, received_quantity = p_received_quantity
  WHERE id = t.id RETURNING * INTO t;

  v_event := public.append_transport_event(t.id, p_actor, t.status::text, jsonb_build_object(
    'transportId', t.id, 'batchId', t.batch_id, 'harvestLotId', t.harvest_lot_id,
    'transportCode', t.transport_code, 'quantity', t.quantity, 'status', t.status,
    'deliveryReport', t.delivery_report,
    'receiverConfirmation', jsonb_build_object('organizationId', t.recipient_organization_id,
      'confirmedAt', clock_timestamp(), 'outcome', p_outcome, 'receivedQuantity', p_received_quantity, 'note', v_note)
  ));
  RETURN jsonb_build_object('transport', to_jsonb(t), 'event_id', v_event);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_lot_transport_delivery(UUID, UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_lot_transport_delivery(UUID, UUID, TEXT, NUMERIC, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
