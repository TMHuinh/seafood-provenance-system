-- Vòng đời nhật ký: nháp, xác nhận, đính chính và thu hồi.

BEGIN;

ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'REVOKE';

ALTER TABLE public.farming_logs
  ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN current_version_id UUID,
  ADD CONSTRAINT farming_logs_lifecycle_status_valid
    CHECK (lifecycle_status IN ('DRAFT', 'CONFIRMED', 'REVOKED'));

ALTER TABLE public.farming_log_versions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN supersedes_version_id UUID
    REFERENCES public.farming_log_versions(id) ON DELETE RESTRICT,
  ADD COLUMN evidence_url TEXT,
  ADD COLUMN block_number BIGINT,
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD COLUMN revoked_by UUID REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD COLUMN revocation_reason TEXT,
  ADD CONSTRAINT farming_log_versions_status_valid
    CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'REVOKED', 'FAILED')),
  ADD CONSTRAINT farming_log_versions_revocation_complete
    CHECK (
      status <> 'REVOKED'
      OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND LENGTH(BTRIM(revocation_reason)) >= 3)
    );

UPDATE public.farming_logs SET lifecycle_status = 'CONFIRMED';

UPDATE public.farming_logs AS log
SET current_version_id = version.id
FROM public.farming_log_versions AS version
WHERE version.farming_log_id = log.id
  AND version.version_number = log.current_version;

ALTER TABLE public.farming_logs
  ADD CONSTRAINT farming_logs_current_version_id_fkey
    FOREIGN KEY (current_version_id)
    REFERENCES public.farming_log_versions(id)
    ON DELETE RESTRICT;

CREATE INDEX idx_farming_log_versions_supersedes
  ON public.farming_log_versions(supersedes_version_id);

COMMIT;
