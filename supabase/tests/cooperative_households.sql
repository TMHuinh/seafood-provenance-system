-- Run against a disposable migrated database as its owner.
BEGIN;
DO $$
DECLARE
  coop_a uuid := gen_random_uuid(); coop_b uuid := gen_random_uuid();
  house_a uuid := gen_random_uuid(); house_b uuid := gen_random_uuid();
  boss_a uuid := gen_random_uuid(); boss_b uuid := gen_random_uuid();
  rep_a uuid := gen_random_uuid(); rep_b uuid := gen_random_uuid();
  farm uuid := gen_random_uuid(); pond uuid := gen_random_uuid();
  old_batch uuid := gen_random_uuid(); new_batch uuid := gen_random_uuid();
  old_log uuid := gen_random_uuid(); new_log uuid := gen_random_uuid();
  harvest_id uuid := gen_random_uuid(); lot_id uuid := gen_random_uuid();
  first_invite uuid; second_invite uuid; other_invite uuid; expired_invite uuid; relation_id uuid;
  user_id uuid; view_data jsonb; joined timestamptz;
BEGIN
  INSERT INTO organizations(id,name,type) VALUES (coop_a,'Test HTX A','COOPERATIVE'),(coop_b,'Test HTX B','COOPERATIVE'),
    (house_a,'Test hộ A','FARMER_HOUSEHOLD'),(house_b,'Test hộ B','FARMER_HOUSEHOLD');
  FOREACH user_id IN ARRAY ARRAY[boss_a,boss_b,rep_a,rep_b] LOOP
    INSERT INTO auth.users(id) VALUES (user_id);
    INSERT INTO user_profiles(id,full_name,role) VALUES (user_id,'Test user','FARMER');
  END LOOP;
  INSERT INTO organization_memberships(organization_id,user_id,role) VALUES
    (coop_a,boss_a,'MANAGER'),(coop_b,boss_b,'MANAGER'),(house_a,rep_a,'REPRESENTATIVE'),(house_b,rep_b,'REPRESENTATIVE');
  INSERT INTO farms(id,owner_id,organization_id,farm_name) VALUES(farm,rep_a,house_a,'Test Farm');
  INSERT INTO ponds(id,farm_id,pond_code,pond_name) VALUES(pond,farm,'P1','Test Pond');
  INSERT INTO batches(id,pond_id,batch_code,species,seed_quantity,stocking_date,status,created_at) VALUES
    (old_batch,pond,'HTX-OLD','SHRIMP',100,now()-interval '1 month','GROWING',now()-interval '1 month');
  INSERT INTO farming_logs(id,batch_id,created_by,log_type,lifecycle_status,log_date,created_at) VALUES
    (old_log,old_batch,rep_a,'FEEDING','CONFIRMED',now()-interval '1 week',now()-interval '1 week');

  BEGIN
    PERFORM org_invite_household(rep_a,coop_a,house_b);
    RAISE EXCEPTION 'Unauthorized sender';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  first_invite := (org_invite_household(boss_a,coop_a,house_a)->>'id')::uuid;
  IF first_invite IS DISTINCT FROM (org_invite_household(boss_a,coop_a,house_a)->>'id')::uuid THEN
    RAISE EXCEPTION 'Duplicate pending invitation';
  END IF;
  second_invite := (org_invite_household(boss_b,coop_b,house_a)->>'id')::uuid;
  other_invite := (org_invite_household(boss_a,coop_a,house_b)->>'id')::uuid;
  IF (org_respond_invite(rep_b,other_invite,false,false,'{}'::uuid[])->>'status') <> 'REJECTED' THEN
    RAISE EXCEPTION 'Rejection not recorded';
  END IF;
  expired_invite := (org_invite_household(boss_a,coop_a,house_b)->>'id')::uuid;
  UPDATE organization_invitations SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE id=expired_invite;
  BEGIN
    PERFORM org_respond_invite(rep_b,expired_invite,true,false,'{}'::uuid[]);
    RAISE EXCEPTION 'Expired invitation accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  other_invite := (org_invite_household(boss_a,coop_a,house_b)->>'id')::uuid;
  PERFORM org_cancel_invite(boss_a,other_invite);
  BEGIN
    PERFORM org_respond_invite(rep_b,other_invite,true,false,'{}'::uuid[]);
    RAISE EXCEPTION 'Cancelled invitation accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    PERFORM org_respond_invite(rep_b,first_invite,true,false,'{}'::uuid[]);
    RAISE EXCEPTION 'Wrong household responded';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  IF jsonb_array_length(org_households(boss_a,coop_a)->'households') <> 0 THEN
    RAISE EXCEPTION 'Household available before consent';
  END IF;
  PERFORM org_respond_invite(rep_a,first_invite,true,false,'{}'::uuid[]);
  SELECT id,joined_at INTO STRICT relation_id,joined FROM cooperative_households WHERE invitation_id=first_invite;
  BEGIN
    PERFORM org_respond_invite(rep_a,first_invite,true,false,'{}'::uuid[]);
    RAISE EXCEPTION 'Invitation accepted twice';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    PERFORM org_respond_invite(rep_a,second_invite,true,false,'{}'::uuid[]);
    RAISE EXCEPTION 'Household joined two cooperatives';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;

  INSERT INTO batches(id,pond_id,batch_code,species,seed_quantity,stocking_date,status,created_at)
    VALUES (new_batch,pond,'HTX-NEW','SHRIMP',100,date_trunc('day',joined,'Asia/Ho_Chi_Minh'),'GROWING',joined);
  INSERT INTO farming_logs(id,batch_id,created_by,log_type,lifecycle_status,log_date,created_at)
    VALUES(new_log,new_batch,rep_a,'FEEDING','CONFIRMED',joined,joined);
  INSERT INTO harvests(id,batch_id,harvest_date,quantity,created_by) VALUES(harvest_id,old_batch,joined,25,rep_a);
  INSERT INTO harvest_lots(id,lot_code,batch_id,harvest_id,request_id,quantity,provenance,blockchain_event_id,created_at)
    VALUES(lot_id,'HTX-LOT',old_batch,harvest_id,gen_random_uuid(),25,'{}','HTX-TEST-LOT',joined);
  view_data := org_household_data(boss_a,coop_a,relation_id);
  IF jsonb_array_length(view_data->'batches') <> 1 OR view_data #>> '{batches,0,id}' <> new_batch::text
    OR jsonb_array_length(view_data->'logs') <> 0 OR view_data #>> '{lots,0,id}' <> lot_id::text
    OR (view_data #> '{lots,0}') ? 'provenance' OR pond_can(boss_a,pond,'LOG_EDIT') THEN
    RAISE EXCEPTION 'Default consent exposed unsupported fields, omitted a new lot, or granted edit access';
  END IF;
  BEGIN
    PERFORM org_household_data(boss_b,coop_b,relation_id);
    RAISE EXCEPTION 'Unrelated cooperative read data';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  IF jsonb_array_length(org_share_candidates(rep_a,house_a)->'batches') <> 1 THEN
    RAISE EXCEPTION 'Current batches should not enable history opt-in';
  END IF;
  PERFORM org_change_sharing(rep_a,house_a,relation_id,true,ARRAY[old_batch]);
  view_data := org_household_data(boss_a,coop_a,relation_id);
  IF jsonb_array_length(view_data->'batches') <> 2 OR jsonb_array_length(view_data->'logs') <> 2 THEN
    RAISE EXCEPTION 'Explicit history consent was not honored';
  END IF;
  PERFORM org_change_sharing(rep_a,house_a,relation_id,false,'{}'::uuid[]);
  view_data := org_household_data(boss_a,coop_a,relation_id);
  IF jsonb_array_length(view_data->'sharingHistory') <> 3
    OR jsonb_array_length(view_data->'logs') <> 0 THEN
    RAISE EXCEPTION 'Revoked sharing remained visible or consent history was lost';
  END IF;
  PERFORM org_leave_cooperative(rep_a,house_a,relation_id);
  BEGIN
    PERFORM org_household_data(boss_a,coop_a,relation_id);
    RAISE EXCEPTION 'Cooperative retained access after departure';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  IF NOT EXISTS(SELECT FROM harvest_lots WHERE id=lot_id)
    OR (SELECT organization_id FROM farms WHERE id=farm) <> house_a THEN
    RAISE EXCEPTION 'Leaving removed provenance or changed ownership';
  END IF;
END $$;
ROLLBACK;
