BEGIN;

DO $$
DECLARE
  household uuid := gen_random_uuid();
  staff uuid := gen_random_uuid(); verifier uuid := gen_random_uuid();
  farm uuid := gen_random_uuid(); pond uuid := gen_random_uuid();
  outside_pond uuid := gen_random_uuid();
  batch uuid := gen_random_uuid(); outside_batch uuid := gen_random_uuid();
  draft_id uuid := gen_random_uuid(); first jsonb; replay jsonb;
  harvest_id uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES (staff),(verifier);
  INSERT INTO public.organizations(id,name,type) VALUES (household,'Harvest scope fixture','FARMER_HOUSEHOLD');
  INSERT INTO public.user_profiles(id,full_name,role) VALUES (staff,'Minh','FARMER'),(verifier,'Cường','FARMER');
  INSERT INTO public.organization_memberships(organization_id,user_id,role,permissions)
    VALUES (household,staff,'STAFF','{}'),(household,verifier,'REPRESENTATIVE',ARRAY['HARVEST_CONFIRM']);
  INSERT INTO public.farms(id,organization_id,owner_id,farm_name) VALUES (farm,household,verifier,'Production farm');
  INSERT INTO public.ponds(id,farm_id,pond_code,pond_name)
    VALUES (pond,farm,'PRODUCTION-A','Pond A'),(outside_pond,farm,'PRODUCTION-B','Pond B');
  INSERT INTO public.pond_assignments(pond_id,organization_id,user_id,permissions,granted_by)
    VALUES (pond,household,staff,ARRAY['READ','HARVEST_CREATE','HARVEST_EDIT'],verifier);
  INSERT INTO public.batches(id,pond_id,batch_code,species,seed_quantity,stocking_date,status)
    VALUES (batch,pond,'PRODUCTION-A','SHRIMP',100,now()-interval '5 days','GROWING'),
      (outside_batch,outside_pond,'PRODUCTION-B','SHRIMP',100,now()-interval '5 days','GROWING');

  first := public.create_harvest_draft(batch,pond,staff,draft_id,current_date,10,false,'first');
  replay := public.create_harvest_draft(batch,pond,staff,draft_id,current_date,10,false,'first');
  IF first->>'id' IS DISTINCT FROM replay->>'id' OR EXISTS(SELECT FROM public.harvests WHERE batch_id=batch) THEN
    RAISE EXCEPTION 'Saving and retrying a draft must not create a confirmed harvest';
  END IF;
  BEGIN
    PERFORM public.confirm_harvest_draft(batch,pond,staff,draft_id,1);
    RAISE EXCEPTION 'Draft creator confirmed without the separate permission';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.record_batch_harvest(batch,pond,staff,gen_random_uuid(),current_date,10,false,NULL);
    RAISE EXCEPTION 'Legacy one-step recording bypassed confirmation permission';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.edit_harvest_draft(outside_batch,outside_pond,staff,draft_id,1,current_date,12,false,NULL);
    RAISE EXCEPTION 'Wrong batch or pond could edit a draft';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  first := public.edit_harvest_draft(batch,pond,staff,draft_id,1,current_date,12,false,'updated');
  IF (first->>'version')::int <> 2 THEN RAISE EXCEPTION 'Draft edit must advance its version'; END IF;
  BEGIN
    PERFORM public.confirm_harvest_draft(batch,pond,verifier,draft_id,1);
    RAISE EXCEPTION 'Stale version could be confirmed';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  first := public.confirm_harvest_draft(batch,pond,verifier,draft_id,2);
  replay := public.confirm_harvest_draft(batch,pond,verifier,draft_id,2);
  harvest_id := (first->'harvest'->>'id')::uuid;
  IF (replay->'harvest'->>'id')::uuid IS DISTINCT FROM harvest_id
    OR (replay->>'replayed')::boolean IS NOT TRUE
    OR (first->'harvest'->>'created_by')::uuid IS DISTINCT FROM staff
    OR (first->'harvest'->>'quantity')::numeric IS DISTINCT FROM 12
    OR NOT EXISTS (SELECT FROM public.audit_logs WHERE user_id=verifier AND entity_id=harvest_id AND action='CONFIRM') THEN
    RAISE EXCEPTION 'Confirmation must keep the draft author and record the verifier exactly once';
  END IF;
  BEGIN
    PERFORM public.edit_harvest_draft(batch,pond,staff,draft_id,2,current_date,13,false,NULL);
    RAISE EXCEPTION 'A confirmed harvest must remain immutable';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  IF has_table_privilege('authenticated','public.harvest_drafts','SELECT')
    OR has_function_privilege('anon','public.confirm_harvest_draft(uuid,uuid,uuid,uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'End users must not access draft data directly';
  END IF;
END $$;

ROLLBACK;
