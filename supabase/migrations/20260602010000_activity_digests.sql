-- Activity digest emails (super-admin only).
--
-- A super admin configures recipients who receive a periodic email summarizing
-- team activity: people contacted, added, archived, and time spent in the app,
-- broken down per user with totals, across trailing windows (1d/3d/7d/14d/30d).
--
--   * activity_digest_recipients - who gets the email, how often, for which
--     charities. Managed only by super admins (RLS).
--   * activity_digest_log        - one row per send, for an audit trail and to
--     make the hourly cron idempotent (unique on recipient + period_key).
--
-- The activity-digest Edge Function reads recipients + computes metrics via
-- service_role (bypassing RLS) and writes the log rows.

create table public.activity_digest_recipients (
  id          uuid primary key default gen_random_uuid(),
  -- Recipient. Email is resolved from public.profiles at send time so it stays
  -- in sync if the user's address changes.
  user_id     uuid not null references auth.users(id) on delete cascade,
  send_daily  boolean not null default false,
  send_weekly boolean not null default true,
  -- 'all'      -> every charity in the system
  -- 'specific' -> only the charities listed in charity_ids
  scope       text not null default 'all' check (scope in ('all', 'specific')),
  charity_ids uuid[] not null default '{}',
  enabled     boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.activity_digest_recipients enable row level security;

create index activity_digest_recipients_user_idx
  on public.activity_digest_recipients (user_id);

create trigger activity_digest_recipients_updated_at
  before update on public.activity_digest_recipients
  for each row execute function private.set_updated_at();

create table public.activity_digest_log (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references auth.users(id) on delete set null,
  to_email          text not null,
  frequency         text not null check (frequency in ('daily', 'weekly')),
  -- Bucket key for idempotency, e.g. '2026-06-02-daily' or '2026-W23-weekly'.
  -- The hourly cron can fire the 8am-local check more than once on retries; the
  -- unique constraint below guarantees at most one send per recipient/period.
  period_key        text not null,
  resend_id         text,
  status            text,
  detail            jsonb,
  sent_at           timestamptz not null default now()
);
alter table public.activity_digest_log enable row level security;

create unique index activity_digest_log_recipient_period_idx
  on public.activity_digest_log (recipient_user_id, period_key);
create index activity_digest_log_sent_idx
  on public.activity_digest_log (sent_at desc);

-- -----------------------------------------------------------------------------
-- RLS policies - super admin only. The Edge Function uses service_role.
-- -----------------------------------------------------------------------------

create policy "super admin manages digest recipients"
  on public.activity_digest_recipients for all
  using (private.is_super_admin())
  with check (private.is_super_admin());

create policy "super admin reads digest log"
  on public.activity_digest_log for select
  using (private.is_super_admin());
