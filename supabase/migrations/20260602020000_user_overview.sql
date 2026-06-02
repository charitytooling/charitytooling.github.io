-- super_admin_user_overview - per-user activity rollup for the super-admin
-- Users table.
--
-- Returns one row per user (across all charities) with their total in-app
-- session time (app_sessions), total time on contact cards (customer_visits),
-- number of distinct active days, note count, and call count. This powers the
-- super-admin "Users" overview at /admin/users.
--
-- SECURITY DEFINER so the aggregation can scan every user's rows in a single
-- round trip, but gated on private.is_super_admin(): non-super callers get an
-- empty result set. Active days are bucketed in UTC since a global,
-- cross-charity table has no single reporting timezone.

create or replace function public.super_admin_user_overview()
returns table (
  user_id       uuid,
  email         text,
  full_name     text,
  app_seconds   bigint,
  visit_seconds bigint,
  active_days   bigint,
  note_count    bigint,
  call_count    bigint
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with sessions as (
    select s.user_id, sum(s.duration_seconds)::bigint as secs
    from public.app_sessions s
    group by s.user_id
  ),
  visits as (
    select cv.user_id, sum(cv.duration_seconds)::bigint as secs
    from public.customer_visits cv
    group by cv.user_id
  ),
  note_agg as (
    select n.created_by as user_id,
           count(*)::bigint as notes,
           (count(*) filter (where n.kind = 'call'))::bigint as calls
    from public.notes n
    where n.created_by is not null
    group by n.created_by
  ),
  active as (
    select d.user_id, count(distinct d.day)::bigint as days
    from (
      select s.user_id, (s.started_at at time zone 'UTC')::date as day
        from public.app_sessions s
      union
      select cv.user_id, (cv.started_at at time zone 'UTC')::date
        from public.customer_visits cv
      union
      select n.created_by as user_id, (n.created_at at time zone 'UTC')::date
        from public.notes n
       where n.created_by is not null
    ) d
    group by d.user_id
  )
  select
    p.id                    as user_id,
    p.email,
    p.full_name,
    coalesce(s.secs, 0)     as app_seconds,
    coalesce(v.secs, 0)     as visit_seconds,
    coalesce(a.days, 0)     as active_days,
    coalesce(n.notes, 0)    as note_count,
    coalesce(n.calls, 0)    as call_count
  from public.profiles p
  left join sessions s on s.user_id = p.id
  left join visits   v on v.user_id = p.id
  left join note_agg n on n.user_id = p.id
  left join active   a on a.user_id = p.id
  where private.is_super_admin()
  order by coalesce(s.secs, 0) desc, p.email asc nulls last;
$$;

grant execute on function public.super_admin_user_overview() to authenticated;
