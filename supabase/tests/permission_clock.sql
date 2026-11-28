-- Run against a disposable migrated database as its owner.
BEGIN;
DO $$
DECLARE
  house uuid := gen_random_uuid(); coop uuid := gen_random_uuid();
  rep uuid := gen_random_uuid(); boss uuid := gen_random_uuid(); staff uuid := gen_random_uuid();
  farm uuid := gen_random_uuid(); assigned_pond uuid := gen_random_uuid(); transferred_pond uuid := gen_random_uuid();
  expired_at timestamptz;
BEGIN
  INSERT INTO organizations(id,name,type) VALUES (house,'Permission clock household','FARMER_HOUSEHOLD'),
    (coop,'Permission clock cooperative','COOPERATIVE');
  INSERT INTO auth.users(id) VALUES (rep),(boss),(staff);
  INSERT INTO user_profiles(id,full_name,role) VALUES (rep,'Clock representative','FARMER'),
    (boss,'Clock manager','FARMER'),(staff,'Clock staff','FARMER');
  INSERT INTO organization_memberships(organization_id,user_id,role) VALUES (house,rep,'REPRESENTATIVE'),
    (coop,boss,'MANAGER'),(house,staff,'STAFF');
  INSERT INTO farms(id,owner_id,organization_id,farm_name) VALUES (farm,rep,house,'Permission clock farm');
  INSERT INTO ponds(id,farm_id,pond_code,pond_name) VALUES (assigned_pond,farm,'CLOCK-A','Assigned pond'),
    (transferred_pond,farm,'CLOCK-B','Transferred pond');
  INSERT INTO pond_assignments(pond_id,organization_id,user_id,permissions,granted_by)
    VALUES (assigned_pond,house,staff,ARRAY['READ','LOG_CREATE'],rep);
  INSERT INTO pond_operating_periods(pond_id,organization_id,granted_by) VALUES (transferred_pond,coop,boss);

  PERFORM id FROM ponds WHERE id IN (assigned_pond,transferred_pond) ORDER BY id FOR UPDATE;
  IF NOT org_is_manager(rep,house) OR NOT pond_can(staff,assigned_pond,'LOG_CREATE')
    OR NOT pond_can(boss,transferred_pond,'MANAGE') THEN
    RAISE EXCEPTION 'Fixture rights must be active before their expiry';
  END IF;
  PERFORM pg_sleep(0.02);
  expired_at := clock_timestamp();
  UPDATE organization_memberships SET ends_at=expired_at WHERE organization_id=house AND user_id=rep;
  UPDATE pond_assignments SET ends_at=expired_at WHERE pond_id=assigned_pond;
  UPDATE pond_operating_periods SET ends_at=expired_at WHERE pond_id=transferred_pond;
  IF org_is_manager(rep,house) OR pond_can(staff,assigned_pond,'LOG_CREATE')
    OR pond_can(boss,transferred_pond,'MANAGE') OR NOT pond_can(rep,transferred_pond,'MANAGE') THEN
    RAISE EXCEPTION 'Permission checked after taking the pond lock must use current time, including expiry and operator return';
  END IF;
END $$;
ROLLBACK;
