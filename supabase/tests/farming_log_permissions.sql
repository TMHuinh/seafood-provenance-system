BEGIN;

DO $$
DECLARE
  org uuid := gen_random_uuid(); author uuid := gen_random_uuid(); verifier uuid := gen_random_uuid();
  former_verifier uuid := gen_random_uuid();
  farm uuid := gen_random_uuid(); pond uuid := gen_random_uuid(); batch uuid := gen_random_uuid();
  log_id uuid; previous_version uuid; next_version uuid; updated_at timestamptz; draft jsonb; confirmed jsonb;
  hash text := repeat('a',64); correction_hash text := repeat('b',64); event text;
BEGIN
  INSERT INTO auth.users(id) VALUES(author),(verifier),(former_verifier);
  INSERT INTO public.organizations(id,name,type) VALUES(org,'Log permission fixture','FARMER_HOUSEHOLD');
  INSERT INTO public.user_profiles(id,full_name,role)
    VALUES(author,'Minh','FARMER'),(verifier,'Cường','FARMER'),(former_verifier,'Vân','FARMER');
  INSERT INTO public.organization_memberships(organization_id,user_id,role,permissions)
    VALUES(org,author,'STAFF','{}'),(org,verifier,'REPRESENTATIVE',ARRAY['LOG_CONFIRM']);
  INSERT INTO public.farms(id,organization_id,owner_id,farm_name) VALUES(farm,org,verifier,'Production farm');
  INSERT INTO public.ponds(id,farm_id,pond_code,pond_name) VALUES(pond,farm,'LOG-SCOPE','Pond A');
  INSERT INTO public.pond_assignments(pond_id,organization_id,user_id,permissions,granted_by)
    VALUES(pond,org,author,ARRAY['READ','LOG_CREATE','LOG_EDIT'],verifier);
  INSERT INTO public.batches(id,pond_id,batch_code,species,seed_quantity,stocking_date,status)
    VALUES(batch,pond,'LOG-SCOPE','SHRIMP',100,now()-interval '5 days','GROWING');
  draft := public.create_farming_log_draft(author,batch,now(),'FEEDING','{}',NULL);
  log_id := (draft->>'id')::uuid;
  updated_at := (draft->>'updated_at')::timestamptz;
  IF draft->>'author_name' IS DISTINCT FROM 'Minh' THEN RAISE EXCEPTION 'Draft lost author attribution'; END IF;
  BEGIN
    PERFORM public.reserve_farming_log_anchor(author,log_id,updated_at,'CONFIRM',hash);
    RAISE EXCEPTION 'Author confirmed without the separate permission';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  event := public.reserve_farming_log_anchor(verifier,log_id,updated_at,'CONFIRM',hash);
  IF event IS DISTINCT FROM public.reserve_farming_log_anchor(verifier,log_id,updated_at,'CONFIRM',hash) THEN
    RAISE EXCEPTION 'Retry created another anchor event';
  END IF;
  BEGIN
    PERFORM public.apply_farming_log_change(author,log_id,updated_at,'EDIT',
      jsonb_build_object('log_date',now(),'log_type','FEEDING','details','{"quantity":20}'::jsonb),NULL,NULL);
    RAISE EXCEPTION 'Pending blockchain anchor did not protect its payload';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  INSERT INTO public.farming_log_versions(farming_log_id,version_number,log_date,log_type,details,data_hash,blockchain_event_id,corrected_by,confirmed_at)
    VALUES(log_id,1,now(),'FEEDING','{}',hash,event,former_verifier,now()) RETURNING id INTO previous_version;
  UPDATE public.blockchain_records SET status='SUCCESS' WHERE event_id=event;
  confirmed := public.apply_farming_log_change(verifier,log_id,updated_at,'CONFIRM',NULL,previous_version,NULL);
  IF confirmed->>'author_name' IS DISTINCT FROM 'Minh' OR confirmed->>'confirmer_name' IS DISTINCT FROM 'Cường'
    OR (confirmed->>'confirmed_by')::uuid IS DISTINCT FROM verifier
    OR (confirmed->>'created_by')::uuid IS DISTINCT FROM author
    OR NOT EXISTS (SELECT FROM public.audit_logs WHERE entity_id=log_id AND user_id=verifier AND action='CONFIRM') THEN
    RAISE EXCEPTION 'Confirmation failed to preserve original authorship and audit';
  END IF;
  updated_at := (confirmed->>'updated_at')::timestamptz;
  event := public.reserve_farming_log_anchor(verifier,log_id,updated_at,'CORRECT',correction_hash);
  INSERT INTO public.farming_log_versions(farming_log_id,version_number,log_date,log_type,details,data_hash,
    blockchain_event_id,corrected_by,confirmed_at,correction_reason,supersedes_version_id)
    VALUES(log_id,2,now(),'FEEDING','{"quantity":20}',correction_hash,event,verifier,now(),'Corrected observation',previous_version)
    RETURNING id INTO next_version;
  UPDATE public.blockchain_records SET status='SUCCESS' WHERE event_id=event;
  confirmed := public.apply_farming_log_change(verifier,log_id,updated_at,'CORRECT',NULL,next_version,NULL);
  IF confirmed->>'author_name' IS DISTINCT FROM 'Minh' OR (confirmed->>'current_version')::int <> 2
    OR NOT EXISTS(SELECT FROM public.farming_log_versions WHERE id=previous_version AND status='SUPERSEDED' AND details='{}'::jsonb)
    OR NOT EXISTS(SELECT FROM public.farming_log_versions WHERE id=next_version AND status='ACTIVE') THEN
    RAISE EXCEPTION 'Correction damaged the original immutable version or author';
  END IF;
END $$;

ROLLBACK;
