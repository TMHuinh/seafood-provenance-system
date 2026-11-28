-- Run after applying the migrations on a disposable database.
BEGIN;
DO $$
DECLARE
  farmer uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  manager uuid := gen_random_uuid(); carrier uuid := gen_random_uuid();
  coop uuid := gen_random_uuid(); request_id uuid := gen_random_uuid();
  own_farm uuid := gen_random_uuid(); later_farm uuid := gen_random_uuid();
  foreign_farm uuid := gen_random_uuid(); coop_farm uuid := gen_random_uuid();
  pond uuid := gen_random_uuid(); batch uuid := gen_random_uuid();
  log uuid := gen_random_uuid(); invitation uuid; relation_id uuid;
  result jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES (farmer),(outsider),(manager),(carrier);
  INSERT INTO organizations(id,name,type) VALUES (coop,'HTX thử nghiệm','COOPERATIVE');
  INSERT INTO user_profiles(id,full_name,role,organization_id) VALUES
    (farmer,'Minh','FARMER',NULL),(outsider,'Cường','FARMER',NULL),
    (manager,'Quản lý HTX','FARMER',coop),(carrier,'Tài xế','TRANSPORTER',NULL);
  INSERT INTO organization_memberships(organization_id,user_id,role) VALUES
    (coop,manager,'MANAGER'),(coop,farmer,'STAFF');
  INSERT INTO farms(id,owner_id,organization_id,farm_name) VALUES
    (own_farm,farmer,NULL,'Cơ sở đã có dữ liệu'),(later_farm,farmer,NULL,'Cơ sở giữ riêng'),
    (foreign_farm,outsider,NULL,'Cơ sở người khác'),(coop_farm,farmer,coop,'Cơ sở đã có đơn vị');
  INSERT INTO ponds(id,farm_id,pond_code,pond_name) VALUES(pond,own_farm,'A','Ao A');
  INSERT INTO batches(id,pond_id,batch_code,species,seed_quantity,stocking_date,status)
    VALUES(batch,pond,'VU-HOUSEHOLD-SETUP','SHRIMP',100,now()-interval '10 days','GROWING');
  INSERT INTO farming_logs(id,batch_id,created_by,log_type) VALUES(log,batch,farmer,'FEEDING');

  result := org_household_setup_options(farmer);
  IF result->>'can_create'<>'true' OR jsonb_array_length(result->'farms')<>2
    OR NOT EXISTS(SELECT FROM jsonb_array_elements(result->'farms') f WHERE f->>'id'=own_farm::text AND f->>'pond_count'='1')
    OR (org_household_setup_options(carrier)->>'can_create')<>'false' THEN
    RAISE EXCEPTION 'Setup options must only list independent farms owned by that farmer';
  END IF;
  BEGIN
    PERFORM org_create_household_profile(carrier,gen_random_uuid(),'Không hợp lệ',NULL,'{}');
    RAISE EXCEPTION 'Non-farmer created a household';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM org_create_household_profile(farmer,request_id,'Hộ Minh',NULL,ARRAY[own_farm,foreign_farm]);
    RAISE EXCEPTION 'Farmer linked another user''s farm';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  BEGIN
    PERFORM org_create_household_profile(farmer,request_id,'Hộ Minh',NULL,ARRAY[coop_farm]);
    RAISE EXCEPTION 'Farmer moved a farm already associated with an organization';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;
  END;
  IF EXISTS(SELECT FROM organizations WHERE id=request_id)
    OR (SELECT organization_id FROM farms WHERE id=own_farm) IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid selection partially created or moved the household data';
  END IF;

  result := org_create_household_profile(farmer,request_id,'Hộ Minh',NULL,ARRAY[own_farm]);
  IF result->>'id'<>request_id::text OR result->>'linked_count'<>'1'
    OR NOT org_is_manager(farmer,request_id)
    OR (SELECT organization_id FROM user_profiles WHERE id=farmer) IS DISTINCT FROM request_id
    OR (SELECT organization_id FROM farms WHERE id=own_farm) IS DISTINCT FROM request_id
    OR (SELECT organization_id FROM farms WHERE id=later_farm) IS NOT NULL
    OR (SELECT owner_id FROM farms WHERE id=own_farm) IS DISTINCT FROM farmer
    OR (SELECT farm_id FROM ponds WHERE id=pond) IS DISTINCT FROM own_farm
    OR (SELECT pond_id FROM batches WHERE id=batch) IS DISTINCT FROM pond
    OR (SELECT created_by FROM farming_logs WHERE id=log AND batch_id=batch) IS DISTINCT FROM farmer
    OR pond_can(manager,pond,'READ')
    OR NOT EXISTS(SELECT FROM audit_logs WHERE entity_id=own_farm AND action='UPDATE' AND user_id=farmer) THEN
    RAISE EXCEPTION 'Created household did not preserve ownership, existing relationships and scope';
  END IF;
  IF result IS DISTINCT FROM org_create_household_profile(farmer,request_id,'Hộ Minh',NULL,ARRAY[own_farm]) THEN
    RAISE EXCEPTION 'Identical request did not return the original result';
  END IF;
  BEGIN
    PERFORM org_create_household_profile(farmer,request_id,'Tên khác',NULL,ARRAY[own_farm]);
    RAISE EXCEPTION 'Request reused with a different payload';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    PERFORM org_create_household_profile(farmer,gen_random_uuid(),'Hộ thứ hai',NULL,'{}');
    RAISE EXCEPTION 'Created a second profile for the same farmer';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;

  invitation := (org_invite_household(manager,coop,request_id)->>'id')::uuid;
  PERFORM org_respond_invite(farmer,invitation,true,false,ARRAY[batch]);
  SELECT id INTO relation_id FROM cooperative_households WHERE invitation_id=invitation;
  IF jsonb_array_length(org_household_data(manager,coop,relation_id)->'batches')<>1
    OR (org_household_setup_options(farmer) #>> '{households,0,cooperative_id}') IS DISTINCT FROM coop::text THEN
    RAISE EXCEPTION 'Existing production could not be shared after joining with consent';
  END IF;
  BEGIN
    PERFORM org_attach_household_farms(farmer,request_id,ARRAY[later_farm],NULL);
    RAISE EXCEPTION 'Attaching ignored a newly active HTX relationship';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  BEGIN
    PERFORM org_attach_household_farms(outsider,request_id,ARRAY[foreign_farm],coop);
    RAISE EXCEPTION 'Outsider attached their own farm to someone else''s household';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM org_attach_household_farms(farmer,request_id,ARRAY[later_farm],coop);
  IF (SELECT organization_id FROM farms WHERE id=later_farm) IS DISTINCT FROM request_id
    OR (org_attach_household_farms(farmer,request_id,ARRAY[later_farm],coop)->>'linked_count')<>'0'
    OR has_function_privilege('authenticated','public.org_create_household_profile(uuid,uuid,text,text,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'Attaching was not retry-safe or the RPC leaked to authenticated clients';
  END IF;
END $$;
ROLLBACK;
