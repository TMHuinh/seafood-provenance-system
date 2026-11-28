BEGIN;
DO $$
DECLARE
  cooperative uuid := gen_random_uuid(); household uuid := gen_random_uuid();
  manager uuid := gen_random_uuid(); representative uuid := gen_random_uuid();
  worker uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  inv_a uuid; inv_b uuid; result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (manager),(representative),(worker),(outsider);
  INSERT INTO user_profiles(id,full_name,email,role) VALUES
    (manager,'Manager','manager@staff.example','FARMER'),
    (representative,'Representative','representative@staff.example','FARMER'),
    (worker,'Worker','worker@staff.example','FARMER'),
    (outsider,'Outsider','outsider@staff.example','FARMER');
  INSERT INTO organizations(id,name,type) VALUES
    (cooperative,'Staff test coop','COOPERATIVE'),(household,'Staff test household','FARMER_HOUSEHOLD');
  INSERT INTO organization_memberships(user_id,organization_id,role) VALUES
    (manager,cooperative,'MANAGER'),(representative,household,'REPRESENTATIVE');
  inv_a := (org_invite_staff(manager,cooperative,' WORKER@STAFF.EXAMPLE ')->>'id')::uuid;
  inv_b := (org_invite_staff(representative,household,'worker@staff.example')->>'id')::uuid;
  IF (org_invite_staff(manager,cooperative,'worker@staff.example')->>'id')::uuid IS DISTINCT FROM inv_a THEN
    RAISE EXCEPTION 'Staff invitation retry was not idempotent';
  END IF;
  IF jsonb_array_length(org_invitations(worker)->'invitations') <> 2 THEN
    RAISE EXCEPTION 'Recipient does not see their pending invitations';
  END IF;
  BEGIN
    PERFORM org_respond_invite(outsider,inv_a,true,false,'{}');
    RAISE EXCEPTION 'Another user accepted the staff invitation';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  PERFORM org_respond_invite(worker,inv_a,true,false,'{}');
  PERFORM org_respond_invite(worker,inv_b,true,false,'{}');
  IF (SELECT count(*) FROM organization_memberships
      WHERE user_id=worker AND role='STAFF' AND tstzrange(starts_at,ends_at,'[)') @> clock_timestamp())<>2 THEN
    RAISE EXCEPTION 'Accepting did not start both active memberships';
  END IF;
  -- In the API the workspace is a subsequent statement. Move the fixture to
  -- this statement's timestamp since the entire SQL scenario runs in one DO.
  UPDATE organization_memberships SET starts_at=statement_timestamp() WHERE user_id=worker;
  result := org_workspace(worker);
  IF jsonb_array_length(result->'memberships') <> 2
    OR EXISTS(SELECT FROM jsonb_array_elements(result->'memberships') m
      WHERE m->>'role'<>'STAFF' OR m->'permissions'<>'[]'::jsonb OR m->>'membership_id' IS NULL)
    OR org_is_manager(worker,cooperative) THEN
    RAISE EXCEPTION 'Staff must have separate memberships without default elevated permissions';
  END IF;
  BEGIN
    PERFORM org_respond_invite(worker,inv_a,true,false,'{}');
    RAISE EXCEPTION 'Same staff invitation was processed twice';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  IF has_function_privilege('authenticated','public.org_invite_staff(uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Client roles must not invoke the invitation RPC directly';
  END IF;
END $$;
ROLLBACK;
