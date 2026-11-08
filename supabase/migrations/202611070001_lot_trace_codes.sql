-- Additive QR publication per harvest lot. Does NOT publish existing lots.
-- Apply manually after 202610260005_transport_success_in_tracking.sql.
BEGIN;
CREATE TABLE public.lot_trace_codes (
  lot_id UUID PRIMARY KEY REFERENCES public.harvest_lots(id) ON DELETE RESTRICT,
  trace_code UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND LENGTH(BTRIM(revocation_reason)) BETWEEN 3 AND 500 AND revocation_reason IS NOT NULL))
);
ALTER TABLE public.lot_trace_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lot_trace_codes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lot_trace_codes TO service_role;
-- No anonymous SQL policies: public reads are filtered by the Express API.
COMMIT;
