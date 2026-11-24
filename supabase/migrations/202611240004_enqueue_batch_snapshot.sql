-- Deploy the backend that handles batch_version_v1 before changing the trigger.
BEGIN;

CREATE OR REPLACE FUNCTION public.queue_batch_proof() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  event_type public.blockchain_event_type;
  farm UUID;
BEGIN
  IF NEW.blockchain_event_id LIKE 'BATCH_CREATED:%' THEN
    event_type := 'BATCH_CREATED';
    SELECT farm_id INTO STRICT farm FROM public.ponds WHERE id = (NEW.snapshot->>'pond_id')::UUID;
  ELSIF NEW.blockchain_event_id LIKE 'BATCH_CORRECTED:%' THEN
    event_type := 'BATCH_CORRECTED';
  ELSE
    -- Harvest versions already have their own outbox job.
    RETURN NEW;
  END IF;

  INSERT INTO public.blockchain_outbox(event_id, batch_id, entity_type, entity_id, event_type, payload)
  VALUES (NEW.blockchain_event_id, NEW.batch_id, 'BATCH', NEW.batch_id, event_type,
    jsonb_build_object('format', 'batch_version_v1', 'snapshot', NEW.snapshot,
      'farm_id', farm, 'correction_reason', NEW.correction_reason, 'corrected_by', NEW.corrected_by));
  RETURN NEW;
END;
$$;

COMMIT;
