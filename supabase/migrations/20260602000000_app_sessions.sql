-- app_sessions - real per-user app session tracking.
--
-- Records how long each user actively spends *in the app* (foreground time),
-- as opposed to customer_visits which only measures time on a single contact
-- card. The client keeps one "open" session row and periodically updates
-- duration_seconds / last_seen_at while the tab is visible, flushing on
-- visibilitychange and unmount (see src/state/sessionTracker.tsx). A fresh row
-- is started after an idle gap or a local-day rollover so windowed reporting
-- (used by the activity digest) attributes time cleanly.
--
-- Self-scoped like push_subscriptions: a user reads/writes only their own
-- rows. Super admins may read all rows for the admin activity views. The
-- activity-digest Edge Function reads via service_role and bypasses RLS.

create table public.app_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  started_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  user_agent       text,
  created_at       timestamptz not null default now()
);

alter table public.app_sessions enable row level security;

-- Digest scans filter by started_at within trailing windows; the admin views
-- list a user's recent sessions newest-first.
create index app_sessions_user_started_idx
  on public.app_sessions (user_id, started_at desc);
-- Cross-user scan the digest uses to pull the last 30 days in one query.
create index app_sessions_started_idx
  on public.app_sessions (started_at desc);

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------

create policy "read own sessions or super admin"
  on public.app_sessions for select
  using (auth.uid() = user_id or private.is_super_admin());

create policy "insert own sessions"
  on public.app_sessions for insert
  with check (auth.uid() = user_id);

create policy "update own sessions"
  on public.app_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
