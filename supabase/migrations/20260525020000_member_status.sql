-- Members - invited vs. accepted
--
-- Until now, private.handle_new_user stamped charity_members.accepted_at and
-- invitations.accepted_at at the moment Supabase Auth inserted the new
-- auth.users row - i.e. at invite time, before the invitee had clicked their
-- magic link. That made the "Pending invitations" UI immediately empty after
-- sending an invite and made it impossible to distinguish "invited" from
-- "actually accepted".
--
-- This migration:
--   1. Removes the accepted_at stamping from handle_new_user; rows are still
--      created at invite time, but accepted_at stays NULL.
--   2. Adds a new trigger on auth.users that stamps accepted_at the first time
--      last_sign_in_at flips from NULL to non-NULL.
--   3. Backfills existing rows so the new semantics apply to today's data.
--   4. Adds public.list_charity_members(c_id) - a SECURITY DEFINER RPC that
--      returns charity_members joined with profiles. This sidesteps the
--      PostgREST embed failure caused by charity_members.user_id pointing at
--      auth.users(id) rather than public.profiles(id), which was silently
--      causing the admin page to render "No members yet.".

-- =============================================================================
-- 1. handle_new_user: drop the accepted_at stamping
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
  -- accepted_at is intentionally left NULL here; handle_user_signed_in will
  -- stamp it on first sign-in.
  insert into public.charity_members (charity_id, user_id, role, invited_by, invited_at, accepted_at)
  select i.charity_id, new.id, i.role, i.invited_by, i.created_at, null
  from public.invitations i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
    and i.expires_at > now()
  on conflict (charity_id, user_id) do nothing;

  return new;
end $$;

-- =============================================================================
-- 2. handle_user_signed_in: stamp accepted_at on first sign-in
-- =============================================================================

create or replace function private.handle_user_signed_in()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.last_sign_in_at is null and new.last_sign_in_at is not null then
    update public.charity_members
       set accepted_at = new.last_sign_in_at
     where user_id = new.id
       and accepted_at is null;

    update public.invitations
       set accepted_at = new.last_sign_in_at
     where lower(email) = lower(new.email)
       and accepted_at is null;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row execute function private.handle_user_signed_in();

-- =============================================================================
-- 3. Backfill: align existing rows with the new semantics
-- =============================================================================

update public.charity_members cm
   set accepted_at = u.last_sign_in_at
  from auth.users u
 where u.id = cm.user_id;

update public.invitations inv
   set accepted_at = u.last_sign_in_at
  from auth.users u
 where lower(u.email) = lower(inv.email);

-- =============================================================================
-- 4. list_charity_members RPC
-- =============================================================================

create or replace function public.list_charity_members(c_id uuid)
returns table (
  user_id     uuid,
  email       text,
  full_name   text,
  role        text,
  invited_at  timestamptz,
  accepted_at timestamptz
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select cm.user_id, p.email, p.full_name, cm.role, cm.invited_at, cm.accepted_at
  from public.charity_members cm
  left join public.profiles p on p.id = cm.user_id
  where cm.charity_id = c_id
    and (private.is_admin_of(c_id) or private.is_super_admin())
  order by cm.invited_at asc nulls last;
$$;

grant execute on function public.list_charity_members(uuid) to authenticated;
