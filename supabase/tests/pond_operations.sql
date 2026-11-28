-- Run against a disposable migrated database as its owner.
BEGIN;
DO $$
DECLARE
  house uuid := gen_random_uuid(); coop uuid := gen_random_uuid(); other_coop uuid := gen_random_uuid();
  rep uuid := gen_random_uuid(); boss uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  minh uuid := gen_random_uuid(); cuong uuid := gen_random_uuid(); person uuid;
  farm uuid := gen_random_uuid(); pond uuid := gen_random_uuid(); batch uuid := gen_random_uuid();
  log_id uuid := gen_random_uuid(); cuong_member uuid; rep_member uuid; previous_rep_member uuid; assigned uuid; scheduled uuid;
  handover uuid; relation_id uuid; invitation uuid; result jsonb; planned_at timestamptz := now()+interval '1 day';
BEGIN
  INSERT INTO organizations(id,name,type) VALUES (house,'Test household','FARMER_HOUSEHOLD'),
    (coop,'Test cooperative','COOPERATIVE'),(other_coop,'Other cooperative','COOPERATIVE');
  FOREACH person IN ARRAY ARRAY[rep,boss,outsider,minh,cuong] LOOP
    INSERT INTO auth.users(id) VALUES(person);
    INSERT INTO user_profiles(id,full_name,role) VALUES(person,'Operations test','FARMER');
  END LOOP;
  INSERT INTO organization_memberships(organization_id,user_id,role) VALUES (house,rep,'REPRESENTATIVE')
    RETURNING id INTO rep_member;
  INSERT INTO organization_memberships(organization_id,user_id,role,starts_at,ends_at)
    VALUES (house,rep,'REPRESENTATIVE',now()-interval '2 years',now()-interval '1 year') RETURNING id INTO previous_rep_member;
  INSERT INTO organization_memberships(organization_id,user_id,role) VALUES
    (coop,boss,'MANAGER'),(other_coop,outsider,'MANAGER'),(house,minh,'STAFF');
  INSERT INTO organization_memberships(organization_id,user_id,role) VALUES (house,cuong,'STAFF')
    RETURNING id INTO cuong_member;
  INSERT INTO farms(id,owner_id,organization_id,farm_name) VALUES(farm,rep,house,'Pond operations farm');
  INSERT INTO ponds(id,farm_id,pond_code,pond_name) VALUES(pond,farm,'POND-OPS','Pond operations');
  INSERT INTO batches(id,pond_id,batch_code,species,seed_quantity,stocking_date,status)
    VALUES(batch,pond,'BATCH-OPS','SHRIMP',100,current_date,'GROWING');
  INSERT INTO farming_logs(id,batch_id,created_by,log_type,log_date,lifecycle_status)
    VALUES(log_id,batch,minh,'FEEDING',now(),'CONFIRMED');

  IF jsonb_array_length(org_staff(rep,house)->'staff') <> 3 OR pond_can(minh,pond,'READ') THEN
    RAISE EXCEPTION 'Membership listing or default empty pond scope failed';
  END IF;
  BEGIN
    PERFORM org_remove_staff(rep,house,rep_member);
    RAISE EXCEPTION 'Manager removed by the staff-only operation';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  PERFORM org_member_permissions(rep,house,rep_member,ARRAY['LOG_CONFIRM']);
  IF NOT pond_can(rep,pond,'LOG_CONFIRM') OR pond_can(rep,pond,'HARVEST_CONFIRM') THEN
    RAISE EXCEPTION 'Explicit confirmation was not separated by action';
  END IF;
  BEGIN
    PERFORM org_member_permissions(rep,house,previous_rep_member,ARRAY['LOG_CONFIRM']);
    RAISE EXCEPTION 'A previous management term was edited through the current term';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;

  assigned := (org_set_assignment(rep,house,pond,minh,ARRAY['READ','LOG_CREATE'],NULL,NULL,NULL)->>'id')::uuid;
  scheduled := (org_set_assignment(rep,house,pond,cuong,ARRAY['READ','LOG_CREATE'],NULL,assigned,planned_at)->>'id')::uuid;
  result := org_pond_operations(rep,house);
  IF (result #>> '{ponds,0,scheduled_assignment_id}')::uuid IS DISTINCT FROM scheduled
    OR (SELECT ends_at FROM pond_assignments WHERE id=assigned) IS DISTINCT FROM planned_at
    OR (SELECT starts_at FROM pond_assignments WHERE id=scheduled) IS DISTINCT FROM planned_at THEN
    RAISE EXCEPTION 'Scheduled replacement did not preserve the transition';
  END IF;
  BEGIN
    PERFORM org_set_assignment(rep,house,pond,cuong,ARRAY['READ'],NULL,assigned,planned_at+interval '1 day');
    RAISE EXCEPTION 'Second scheduled successor was allowed';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  PERFORM org_end_assignment(rep,house,scheduled);
  IF (SELECT ends_at FROM pond_assignments WHERE id=assigned) IS NOT NULL THEN
    RAISE EXCEPTION 'Canceling a successor did not restore the current assignment';
  END IF;
  scheduled := (org_set_assignment(rep,house,pond,cuong,ARRAY['READ','LOG_CREATE'],NULL,assigned,NULL)->>'id')::uuid;
  IF (SELECT ends_at FROM pond_assignments WHERE id=assigned) IS DISTINCT FROM
     (SELECT starts_at FROM pond_assignments WHERE id=scheduled)
    OR (SELECT created_by FROM farming_logs WHERE id=log_id) IS DISTINCT FROM minh THEN
    RAISE EXCEPTION 'Immediate replacement lost assignment continuity or the historical author';
  END IF;
  BEGIN
    PERFORM org_set_assignment(rep,house,pond,minh,ARRAY['READ'],NULL,assigned,NULL);
    RAISE EXCEPTION 'A stale client replaced the new assignee';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  PERFORM org_leave_staff(cuong,house,cuong_member);
  IF (SELECT ends_at FROM pond_assignments WHERE id=scheduled) IS NULL
    OR EXISTS (SELECT FROM jsonb_array_elements(org_staff(rep,house)->'staff') item WHERE item->>'id'=cuong_member::text)
    OR NOT EXISTS (SELECT FROM jsonb_array_elements(org_staff(rep,house)->'history') item
      WHERE item->>'id'=cuong_member::text AND item->>'ends_at' IS NOT NULL) THEN
    RAISE EXCEPTION 'Staff departure did not close assignment and membership';
  END IF;

  BEGIN
    PERFORM org_request_pond_handover(rep,house,pond,coop);
    RAISE EXCEPTION 'Handover to a cooperative without a relationship was allowed';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  invitation := (org_invite_household(boss,coop,house)->>'id')::uuid;
  PERFORM org_respond_household_invite(rep,invitation,true,false,'{}');
  SELECT id INTO STRICT relation_id FROM cooperative_households WHERE invitation_id=invitation;
  handover := (org_request_pond_handover(rep,house,pond,coop)->>'id')::uuid;
  BEGIN
    PERFORM org_respond_pond_handover(outsider,other_coop,handover,true);
    RAISE EXCEPTION 'Unrelated cooperative accepted a handover';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  PERFORM org_respond_pond_handover(boss,coop,handover,false);
  IF (SELECT status FROM pond_handovers WHERE id=handover) <> 'REJECTED' THEN
    RAISE EXCEPTION 'Rejection was not recorded';
  END IF;
  handover := (org_request_pond_handover(rep,house,pond,coop)->>'id')::uuid;
  PERFORM org_respond_pond_handover(boss,coop,handover,true);
  IF (org_pond_operations(boss,coop) #>> '{ponds,0,operator_organization_id}')::uuid IS DISTINCT FROM coop
    OR (SELECT organization_id FROM farms WHERE id=farm) IS DISTINCT FROM house THEN
    RAISE EXCEPTION 'Handover failed to transfer the operator while preserving ownership';
  END IF;
  BEGIN
    PERFORM org_leave_cooperative(rep,house,relation_id);
    RAISE EXCEPTION 'Departure while cooperative still operated a pond was allowed';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  PERFORM org_end_pond_handover(rep,house,handover);
  IF (org_pond_operations(rep,house) #>> '{ponds,0,operator_organization_id}')::uuid IS DISTINCT FROM house
    OR (SELECT status FROM pond_handovers WHERE id=handover) <> 'RETURNED' THEN
    RAISE EXCEPTION 'Returning the pond did not restore household operation';
  END IF;
  handover := (org_request_pond_handover(rep,house,pond,coop)->>'id')::uuid;
  PERFORM org_leave_cooperative(rep,house,relation_id);
  IF (SELECT status FROM pond_handovers WHERE id=handover) <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Successful departure left a pending handover';
  END IF;
END $$;
ROLLBACK;
