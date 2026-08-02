-- migrate:up
-- Initial schema for the seafood provenance MVP.

create type public.organization_type as enum (
  'fisher',
  'farm',
  'processor',
  'transporter',
  'warehouse',
  'retailer',
  'regulator'
);

create type public.user_role as enum ('admin', 'manager', 'member');

create type public.batch_status as enum (
  'created',
  'in_transit',
  'stored',
  'processed',
  'sold',
  'recalled'
);

create type public.supply_chain_event_type as enum (
  'harvested',
  'landed',
  'processed',
  'stored',
  'shipped',
  'received',
  'inspected',
  'sold',
  'recalled'
);

create type public.blockchain_transaction_status as enum (
  'pending',
  'confirmed',
  'failed'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type public.organization_type not null,
  registration_number text unique,
  address text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  full_name text,
  role public.user_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  scientific_name text,
  description text,
  unit text not null default 'kg',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  product_id uuid not null references public.products(id) on delete restrict,
  owner_organization_id uuid not null references public.organizations(id) on delete restrict,
  origin text not null,
  harvest_date date,
  quantity numeric(14, 3) check (quantity is null or quantity >= 0),
  unit text not null default 'kg',
  status public.batch_status not null default 'created',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.supply_chain_events (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  event_type public.supply_chain_event_type not null,
  event_time timestamptz not null default now(),
  location text,
  description text,
  document_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.blockchain_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.batches(id) on delete cascade,
  event_id uuid references public.supply_chain_events(id) on delete cascade,
  network text not null,
  contract_address text,
  transaction_hash text not null unique,
  data_hash text not null,
  block_number bigint check (block_number is null or block_number >= 0),
  status public.blockchain_transaction_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint blockchain_transaction_target_required
    check (batch_id is not null or event_id is not null)
);

create index products_organization_id_idx
  on public.products (organization_id);
create index batches_product_id_idx
  on public.batches (product_id);
create index batches_owner_organization_id_idx
  on public.batches (owner_organization_id);
create index supply_chain_events_batch_time_idx
  on public.supply_chain_events (batch_id, event_time);
create index supply_chain_events_organization_id_idx
  on public.supply_chain_events (organization_id);
create index blockchain_transactions_batch_id_idx
  on public.blockchain_transactions (batch_id);
create index blockchain_transactions_event_id_idx
  on public.blockchain_transactions (event_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger batches_set_updated_at
before update on public.batches
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.batches enable row level security;
alter table public.supply_chain_events enable row level security;
alter table public.blockchain_transactions enable row level security;

-- Traceability information is public. All writes go through the Node.js backend
-- using the local secret/service-role key, which bypasses RLS.
create policy "organizations are publicly readable"
on public.organizations for select
to anon, authenticated
using (true);

create policy "users can read their own profile"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "products are publicly readable"
on public.products for select
to anon, authenticated
using (true);

create policy "batches are publicly readable"
on public.batches for select
to anon, authenticated
using (true);

create policy "supply chain events are publicly readable"
on public.supply_chain_events for select
to anon, authenticated
using (true);

create policy "blockchain transactions are publicly readable"
on public.blockchain_transactions for select
to anon, authenticated
using (true);

grant usage on schema public to anon, authenticated, service_role;
grant select on public.organizations to anon, authenticated;
grant select on public.products to anon, authenticated;
grant select on public.batches to anon, authenticated;
grant select on public.supply_chain_events to anon, authenticated;
grant select on public.blockchain_transactions to anon, authenticated;
grant select on public.profiles to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- migrate:down
drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.blockchain_transactions;
drop table if exists public.supply_chain_events;
drop table if exists public.batches;
drop table if exists public.products;
drop table if exists public.profiles;
drop table if exists public.organizations;

drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();

drop type if exists public.blockchain_transaction_status;
drop type if exists public.supply_chain_event_type;
drop type if exists public.batch_status;
drop type if exists public.user_role;
drop type if exists public.organization_type;
