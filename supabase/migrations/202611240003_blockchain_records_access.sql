-- Application APIs read proof metadata using the backend service role.
-- Restrict direct table access now that records can contain signed transactions.
BEGIN;

ALTER TABLE public.blockchain_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blockchain_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.blockchain_records TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
