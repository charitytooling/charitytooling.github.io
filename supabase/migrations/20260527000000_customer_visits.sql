-- Per-customer visit log.
--
-- Records how long a rep spends on each customer's contact card so we can
-- display a stopwatch live (current visit) and later surface lifetime
-- engagement totals per customer. Append-only in v1: no update or delete
-- policies, so reps can record their own visits but cannot edit history.

create table public.customer_visits (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id) on delete cascade,
  -- Denormalized so RLS policies can gate on charity_id directly without
  -- joining to customers on every read.
  charity_id       uuid not null references public.charities(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  created_at       timestamptz not null default now()
);

alter table public.customer_visits enable row level security;

create index customer_visits_customer_idx
  on public.customer_visits (customer_id, ended_at desc);

create index customer_visits_charity_user_idx
  on public.customer_visits (charity_id, user_id, ended_at desc);

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------

create policy "members read customer_visits"
  on public.customer_visits for select
  using (private.is_member_of(charity_id));

create policy "members insert own visits"
  on public.customer_visits for insert
  with check (
    private.is_member_of(charity_id)
    and user_id = auth.uid()
  );
