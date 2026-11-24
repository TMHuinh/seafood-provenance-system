BEGIN;

CREATE TABLE public.lot_packaging (
  transport_id UUID PRIMARY KEY REFERENCES public.transport_logs(id) ON DELETE RESTRICT,
  lot_id UUID NOT NULL REFERENCES public.harvest_lots(id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL UNIQUE,
  snapshot JSONB NOT NULL
);
CREATE INDEX lot_packaging_lot ON public.lot_packaging(lot_id);
ALTER TABLE public.lot_packaging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lot_packaging FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lot_packaging TO service_role;

ALTER FUNCTION public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT, UUID)
  RENAME TO manage_received_lot_qr_before_packaging;
REVOKE EXECUTE ON FUNCTION public.manage_received_lot_qr_before_packaging(UUID, UUID, TEXT, TEXT, UUID) FROM service_role;

CREATE FUNCTION public.received_lot_packaging(p_actor UUID, p_transport UUID, p_input JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor public.user_profiles;
  trip public.transport_logs;
  receipt public.transport_events;
  packaging public.lot_packaging;
  distributor TEXT;
  lot_batch UUID;
  quantity NUMERIC;
  packaged_on DATE;
  inspected_on DATE;
  business_day DATE := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
  SELECT * INTO actor FROM public.user_profiles WHERE id = p_actor FOR SHARE;
  IF NOT FOUND OR actor.role IS DISTINCT FROM 'DISTRIBUTOR' OR actor.status IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Active distributor required' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO distributor FROM public.organizations WHERE id = actor.organization_id AND status = TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active distributor organization required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO trip FROM public.transport_logs WHERE id = p_transport FOR UPDATE;
  IF NOT FOUND OR trip.recipient_organization_id IS DISTINCT FROM actor.organization_id THEN
    RAISE EXCEPTION 'Missing receiving transport' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO receipt FROM public.transport_events
    WHERE transport_id = trip.id AND event_type = 'DELIVERED'
      AND payload #>> '{receiverConfirmation,organizationId}' = actor.organization_id::TEXT
    ORDER BY sequence DESC LIMIT 1;
  IF NOT FOUND OR trip.status IS DISTINCT FROM 'DELIVERED' THEN
    RAISE EXCEPTION 'Confirmed receipt required' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO packaging FROM public.lot_packaging WHERE transport_id = trip.id;
  IF p_input IS NULL THEN
    RETURN packaging.snapshot;
  END IF;

  packaged_on := (p_input->>'packagedDate')::DATE;
  inspected_on := (p_input->>'inspectionDate')::DATE;
  quantity := (p_input->>'quantity')::NUMERIC;
  IF packaged_on IS NULL OR inspected_on IS NULL OR quantity IS NULL OR
     packaged_on NOT BETWEEN (receipt.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE AND business_day OR
     inspected_on NOT BETWEEN (receipt.occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE AND business_day OR
     quantity <= 0 OR quantity <> round(quantity, 2) OR
     quantity > COALESCE(trip.received_quantity, trip.quantity, 0) OR
     COALESCE(length(btrim(p_input->>'specification')), 0) NOT BETWEEN 1 AND 200 OR
     COALESCE(length(btrim(p_input->>'inspectionUnit')), 0) NOT BETWEEN 1 AND 200 OR
     COALESCE(length(btrim(p_input->>'inspectionResult')), 0) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid packaging or inspection' USING ERRCODE = '22023';
  END IF;

  p_input := jsonb_build_object(
    'packagedDate', packaged_on, 'quantity', quantity, 'specification', btrim(p_input->>'specification'),
    'inspectionDate', inspected_on, 'inspectionUnit', btrim(p_input->>'inspectionUnit'),
    'inspectionResult', btrim(p_input->>'inspectionResult')
  );
  IF packaging.transport_id IS NOT NULL THEN
    IF packaging.snapshot @> p_input THEN RETURN packaging.snapshot; END IF;
    RAISE EXCEPTION 'Packaging already confirmed' USING ERRCODE = 'PT409';
  END IF;

  SELECT batch_id INTO STRICT lot_batch FROM public.harvest_lots WHERE id = trip.harvest_lot_id;
  INSERT INTO public.lot_packaging(transport_id, lot_id, event_id, snapshot)
    VALUES (trip.id, trip.harvest_lot_id, 'QUALITY_INSPECTION_RECORDED:' || trip.id,
      p_input || jsonb_build_object('lotId', trip.harvest_lot_id, 'transportId', trip.id,
        'transportCode', trip.transport_code, 'distributorName', distributor, 'confirmedAt', clock_timestamp()))
    RETURNING * INTO packaging;

  INSERT INTO public.blockchain_outbox(event_id, batch_id, entity_type, entity_id, event_type, payload)
    VALUES (packaging.event_id, lot_batch, 'LOT_PACKAGING', trip.id, 'QUALITY_INSPECTION_RECORDED', packaging.snapshot);
  RETURN packaging.snapshot;
END;
$$;

CREATE FUNCTION public.manage_received_lot_qr(
  p_actor UUID, p_transport UUID, p_action TEXT DEFAULT 'GET', p_reason TEXT DEFAULT NULL, p_trace_code UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result JSONB;
  packaged BOOLEAN;
BEGIN
  IF p_action IN ('ISSUE', 'REISSUE') THEN
    packaged := public.received_lot_packaging(p_actor, p_transport) IS NOT NULL;
    IF NOT packaged THEN
      RAISE EXCEPTION 'Packaging confirmation required' USING ERRCODE = 'PT412';
    END IF;
  END IF;
  result := public.manage_received_lot_qr_before_packaging(p_actor, p_transport, p_action, p_reason, p_trace_code);
  IF p_action = 'GET' THEN
    packaged := EXISTS (SELECT 1 FROM public.lot_packaging WHERE transport_id = p_transport);
    IF NOT packaged THEN
      result := result || '{"canIssue":false,"canReissue":false}'::JSONB;
    END IF;
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.received_lot_packaging(UUID, UUID, JSONB),
  public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.received_lot_packaging(UUID, UUID, JSONB),
  public.manage_received_lot_qr(UUID, UUID, TEXT, TEXT, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
