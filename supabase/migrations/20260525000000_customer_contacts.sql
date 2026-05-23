-- Person Contacts split.
--
-- Moves the per-customer (first_name, last_name, email, phone) columns into
-- a new one-to-many `customer_contacts` table so a customer can have multiple
-- people on file. Each customer has at most one `is_primary` contact
-- (enforced by a partial unique index); the primary is the default for the
-- Call button, the Email composer "To" field, and donation receipts.
--
-- This migration:
--   1. Creates customer_contacts + indexes + RLS.
--   2. Seeds one primary contact per existing customer that has any of the
--      four legacy fields.
--   3. Drops the four columns from customers and rebuilds the search GIN.
--   4. Rewrites private.compute_completeness to read the primary contact's
--      fields (volatility stable instead of immutable since it now reads
--      another table), and adds a trigger that recomputes completeness when
--      a contact is inserted/updated/deleted.

-- =============================================================================
-- customer_contacts
-- =============================================================================

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  -- Denormalized so RLS policies can gate on charity_id directly without
  -- joining to customers on every read.
  charity_id uuid not null references public.charities(id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  phone text,
  note text,
  is_primary boolean not null default false,
  sort_order int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_contacts enable row level security;

create index customer_contacts_customer_idx
  on public.customer_contacts (customer_id, sort_order, created_at);
create index customer_contacts_charity_idx
  on public.customer_contacts (charity_id);

-- Exactly one primary contact per customer at most.
create unique index customer_contacts_one_primary_per_customer
  on public.customer_contacts (customer_id)
  where is_primary;

-- -----------------------------------------------------------------------------
-- RLS policies (per-action shape, mirroring public.customers post-archive)
-- -----------------------------------------------------------------------------

create policy "members read contacts"
  on public.customer_contacts for select
  using (private.is_member_of(charity_id));

create policy "members insert contacts"
  on public.customer_contacts for insert
  with check (private.is_member_of(charity_id));

create policy "members update contacts"
  on public.customer_contacts for update
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "members delete contacts"
  on public.customer_contacts for delete
  using (private.is_member_of(charity_id));

-- =============================================================================
-- Triggers on customer_contacts
-- =============================================================================

-- Auto-stamp charity_id from the parent customer when omitted so callers can
-- pass just { customer_id, first_name, ... } and RLS still sees the right
-- charity.
create or replace function private.set_contact_charity_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.charity_id is null then
    select c.charity_id into new.charity_id
    from public.customers c
    where c.id = new.customer_id;
  end if;
  return new;
end $$;

revoke execute on function private.set_contact_charity_id() from anon, authenticated, public;

create trigger customer_contacts_set_charity
  before insert on public.customer_contacts
  for each row execute function private.set_contact_charity_id();

-- Reuse the existing updated_at helper (defined in the init migration).
create trigger customer_contacts_updated_at
  before update on public.customer_contacts
  for each row execute function private.set_updated_at();

-- =============================================================================
-- Migrate legacy customer columns into seeded primary contacts
-- =============================================================================

insert into public.customer_contacts (
  customer_id, charity_id, first_name, last_name, email, phone, is_primary
)
select
  c.id,
  c.charity_id,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  true
from public.customers c
where
     (c.first_name is not null and length(trim(c.first_name)) > 0)
  or (c.last_name  is not null and length(trim(c.last_name))  > 0)
  or (c.email      is not null and length(trim(c.email))      > 0)
  or (c.phone      is not null and length(trim(c.phone))      > 0);

-- =============================================================================
-- Drop legacy columns + rebuild the customers search GIN
-- =============================================================================

drop index if exists public.customers_search_idx;

alter table public.customers
  drop column if exists first_name,
  drop column if exists last_name,
  drop column if exists email,
  drop column if exists phone;

-- Slimmer GIN: customers are now searched by display_name + website at the
-- DB level; the Ledger UI joins customer_contacts client-side for the
-- name / email / phone / note haystack.
create index customers_search_idx
  on public.customers using gin (to_tsvector('simple',
    coalesce(display_name,'') || ' ' || coalesce(website,'')));

-- =============================================================================
-- Rewrite private.compute_completeness to read the primary contact
-- =============================================================================

-- Volatility downgrades from `immutable` to `stable` because we now read
-- another table. This is safe because the function is only used in a BEFORE
-- trigger; nothing indexes its result.
create or replace function private.compute_completeness(c public.customers)
returns smallint
language sql
stable
set search_path = public, pg_temp
as $$
  select (
    (case when exists (
        select 1 from public.customer_contacts cc
        where cc.customer_id = c.id and cc.is_primary
          and cc.first_name is not null and length(trim(cc.first_name)) > 0
      ) then 1 else 0 end) +
    (case when exists (
        select 1 from public.customer_contacts cc
        where cc.customer_id = c.id and cc.is_primary
          and cc.last_name is not null and length(trim(cc.last_name)) > 0
      ) then 1 else 0 end) +
    (case when exists (
        select 1 from public.customer_contacts cc
        where cc.customer_id = c.id and cc.is_primary
          and cc.email is not null and length(trim(cc.email)) > 0
      ) then 1 else 0 end) +
    (case when exists (
        select 1 from public.customer_contacts cc
        where cc.customer_id = c.id and cc.is_primary
          and cc.phone is not null and length(trim(cc.phone)) > 0
      ) then 1 else 0 end) +
    (case when c.website         is not null and length(trim(c.website))         > 0 then 1 else 0 end) +
    (case when c.address_line1   is not null and length(trim(c.address_line1))   > 0 then 1 else 0 end) +
    (case when c.city            is not null and length(trim(c.city))            > 0 then 1 else 0 end) +
    (case when c.state           is not null and length(trim(c.state))           > 0 then 1 else 0 end) +
    (case when c.postal_code     is not null and length(trim(c.postal_code))     > 0 then 1 else 0 end) +
    (case when c.preferred_contact_method is not null                                 then 1 else 0 end)
  )::smallint * 10;
$$;

-- =============================================================================
-- Recompute existing completeness scores
-- =============================================================================

-- The customers_completeness trigger only fires on insert/update, so existing
-- rows still hold scores computed against the old function. Touching every
-- row reruns the trigger which now reads the seeded contact data.
update public.customers set updated_at = updated_at;

-- =============================================================================
-- Cross-table trigger: contact edits bump the customer's completeness_score
-- =============================================================================

create or replace function private.bump_customer_completeness_for_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cid uuid;
begin
  cid := coalesce(new.customer_id, old.customer_id);
  -- A no-op update on the customer fires the existing
  -- `customers_completeness` BEFORE trigger which recomputes the score
  -- against the contact-aware compute_completeness.
  if cid is not null then
    update public.customers set updated_at = now() where id = cid;
  end if;
  return null;
end $$;

revoke execute on function private.bump_customer_completeness_for_contact() from anon, authenticated, public;

create trigger customer_contacts_bump_completeness
  after insert or update or delete on public.customer_contacts
  for each row execute function private.bump_customer_completeness_for_contact();
