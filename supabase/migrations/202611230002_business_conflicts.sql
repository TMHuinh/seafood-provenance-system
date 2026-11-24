-- Business preconditions must not use SQLSTATE serialization_failure:
-- PostgREST retries 40001 internally; an unchanged precondition can never recover.
BEGIN;
DO $$
DECLARE target RECORD;
BEGIN
  FOR target IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'correct_batch', 'record_lot_transport', 'claim_lot_transport',
      'update_lot_transport_status', 'report_lot_transport_delivery',
      'confirm_lot_transport_delivery', 'assign_lot_transport_recipient',
      'record_transport_checkpoint', 'record_lot_transport_tracking_update',
      'manage_received_lot_qr'
    )
  LOOP
    -- Preserve the exact existing function body/signature, SECURITY DEFINER and grants.
    EXECUTE replace(pg_get_functiondef(target.oid), '''40001''', '''PT409''');
  END LOOP;
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
