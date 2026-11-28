#!/bin/sh
# Runs against an isolated, freshly migrated PostgreSQL test database.
set -eu
if [ "$(psql -XAtc 'select current_database()')" != seafood_org_test ]; then
  echo 'Use the disposable seafood_org_test database.' >&2
  exit 1
fi

fixture=$(psql -XqAt -v ON_ERROR_STOP=1 <<'SQL'
SELECT gen_random_uuid() AS h, gen_random_uuid() AS c1, gen_random_uuid() AS c2,
       gen_random_uuid() AS r, gen_random_uuid() AS m1, gen_random_uuid() AS m2 \gset
INSERT INTO public.organizations(id,name,type) VALUES
  (:'h','Concurrent household','FARMER_HOUSEHOLD'),(:'c1','Concurrent HTX 1','COOPERATIVE'),(:'c2','Concurrent HTX 2','COOPERATIVE');
INSERT INTO auth.users(id) VALUES (:'r'),(:'m1'),(:'m2');
INSERT INTO public.user_profiles(id,full_name,role) VALUES
  (:'r','Concurrent representative','FARMER'),(:'m1','Concurrent manager 1','FARMER'),(:'m2','Concurrent manager 2','FARMER');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
  (:'h',:'r','REPRESENTATIVE'),(:'c1',:'m1','MANAGER'),(:'c2',:'m2','MANAGER');
SELECT public.org_invite_household(:'m1',:'c1',:'h')->>'id' AS i1 \gset
SELECT public.org_invite_household(:'m2',:'c2',:'h')->>'id' AS i2 \gset
SELECT :'h' || ' ' || :'r' || ' ' || :'i1' || ' ' || :'i2';
SQL
)
set -- $fixture
if [ "$#" -ne 4 ]; then
  echo "Expected four concurrency fixture IDs and received $#" >&2
  exit 1
fi
household=$1
actor=$2
i1=$3
i2=$4
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT
accept() {
  psql -XqAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -v actor="$actor" -v invitation="$1" <<'SQL'
BEGIN;
SET ROLE service_role;
SELECT public.org_respond_invite(:'actor',:'invitation',true,false,'{}')->>'status';
SELECT pg_sleep(0.5);
COMMIT;
SQL
}
accept "$i1" > "$tmp/a" 2>&1 &
a=$!
accept "$i2" > "$tmp/b" 2>&1 &
b=$!
status_a=0
status_b=0
wait "$a" || status_a=$?
wait "$b" || status_b=$?
if [ "$status_a" -eq "$status_b" ] ||
  ! grep -q '^ACCEPTED$' "$tmp/a" "$tmp/b" ||
  ! grep -q 'PT409' "$tmp/a" "$tmp/b"; then
  cat "$tmp/a" "$tmp/b"
  exit 1
fi
active=$(psql -XqAt -v ON_ERROR_STOP=1 -v household="$household" <<'SQL'
SELECT count(*) FROM public.cooperative_households WHERE household_id=:'household' AND ended_at IS NULL;
SQL
)
if [ "$active" != 1 ]; then
  echo "Expected one active relationship and found $active" >&2
  exit 1
fi
echo 'PASS exactly one of two simultaneous household acceptances committed'
