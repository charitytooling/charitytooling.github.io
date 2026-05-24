-- Customer custom fields (per-charity field definitions + per-customer values).
--
-- Any charity member can add a new field on the Update page. The definition
-- lives in `customer_field_defs` (charity-wide) so every member sees the same
-- field on every customer in that charity. Per-customer values live in
-- `customer_field_values` keyed on (customer_id, field_def_id) so saves are
-- straight `upsert`s.
--
-- RLS shape mirrors `customer_contacts` and `call_script_items`: per-action
-- policies gated on `private.is_member_of(charity_id)`. `customer_field_values`
-- also auto-stamps `charity_id` from the parent customer via a BEFORE INSERT
-- trigger so the client can post just { customer_id, field_def_id, value }.
--
-- Audit triggers are attached to both tables so collaborative edits land in
-- `public.audit_log` alongside customers/contacts.

-- =============================================================================
-- customer_field_defs - per-charity field definitions
-- =============================================================================

create table public.customer_field_defs (
  id          uuid primary key default gen_random_uuid(),
  charity_id  uuid not null references public.charities(id) on delete cascade,
  label       text not null,
  kind        text not null check (kind in ('text','url','email','tel','number','money')),
  sort_order  int  not null default 0,
  archived_at timestamptz,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.customer_field_defs enable row level security;

create index customer_field_defs_charity_order_idx
  on public.customer_field_defs (charity_id, sort_order, created_at);

create policy "members read customer_field_defs"
  on public.customer_field_defs for select
  using (private.is_member_of(charity_id));

create policy "members insert customer_field_defs"
  on public.customer_field_defs for insert
  with check (private.is_member_of(charity_id));

create policy "members update customer_field_defs"
  on public.customer_field_defs for update
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "members delete customer_field_defs"
  on public.customer_field_defs for delete
  using (private.is_member_of(charity_id));

create trigger customer_field_defs_updated_at
  before update on public.customer_field_defs
  for each row execute function private.set_updated_at();

-- =============================================================================
-- customer_field_values - per-customer value for a given def
-- =============================================================================

create table public.customer_field_values (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  -- Denormalized so RLS can gate on charity_id without joining customers on
  -- every read. Auto-stamped by the BEFORE INSERT trigger below.
  charity_id   uuid not null references public.charities(id) on delete cascade,
  field_def_id uuid not null references public.customer_field_defs(id) on delete cascade,
  value        text,
  updated_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  unique (customer_id, field_def_id)
);

alter table public.customer_field_values enable row level security;

create index customer_field_values_customer_idx
  on public.customer_field_values (customer_id);

create index customer_field_values_field_def_idx
  on public.customer_field_values (field_def_id);

create policy "members read customer_field_values"
  on public.customer_field_values for select
  using (private.is_member_of(charity_id));

create policy "members insert customer_field_values"
  on public.customer_field_values for insert
  with check (private.is_member_of(charity_id));

create policy "members update customer_field_values"
  on public.customer_field_values for update
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "members delete customer_field_values"
  on public.customer_field_values for delete
  using (private.is_member_of(charity_id));

-- Auto-stamp charity_id from the parent customer when omitted. Mirrors
-- private.set_contact_charity_id from 20260525000000_customer_contacts.sql.
create or replace function private.set_field_value_charity_id()
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

revoke execute on function private.set_field_value_charity_id() from anon, authenticated, public;

create trigger customer_field_values_set_charity
  before insert on public.customer_field_values
  for each row execute function private.set_field_value_charity_id();

create trigger customer_field_values_updated_at
  before update on public.customer_field_values
  for each row execute function private.set_updated_at();

-- =============================================================================
-- Audit triggers
-- =============================================================================

create trigger audit_customer_field_defs
  after insert or update or delete on public.customer_field_defs
  for each row execute function private.write_audit();

create trigger audit_customer_field_values
  after insert or update or delete on public.customer_field_values
  for each row execute function private.write_audit();
