-- QR reissue recreates the publication RPC after the earlier business-conflict fix.
-- Preserve its new signature and behavior while avoiding serialization retries.
BEGIN;
DO $$
BEGIN
  EXECUTE replace(
    pg_get_functiondef('public.manage_received_lot_qr(uuid,uuid,text,text,uuid)'::regprocedure),
    '''40001''', '''PT409'''
  );
END;
$$;
NOTIFY pgrst, 'reload schema';
COMMIT;
