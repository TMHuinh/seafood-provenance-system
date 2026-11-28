-- Apply migrations first. Run against a disposable PostgreSQL database as its owner.
BEGIN;

DO $$
DECLARE
  household_a uuid := gen_random_uuid(); household_b uuid := gen_random_uuid();
  cooperative uuid := gen_random_uuid(); company uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid(); representative_a uuid := gen_random_uuid();
  representative_b uuid := gen_random_uuid(); manager_id uuid := gen_random_uuid();
  staff_id uuid := gen_random_uuid(); independent_owner uuid := gen_random_uuid();
  new_representative uuid := gen_random_uuid(); new_organization uuid;
  farm_a uuid := gen_random_uuid(); farm_b uuid := gen_random_uuid();
  independent_farm uuid := gen_random_uuid(); unsupported_farm uuid := gen_random_uuid();
  administrator_farm uuid := gen_random_uuid(); administrator_pond uuid := gen_random_uuid();
  pond_a uuid := gen_random_uuid(); pond_b uuid := gen_random_uuid();
  independent_pond uuid := gen_random_uuid(); company_pond uuid := gen_random_uuid(); staff_membership uuid;
  company_peer uuid := gen_random_uuid();
  rep_membership uuid; batch_a uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES (admin_id), (representative_a), (representative_b), (manager_id),
    (staff_id), (independent_owner), (new_representative), (company_peer);
  INSERT INTO public.organizations(id,name,type) VALUES (household_a,'Foundation household A','FARMER_HOUSEHOLD'),
    (household_b,'Foundation household B','FARMER_HOUSEHOLD'), (cooperative,'Foundation cooperative','COOPERATIVE'),
    (company,'Foundation company','COMPANY');
  INSERT INTO public.user_profiles(id,full_name,role,organization_id) VALUES
    (admin_id,'Admin','ADMIN',NULL), (representative_a,'Representative A','FARMER',household_a),
    (representative_b,'Representative B','FARMER',household_b), (manager_id,'Manager','FARMER',cooperative),
    (staff_id,'Staff','FARMER',household_a), (independent_owner,'Owner','FARMER',company),
    (company_peer,'Company peer','FARMER',company);
  INSERT INTO public.farms(id,organization_id,owner_id,farm_name) VALUES
    (farm_a,household_a,independent_owner,'Farm A'), (farm_b,household_b,independent_owner,'Farm B'),
    (independent_farm,NULL,independent_owner,'Independent farm'), (unsupported_farm,company,independent_owner,'Company-linked farm'),
    (administrator_farm,NULL,admin_id,'Administrator-owned legacy farm');
  INSERT INTO public.ponds(id,farm_id,pond_code,pond_name) VALUES
    (pond_a,farm_a,'A','Pond A'), (pond_b,farm_b,'B','Pond B'), (independent_pond,independent_farm,'I','Independent pond'),
    (company_pond,unsupported_farm,'C','Company pond'), (administrator_pond,administrator_farm,'AD','Administrator-owned pond');
  INSERT INTO public.batches(id,pond_id,batch_code,species,seed_quantity,stocking_date,status)
    VALUES (batch_a,pond_a,'FOUNDATION-A','SHRIMP',100,current_date,'GROWING');
  INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES (household_a,staff_id,'STAFF')
    RETURNING id INTO staff_membership;
  INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES (household_a,representative_a,'MANAGER');

  IF NOT EXISTS (SELECT FROM public.org_legacy_review WHERE issue='UNLINKED_FARM' AND resource_id=independent_farm)
    OR NOT EXISTS (SELECT FROM public.org_legacy_review WHERE issue='UNSUPPORTED_FARM_ORGANIZATION' AND resource_id=unsupported_farm)
    OR NOT EXISTS (SELECT FROM public.org_legacy_review WHERE issue='VERIFY_REPRESENTATIVE' AND organization_id=household_a) THEN
    RAISE EXCEPTION 'Legacy review must identify unlinked or unsupported farms and households that lack a valid representative';
  END IF;
  IF public.org_is_manager(staff_id,household_a) OR public.org_is_manager(representative_a,household_a)
    OR public.pond_can(staff_id,pond_a,'READ') OR public.pond_can(representative_b,pond_b,'READ') THEN
    RAISE EXCEPTION 'Legacy profile affiliation, staff membership and a mismatched role do not confer management or pond access';
  END IF;
  BEGIN
    PERFORM public.org_provision_manager(staff_id,household_a,staff_id);
    RAISE EXCEPTION 'Staff was allowed to provision its own management access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  rep_membership := public.org_provision_manager(admin_id,household_a,representative_a);
  IF rep_membership IS DISTINCT FROM public.org_provision_manager(admin_id,household_a,representative_a) THEN
    RAISE EXCEPTION 'Provisioning the same management role twice must be idempotent';
  END IF;
  PERFORM public.org_provision_manager(admin_id,household_b,representative_b);
  PERFORM public.org_provision_manager(admin_id,cooperative,manager_id);
  IF NOT EXISTS (SELECT FROM public.audit_logs WHERE user_id=admin_id AND entity_id=rep_membership AND action='CREATE')
    OR EXISTS (SELECT FROM public.org_legacy_review WHERE issue='VERIFY_REPRESENTATIVE' AND organization_id=household_a)
    OR NOT public.pond_can(representative_a,pond_a,'MANAGE') OR NOT public.farm_can_manage(representative_a,farm_a)
    OR public.pond_can(representative_a,pond_b,'READ') OR public.farm_can_manage(representative_a,farm_b)
    OR public.pond_can(manager_id,pond_a,'READ') OR public.pond_can(representative_a,pond_a,'LOG_CONFIRM')
    OR (SELECT count(*) FROM public.production_batches(representative_a)) <> 1
    OR EXISTS (SELECT FROM public.production_batches(representative_b)) THEN
    RAISE EXCEPTION 'Provisioning must be audited and scope farm and pond access without implicit confirmation or cross-organization visibility';
  END IF;
  IF NOT public.farm_can_manage(independent_owner,independent_farm)
    OR NOT public.pond_can(independent_owner,independent_pond,'LOG_CONFIRM') THEN
    RAISE EXCEPTION 'Existing independent owner must retain farm management and confirmation access';
  END IF;
  IF NOT public.pond_can(independent_owner,company_pond,'LOG_CONFIRM')
    OR NOT public.pond_can(independent_owner,company_pond,'HARVEST_CONFIRM')
    OR public.pond_can(company_peer,company_pond,'READ')
    OR public.pond_can(company_peer,company_pond,'LOG_CONFIRM')
    OR NOT public.farm_org_can_create(independent_owner,company)
    OR public.farm_org_can_create(representative_a,company) THEN
    RAISE EXCEPTION 'Legacy company workflow must stay available to the exact farm owner';
  END IF;
  IF public.farm_can_manage(admin_id,farm_a) OR public.pond_can(admin_id,pond_a,'READ')
    OR public.pond_can(admin_id,pond_a,'LOG_CONFIRM') OR EXISTS(SELECT FROM public.production_batches(admin_id))
    OR NOT public.pond_can(admin_id,company_pond,'READ') OR NOT public.pond_can(admin_id,independent_pond,'LOG_EDIT')
    OR public.pond_can(admin_id,company_pond,'HARVEST_CONFIRM') OR public.farm_can_manage(admin_id,unsupported_farm)
    OR NOT public.farm_can_manage(admin_id,administrator_farm) OR NOT public.pond_can(admin_id,administrator_pond,'MANAGE') THEN
    RAISE EXCEPTION 'Global admin only keeps legacy reads and log permissions, with management of own legacy farms';
  END IF;

  INSERT INTO public.pond_assignments(pond_id,organization_id,user_id,permissions,granted_by)
    VALUES (pond_a,household_a,staff_id,ARRAY['READ','LOG_CREATE','BATCH_CREATE'],representative_a);
  IF NOT public.pond_can(staff_id,pond_a,'LOG_CREATE') OR public.pond_can(staff_id,pond_a,'LOG_CONFIRM')
    OR NOT public.pond_can(staff_id,pond_a,'BATCH_CREATE') OR public.pond_can(staff_id,pond_a,'BATCH_EDIT')
    OR public.pond_can(staff_id,pond_a,'MANAGE') OR public.pond_can(staff_id,pond_b,'READ') THEN
    RAISE EXCEPTION 'Staff can write logs only on the assigned pond and cannot confirm or manage by default';
  END IF;
  UPDATE public.organization_memberships SET ends_at=now() WHERE id=staff_membership;
  UPDATE public.organization_memberships SET ends_at=now() WHERE id=rep_membership;
  IF public.pond_can(staff_id,pond_a,'READ') OR public.pond_can(representative_a,pond_a,'MANAGE')
    OR EXISTS (SELECT FROM public.production_ponds(representative_a)) THEN
    RAISE EXCEPTION 'Permission checks must immediately reflect ended memberships for the same actor IDs';
  END IF;

  SELECT organization_id INTO new_organization FROM public.register_production_profile(new_representative,'New owner',
    'owner@example.invalid',NULL,'FARMER',NULL,'New household','FARMER_HOUSEHOLD',NULL);
  IF NOT public.org_is_manager(new_representative,new_organization)
    OR public.org_is_manager(new_representative,household_a) THEN
    RAISE EXCEPTION 'Registration creates a representative only for the newly created household';
  END IF;

  IF has_table_privilege('authenticated','public.ponds','SELECT')
    OR has_table_privilege('anon','public.organization_memberships','SELECT')
    OR has_function_privilege('authenticated','public.org_workspace(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.pond_can(uuid,uuid,text)','EXECUTE')
    OR has_function_privilege('anon','public.farm_org_can_create(uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.production_batches(uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.production_batches(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'End-user SQL roles must not access privileged tables or actor-parameterized RPCs';
  END IF;
END $$;

ROLLBACK;
