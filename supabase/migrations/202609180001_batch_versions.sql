-- Run this migration before deploying the batch correction API.
-- UP chạy trực tiếp; DOWN nằm trong khối chú thích cuối file.
-- migrate:up
ALTER TYPE public.blockchain_event_type ADD VALUE IF NOT EXISTS 'BATCH_CORRECTED';

BEGIN;
ALTER TABLE public.batches
  ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0);

CREATE TABLE public.batch_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.batches(id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  snapshot JSONB NOT NULL,
  correction_reason TEXT,
  corrected_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  blockchain_event_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, version_number),
  CHECK (version_number = 1 OR (
    correction_reason IS NOT NULL AND LENGTH(BTRIM(correction_reason)) BETWEEN 3 AND 1000
  ))
);
ALTER TABLE public.batch_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.batch_versions TO service_role;

-- Existing rows are a migration-time baseline, not proof of their original contents.
INSERT INTO public.batch_versions (batch_id, version_number, snapshot, blockchain_event_id)
SELECT id, 1, to_jsonb(b), 'BATCH_CREATED:' || id::TEXT FROM public.batches b;

CREATE FUNCTION public.capture_batch_creation() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  INSERT INTO public.batch_versions (batch_id, version_number, snapshot, blockchain_event_id)
  VALUES (NEW.id, 1, to_jsonb(NEW), 'BATCH_CREATED:' || NEW.id::TEXT);
  RETURN NEW;
END;
$$;
CREATE TRIGGER capture_batch_creation AFTER INSERT ON public.batches
FOR EACH ROW EXECUTE FUNCTION public.capture_batch_creation();

-- Lock, check the version, update and preserve the snapshot in one transaction.
CREATE FUNCTION public.correct_batch(
  p_id UUID, p_pond_id UUID, p_expected_version INTEGER,
  p_changes JSONB, p_reason TEXT, p_actor UUID
) RETURNS public.batches
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  old_batch public.batches;
  candidate public.batches;
  result public.batches;
BEGIN
  SELECT * INTO old_batch FROM public.batches
    WHERE id = p_id AND pond_id = p_pond_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_version IS NULL OR old_batch.current_version <> p_expected_version THEN
    RAISE EXCEPTION 'Batch version conflict' USING ERRCODE = '40001';
  END IF;
  IF p_reason IS NULL OR LENGTH(BTRIM(p_reason)) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Invalid correction reason' USING ERRCODE = '22023';
  END IF;
  candidate := jsonb_populate_record(old_batch, p_changes);
  UPDATE public.batches SET
    batch_code = candidate.batch_code, species = candidate.species,
    seed_source = candidate.seed_source, seed_quantity = candidate.seed_quantity,
    stocking_date = candidate.stocking_date,
    expected_harvest_date = candidate.expected_harvest_date,
    actual_harvest_date = candidate.actual_harvest_date,
    yield_quantity = candidate.yield_quantity, status = candidate.status, note = candidate.note,
    current_version = old_batch.current_version + 1
  WHERE id = p_id RETURNING * INTO result;
  INSERT INTO public.batch_versions (
    batch_id, version_number, snapshot, correction_reason, corrected_by, blockchain_event_id
  ) VALUES (
    result.id, result.current_version, to_jsonb(result), BTRIM(p_reason), p_actor,
    'BATCH_CORRECTED:' || result.id::TEXT || ':v' || result.current_version::TEXT
  );
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.correct_batch(UUID, UUID, INTEGER, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_batch(UUID, UUID, INTEGER, JSONB, TEXT, UUID) TO service_role;
COMMIT;

-- migrate:down
-- Để hoàn tác: chỉ sao chép SQL bên trong khối dưới sang truy vấn riêng và chạy.
-- Không chạy lại phần UP khi thực hiện DOWN.
/*
-- Deletes ALL batch version snapshots and correction reasons.
-- Back up batch_versions and deploy compatible application code before running.
-- Keeps current batch contents, blockchain_records and on-chain events.
-- BATCH_CORRECTED remains in the enum because existing records can reference it.
-- Do not automatically rerun UP: version numbers restart and can collide with
-- immutable BATCH_CORRECTED:<batchId>:v<version> events already on chain.

BEGIN;

DROP TRIGGER IF EXISTS capture_batch_creation ON public.batches;
DROP FUNCTION IF EXISTS public.capture_batch_creation();
DROP FUNCTION IF EXISTS public.correct_batch(UUID, UUID, INTEGER, JSONB, TEXT, UUID);

DROP TABLE IF EXISTS public.batch_versions;
ALTER TABLE public.batches DROP COLUMN IF EXISTS current_version;

COMMIT;
*/
