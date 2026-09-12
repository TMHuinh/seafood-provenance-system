-- Lưu lịch sử phiên bản bất biến cho nhật ký nuôi.

BEGIN;

ALTER TABLE public.farming_logs
  ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT farming_logs_current_version_positive
    CHECK (current_version > 0);

ALTER TABLE public.blockchain_records
  ADD COLUMN IF NOT EXISTS event_id TEXT;

UPDATE public.blockchain_records
SET event_id = event_type::TEXT || ':' || entity_id::TEXT
WHERE event_id IS NULL;

ALTER TABLE public.blockchain_records
  ALTER COLUMN event_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_blockchain_records_event_id
  ON public.blockchain_records(event_id);

CREATE TABLE public.farming_log_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  farming_log_id UUID NOT NULL
    REFERENCES public.farming_logs(id)
    ON DELETE CASCADE,

  version_number INTEGER NOT NULL,
  log_date TIMESTAMPTZ NOT NULL,
  log_type public.farming_log_type NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  image_url TEXT,
  data_hash VARCHAR(255),
  tx_hash VARCHAR(255),
  blockchain_event_id TEXT NOT NULL,
  correction_reason TEXT,

  corrected_by UUID NOT NULL
    REFERENCES public.user_profiles(id)
    ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT farming_log_versions_number_positive
    CHECK (version_number > 0),
  CONSTRAINT farming_log_versions_reason_required
    CHECK (
      version_number = 1
      OR LENGTH(BTRIM(correction_reason)) BETWEEN 3 AND 1000
    ),
  CONSTRAINT farming_log_versions_unique_version
    UNIQUE (farming_log_id, version_number),
  CONSTRAINT farming_log_versions_unique_event
    UNIQUE (blockchain_event_id)
);

CREATE INDEX idx_farming_log_versions_log_id
  ON public.farming_log_versions(farming_log_id, version_number DESC);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.farming_log_versions
  TO service_role;

INSERT INTO public.farming_log_versions (
  farming_log_id,
  version_number,
  log_date,
  log_type,
  details,
  image_url,
  data_hash,
  tx_hash,
  blockchain_event_id,
  correction_reason,
  corrected_by,
  created_at
)
SELECT
  log.id,
  1,
  log.log_date,
  log.log_type,
  log.details,
  log.image_url,
  log.data_hash,
  log.tx_hash,
  'FARMING_LOG_RECORDED:' || log.id::TEXT,
  NULL,
  log.created_by,
  log.created_at
FROM public.farming_logs AS log
ON CONFLICT (farming_log_id, version_number) DO NOTHING;

COMMIT;
