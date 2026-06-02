-- super_admin_user_overview - add an optional `since` time window.
--
-- The super-admin Users page now offers 7d / 30d / 90d / All time toggles, so
-- the per-user rollup needs to be bounded by a start timestamp. `since` is
-- nullable: NULL keeps the original all-time behavior (used by "All time").
--
-- Adding a parameter changes the function signature, so the zero-arg version is
-- dropped first; otherwise this would create a second overload and make the RPC
-- call ambiguous from PostgREST.

drop function if exists public.super_admin_user_overview();

create or replace function public.super_admin_user_overview(since timestamptz default null)
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
    where (since is null or s.started_at >= since)
    group by s.user_id
  ),
  visits as (
    select cv.user_id, sum(cv.duration_seconds)::bigint as secs
    from public.customer_visits cv
    where (since is null or cv.started_at >= since)
    group by cv.user_id
  ),
  note_agg as (
    select n.created_by as user_id,
           count(*)::bigint as notes,
           (count(*) filter (where n.kind = 'call'))::bigint as calls
    from public.notes n
    where n.created_by is not null
      and (since is null or n.created_at >= since)
    group by n.created_by
  ),
  active as (
    select d.user_id, count(distinct d.day)::bigint as days
    from (
      select s.user_id, (s.started_at at time zone 'UTC')::date as day
        from public.app_sessions s
       where (since is null or s.started_at >= since)
      union
      select cv.user_id, (cv.started_at at time zone 'UTC')::date
        from public.customer_visits cv
       where (since is null or cv.started_at >= since)
      union
      select n.created_by as user_id, (n.created_at at time zone 'UTC')::date
        from public.notes n
       where n.created_by is not null
         and (since is null or n.created_at >= since)
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

grant execute on function public.super_admin_user_overview(timestamptz) to authenticated;
