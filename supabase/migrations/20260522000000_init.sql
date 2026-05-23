-- CharityTooling - initial schema.
--
-- Conventions:
--   * Every domain table carries `charity_id` and is gated by RLS.
--   * All SECURITY DEFINER helpers live in the `private` schema so that
--     PostgREST cannot expose them via the Data API (per Supabase security
--     guidance).
--   * Money is stored as bigint cents. Receipt numbers are text.
--   * The bootstrap super_admin email is settable via:
--       alter database postgres set app.bootstrap_admin_email = '...';
--     with a hard-coded fallback inside handle_new_user().

-- =============================================================================
-- Extensions and schemas
-- =============================================================================

create extension if not exists "pgcrypto";

create schema if not exists private;
grant usage on schema private to postgres;
revoke all on schema private from anon, authenticated, public;

-- =============================================================================
-- profiles
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- =============================================================================
-- charities
-- =============================================================================

create table public.charities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  ein text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text default 'US',
  default_tz text not null default 'America/Chicago',
  resend_from_email text,
  resend_from_name text,
  receipt_signatory_name text,
  receipt_disclaimer text default 'No goods or services were provided in exchange for this contribution.',
  stripe_account_id text unique,
  stripe_charges_enabled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.charities enable row level security;

-- =============================================================================
-- charity_members
-- =============================================================================

create table public.charity_members (
  charity_id uuid not null references public.charities(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','rep')),
  invited_by uuid references auth.users(id),
  invited_at timestamptz default now(),
  accepted_at timestamptz,
  primary key (charity_id, user_id)
);
alter table public.charity_members enable row level security;
create index charity_members_user_idx on public.charity_members (user_id);

-- =============================================================================
-- Helper functions (private schema)
-- =============================================================================

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_super_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function private.is_member_of(c uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    private.is_super_admin()
    or exists (
      select 1 from public.charity_members
      where user_id = auth.uid() and charity_id = c
    );
$$;

create or replace function private.is_admin_of(c uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    private.is_super_admin()
    or exists (
      select 1 from public.charity_members
      where user_id = auth.uid() and charity_id = c and role = 'admin'
    );
$$;

-- =============================================================================
-- invitations
-- =============================================================================

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  charity_id uuid not null references public.charities(id) on delete cascade,
  role text not null check (role in ('admin','rep')),
  token text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invitations enable row level security;
create index invitations_email_idx on public.invitations (lower(email));
create index invitations_charity_idx on public.invitations (charity_id);

-- =============================================================================
-- customers
-- =============================================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charities(id) on delete cascade,
  first_name text,
  last_name text,
  display_name text,
  email text,
  phone text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  preferred_contact_method text check (preferred_contact_method in ('email','phone','mail')),
  last_contacted_at timestamptz,
  giving_total_cents bigint not null default 0,
  tags text[] not null default '{}',
  notes_summary text,
  completeness_score smallint not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customers enable row level security;
create index customers_charity_idx on public.customers (charity_id);
create index customers_charity_completeness_idx
  on public.customers (charity_id, completeness_score asc, updated_at asc);
create index customers_search_idx
  on public.customers using gin (to_tsvector('simple',
    coalesce(first_name,'') || ' ' ||
    coalesce(last_name,'') || ' ' ||
    coalesce(display_name,'') || ' ' ||
    coalesce(email,'') || ' ' ||
    coalesce(phone,'')));

-- =============================================================================
-- notes
-- =============================================================================

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  charity_id uuid not null references public.charities(id) on delete cascade,
  kind text not null check (kind in ('call','email','meeting','research','other')),
  body text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.notes enable row level security;
create index notes_customer_idx on public.notes (customer_id, created_at desc);

-- =============================================================================
-- follow_ups
-- =============================================================================

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  charity_id uuid not null references public.charities(id) on delete cascade,
  due_date date not null,
  status text not null default 'open' check (status in ('open','done','snoozed')),
  reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.follow_ups enable row level security;
create index follow_ups_charity_due_idx on public.follow_ups (charity_id, due_date, status);

-- =============================================================================
-- email_templates
-- =============================================================================

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charities(id) on delete cascade,
  kind text not null check (kind in ('thank_you','donation_receipt','follow_up','intro','custom')),
  name text not null,
  subject text not null,
  body_md text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
create unique index email_templates_default_unique
  on public.email_templates (charity_id, kind)
  where is_default;

-- =============================================================================
-- email_log
-- =============================================================================

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  charity_id uuid not null references public.charities(id) on delete cascade,
  template_id uuid references public.email_templates(id) on delete set null,
  subject text not null,
  body_html text,
  to_email text not null,
  resend_id text,
  status text,
  sent_by uuid references auth.users(id),
  sent_at timestamptz not null default now()
);
alter table public.email_log enable row level security;
create index email_log_charity_sent_idx on public.email_log (charity_id, sent_at desc);

-- =============================================================================
-- donations
-- =============================================================================

create table public.donations (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charities(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'usd',
  method text not null check (method in ('check','cash','card','ach','stock','other')),
  received_date date not null,
  reference text,
  notes text,
  receipt_number text,
  receipt_storage_path text,
  receipt_sent_at timestamptz,
  stripe_payment_intent_id text unique,
  edited_at timestamptz,
  edited_by uuid references auth.users(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.donations enable row level security;
create unique index donations_receipt_unique
  on public.donations (charity_id, receipt_number)
  where receipt_number is not null;
create index donations_charity_received_idx
  on public.donations (charity_id, received_date desc);
create index donations_customer_idx on public.donations (customer_id, received_date desc);

-- =============================================================================
-- Receipt number generator (private)
-- =============================================================================

create or replace function private.next_receipt_number(c_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tz text;
  base text;
  candidate text;
  n int := 1;
begin
  select default_tz into tz from public.charities where id = c_id;
  if tz is null then tz := 'America/Chicago'; end if;
  base := to_char(timezone(tz, now()), 'YYMMDDHH24MI');
  candidate := base;
  -- Serialize concurrent receipt allocations for the same charity inside
  -- this transaction. The lock is released at COMMIT.
  perform pg_advisory_xact_lock(hashtext('receipt:' || c_id::text));
  while exists (
    select 1 from public.donations
    where charity_id = c_id and receipt_number = candidate
  ) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

-- =============================================================================
-- push_subscriptions
-- =============================================================================

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

-- =============================================================================
-- notification_preferences
-- =============================================================================

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  followups_due boolean not null default true,
  update_queue_weekly boolean not null default true,
  new_donation boolean not null default false,
  invited_to_charity boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;

-- =============================================================================
-- stripe_events (idempotency)
-- =============================================================================

create table public.stripe_events (
  id text primary key,
  type text,
  received_at timestamptz not null default now(),
  payload jsonb
);
alter table public.stripe_events enable row level security;

-- =============================================================================
-- audit_log
-- =============================================================================

create table public.audit_log (
  id bigserial primary key,
  actor_id uuid references auth.users(id),
  charity_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  diff jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create index audit_log_charity_idx on public.audit_log (charity_id, created_at desc);

-- =============================================================================
-- Trigger helpers
-- =============================================================================

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger customers_updated_at
  before update on public.customers
  for each row execute function private.set_updated_at();

create or replace function private.compute_completeness(c public.customers)
returns smallint
language sql
immutable
as $$
  select (
    (case when c.first_name      is not null and length(trim(c.first_name))      > 0 then 1 else 0 end) +
    (case when c.last_name       is not null and length(trim(c.last_name))       > 0 then 1 else 0 end) +
    (case when c.email           is not null and length(trim(c.email))           > 0 then 1 else 0 end) +
    (case when c.phone           is not null and length(trim(c.phone))           > 0 then 1 else 0 end) +
    (case when c.website         is not null and length(trim(c.website))         > 0 then 1 else 0 end) +
    (case when c.address_line1   is not null and length(trim(c.address_line1))   > 0 then 1 else 0 end) +
    (case when c.city            is not null and length(trim(c.city))            > 0 then 1 else 0 end) +
    (case when c.state           is not null and length(trim(c.state))           > 0 then 1 else 0 end) +
    (case when c.postal_code     is not null and length(trim(c.postal_code))     > 0 then 1 else 0 end) +
    (case when c.preferred_contact_method is not null                                 then 1 else 0 end)
  )::smallint * 10;
$$;

create or replace function private.update_completeness()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.completeness_score := private.compute_completeness(new);
  return new;
end $$;

create trigger customers_completeness
  before insert or update on public.customers
  for each row execute function private.update_completeness();

-- =============================================================================
-- handle_new_user trigger - bootstraps profile and super_admin flag
-- =============================================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  configured_email text;
  bootstrap_email  text := 'robert@douglasmining.com';
begin
  begin
    configured_email := current_setting('app.bootstrap_admin_email', true);
  exception when others then
    configured_email := null;
  end;
  if configured_email is not null and configured_email <> '' then
    bootstrap_email := configured_email;
  end if;

  insert into public.profiles (id, email, is_super_admin)
  values (new.id, new.email, lower(new.email) = lower(bootstrap_email))
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  -- Reconcile any pending invitations for this email into charity_members.
  insert into public.charity_members (charity_id, user_id, role, invited_by, invited_at, accepted_at)
  select i.charity_id, new.id, i.role, i.invited_by, i.created_at, now()
  from public.invitations i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
    and i.expires_at > now()
  on conflict (charity_id, user_id) do nothing;

  update public.invitations
  set accepted_at = now()
  where lower(email) = lower(new.email)
    and accepted_at is null
    and expires_at > now();

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- =============================================================================
-- Audit log writer (generic)
-- =============================================================================

create or replace function private.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_id uuid;
  e_id uuid;
  diff jsonb;
begin
  if tg_op = 'INSERT' then
    c_id := (to_jsonb(new) ->> 'charity_id')::uuid;
    e_id := (to_jsonb(new) ->> 'id')::uuid;
    diff := jsonb_build_object('after', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    c_id := (to_jsonb(new) ->> 'charity_id')::uuid;
    e_id := (to_jsonb(new) ->> 'id')::uuid;
    diff := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    c_id := (to_jsonb(old) ->> 'charity_id')::uuid;
    e_id := (to_jsonb(old) ->> 'id')::uuid;
    diff := jsonb_build_object('before', to_jsonb(old));
  end if;

  insert into public.audit_log (actor_id, charity_id, entity_type, entity_id, action, diff)
  values (auth.uid(), c_id, tg_table_name, e_id, lower(tg_op), diff);

  return coalesce(new, old);
end $$;

create trigger audit_customers
  after insert or update or delete on public.customers
  for each row execute function private.write_audit();

create trigger audit_donations
  after insert or update or delete on public.donations
  for each row execute function private.write_audit();

create trigger audit_charity_members
  after insert or update or delete on public.charity_members
  for each row execute function private.write_audit();

create trigger audit_email_templates
  after insert or update or delete on public.email_templates
  for each row execute function private.write_audit();

-- Stamp edited_at / edited_by on donations updates.
create or replace function private.stamp_donation_edit()
returns trigger
language plpgsql
as $$
begin
  new.edited_at := now();
  new.edited_by := auth.uid();
  return new;
end $$;

create trigger donations_stamp_edit
  before update on public.donations
  for each row execute function private.stamp_donation_edit();

-- =============================================================================
-- RLS Policies
-- =============================================================================

-- profiles ------------------------------------------------------------------
create policy "read own profile or super admin"
  on public.profiles for select
  using (auth.uid() = id or private.is_super_admin());

create policy "update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "super admin manages profiles"
  on public.profiles for all
  using (private.is_super_admin())
  with check (private.is_super_admin());

-- charities -----------------------------------------------------------------
create policy "members read their charities"
  on public.charities for select
  using (private.is_member_of(id));

create policy "admins update their charity"
  on public.charities for update
  using (private.is_admin_of(id))
  with check (private.is_admin_of(id));

create policy "super admin manages charities"
  on public.charities for all
  using (private.is_super_admin())
  with check (private.is_super_admin());

-- charity_members -----------------------------------------------------------
create policy "members read charity_members"
  on public.charity_members for select
  using (private.is_member_of(charity_id));

create policy "admins manage charity_members"
  on public.charity_members for all
  using (private.is_admin_of(charity_id))
  with check (private.is_admin_of(charity_id));

-- invitations ---------------------------------------------------------------
create policy "admins manage invitations"
  on public.invitations for all
  using (private.is_admin_of(charity_id))
  with check (private.is_admin_of(charity_id));

-- customers / notes / follow_ups / email_log --------------------------------
create policy "members rw customers"
  on public.customers for all
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "members rw notes"
  on public.notes for all
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "members rw follow_ups"
  on public.follow_ups for all
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

create policy "members rw email_log"
  on public.email_log for all
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

-- email_templates -----------------------------------------------------------
create policy "members read templates"
  on public.email_templates for select
  using (private.is_member_of(charity_id));

create policy "admins write templates"
  on public.email_templates for all
  using (private.is_admin_of(charity_id))
  with check (private.is_admin_of(charity_id));

-- donations -----------------------------------------------------------------
create policy "members rw donations"
  on public.donations for all
  using (private.is_member_of(charity_id))
  with check (private.is_member_of(charity_id));

-- push_subscriptions and notification_preferences (self-scoped) -------------
create policy "own push subscriptions"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own notification preferences"
  on public.notification_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- audit_log -----------------------------------------------------------------
create policy "members read audit"
  on public.audit_log for select
  using (
    (charity_id is null and private.is_super_admin())
    or (charity_id is not null and private.is_member_of(charity_id))
  );

-- stripe_events: only super admin reads; writes happen via service role -----
create policy "super admin reads stripe events"
  on public.stripe_events for select
  using (private.is_super_admin());

-- =============================================================================
-- Public RPC wrapper for allocating a receipt number
-- =============================================================================

-- PostgREST only exposes functions in the `public` schema. This wrapper enforces
-- that the caller is a member of the charity, then delegates to the private
-- function. It runs SECURITY DEFINER so the per-charity advisory lock and
-- donations table read are reliable even when called via the API.

create or replace function public.allocate_receipt_number(c_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  number text;
  is_service boolean;
begin
  -- service_role bypass: trusted server-side callers (Stripe webhook, cron,
  -- send-receipt Edge Function) skip the membership check.
  begin
    is_service := (auth.role() = 'service_role');
  exception when others then
    is_service := false;
  end;
  if not is_service and not private.is_member_of(c_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  number := private.next_receipt_number(c_id);
  return number;
end $$;

revoke all on function public.allocate_receipt_number(uuid) from public;
grant execute on function public.allocate_receipt_number(uuid) to authenticated, service_role;

-- =============================================================================
-- Storage bucket for donation receipts (private)
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Bucket-level RLS: members of the charity can read their own receipts. The
-- storage path convention is `{charity_id}/{donation_id}.pdf`, so we match the
-- first path segment to a charity_id the caller belongs to.

create policy "members read receipts"
  on storage.objects for select
  using (
    bucket_id = 'receipts'
    and private.is_member_of((storage.foldername(name))[1]::uuid)
  );

create policy "members write receipts"
  on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and private.is_member_of((storage.foldername(name))[1]::uuid)
  );

create policy "members update receipts"
  on storage.objects for update
  using (
    bucket_id = 'receipts'
    and private.is_member_of((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'receipts'
    and private.is_member_of((storage.foldername(name))[1]::uuid)
  );

-- =============================================================================
-- Grants notes
-- =============================================================================
--
-- Helper functions are in `private` and remain inaccessible to anon/authenticated.
-- The standard public-schema grants for anon/authenticated are managed by Supabase
-- defaults; RLS is what protects rows.
