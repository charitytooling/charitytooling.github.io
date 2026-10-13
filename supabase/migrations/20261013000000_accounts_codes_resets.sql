-- Accounts: invite codes, team join codes, member deactivation, forced
-- password change, and the pieces the admin-reset / join-with-code Edge
-- Functions need. Additive and idempotent.

-- =============================================================================
-- 1. invitations: human code, optional email, multi-use
-- =============================================================================
alter table public.invitations alter column email drop not null;
alter table public.invitations add column if not exists code text unique;
alter table public.invitations add column if not exists max_uses int not null default 1 check (max_uses >= 1);
alter table public.invitations add column if not exists uses int not null default 0 check (uses >= 0);
create index if not exists invitations_code_idx on public.invitations (code);

-- =============================================================================
-- 2. join_codes: one reusable code per charity for a team signing up together
-- =============================================================================
create table if not exists public.join_codes (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charities(id) on delete cascade,
  code text not null unique,
  role text not null check (role in ('admin','rep')),
  max_uses int not null default 25 check (max_uses >= 1),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz not null,
  created_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.join_codes enable row level security;
create index if not exists join_codes_charity_idx on public.join_codes (charity_id);
drop policy if exists "admins manage join_codes" on public.join_codes;
create policy "admins manage join_codes" on public.join_codes
  for all using (private.is_admin_of(charity_id)) with check (private.is_admin_of(charity_id));

-- =============================================================================
-- 3. members: deactivation keeps the row (and the person's notes/donations)
-- =============================================================================
alter table public.charity_members add column if not exists deactivated_at timestamptz;

-- =============================================================================
-- 4. profiles: forced password change after an admin reset; suspension marker
-- =============================================================================
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists suspended_at timestamptz;

-- =============================================================================
-- 5. helpers: deactivated members fail every policy
-- =============================================================================
create or replace function private.is_member_of(c uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select private.is_super_admin()
    or exists (select 1 from public.charity_members
               where user_id = auth.uid() and charity_id = c and deactivated_at is null);
$$;

create or replace function private.is_admin_of(c uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select private.is_super_admin()
    or exists (select 1 from public.charity_members
               where user_id = auth.uid() and charity_id = c and role = 'admin' and deactivated_at is null);
$$;

drop function if exists public.list_charity_members(uuid);
create function public.list_charity_members(c_id uuid)
returns table (user_id uuid, email text, full_name text, role text, invited_at timestamptz, accepted_at timestamptz, deactivated_at timestamptz, must_change_password boolean, suspended_at timestamptz)
language sql security definer stable set search_path = public, pg_temp as $$
  select cm.user_id, p.email, p.full_name, cm.role, cm.invited_at, cm.accepted_at, cm.deactivated_at,
         coalesce(p.must_change_password, false), p.suspended_at
  from public.charity_members cm
  left join public.profiles p on p.id = cm.user_id
  where cm.charity_id = c_id
    and (private.is_admin_of(c_id) or private.is_super_admin())
  order by cm.deactivated_at nulls first, cm.invited_at asc nulls last;
$$;
grant execute on function public.list_charity_members(uuid) to authenticated;

-- =============================================================================
-- 6. code generation: BRDG-7K2M style, no ambiguous characters
-- =============================================================================
create or replace function private.generate_code(c_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  prefix text; suffix text; candidate text; i int;
begin
  select upper(regexp_replace(coalesce(name, ''), '[^A-Za-z]', '', 'g')) into prefix from public.charities where id = c_id;
  prefix := rpad(substr(coalesce(prefix, ''), 1, 4), 4, 'X');
  loop
    suffix := '';
    for i in 1..4 loop
      suffix := suffix || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    candidate := prefix || '-' || suffix;
    exit when not exists (select 1 from public.invitations where code = candidate)
         and not exists (select 1 from public.join_codes where code = candidate);
  end loop;
  return candidate;
end $$;

-- For the invite-user Edge Function (service role) so every emailed invite also carries a code.
create or replace function public.new_invite_code(c_id uuid)
returns text language sql security definer set search_path = public, pg_temp as $$
  select private.generate_code(c_id);
$$;
revoke execute on function public.new_invite_code(uuid) from public, anon, authenticated;
grant execute on function public.new_invite_code(uuid) to service_role;

-- Admin creates a code-only invite (no email) from the Members screen.
create or replace function public.create_invite_code(c_id uuid, p_role text, p_email text default null)
returns public.invitations language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.invitations;
begin
  if not private.is_admin_of(c_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin','rep') then raise exception 'invalid role'; end if;
  insert into public.invitations (email, charity_id, role, token, invited_by, code)
  values (nullif(lower(trim(p_email)), ''), c_id, p_role, gen_random_uuid()::text, auth.uid(), private.generate_code(c_id))
  returning * into inv;
  return inv;
end $$;
grant execute on function public.create_invite_code(uuid, text, text) to authenticated;

-- Admin rotates the charity's team join code: revokes the old one, makes a new one.
create or replace function public.rotate_join_code(c_id uuid, p_role text default 'rep', p_max_uses int default 25, p_days int default 30)
returns public.join_codes language plpgsql security definer set search_path = public, pg_temp as $$
declare jc public.join_codes;
begin
  if not private.is_admin_of(c_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin','rep') then raise exception 'invalid role'; end if;
  update public.join_codes set revoked_at = now() where charity_id = c_id and revoked_at is null;
  insert into public.join_codes (charity_id, code, role, max_uses, expires_at, created_by)
  values (c_id, private.generate_code(c_id), p_role, greatest(1, p_max_uses), now() + make_interval(days => greatest(1, p_days)), auth.uid())
  returning * into jc;
  return jc;
end $$;
grant execute on function public.rotate_join_code(uuid, text, int, int) to authenticated;

-- =============================================================================
-- 7. lookup / consume: used only by the join-with-code Edge Function
-- =============================================================================
create or replace function public.lookup_code(p_code text)
returns table (kind text, charity_id uuid, charity_name text, role text, email text, invited_by uuid, valid boolean, reason text)
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare inv public.invitations; jc public.join_codes; c text := upper(regexp_replace(coalesce(p_code,''), '\s', '', 'g'));
begin
  select * into inv from public.invitations where code = c;
  if found then
    return query select 'invite'::text, inv.charity_id, ch.name, inv.role, inv.email, inv.invited_by,
      (inv.accepted_at is null and inv.expires_at > now() and inv.uses < inv.max_uses),
      case when inv.accepted_at is not null or inv.uses >= inv.max_uses then 'used' when inv.expires_at <= now() then 'expired' else null end
      from public.charities ch where ch.id = inv.charity_id;
    return;
  end if;
  select * into jc from public.join_codes where code = c;
  if found then
    return query select 'join'::text, jc.charity_id, ch.name, jc.role, null::text, jc.created_by,
      (jc.revoked_at is null and jc.expires_at > now() and jc.uses < jc.max_uses),
      case when jc.revoked_at is not null then 'revoked' when jc.uses >= jc.max_uses then 'used' when jc.expires_at <= now() then 'expired' else null end
      from public.charities ch where ch.id = jc.charity_id;
    return;
  end if;
  return query select 'none'::text, null::uuid, null::text, null::text, null::text, null::uuid, false, 'not-found'::text;
end $$;
revoke execute on function public.lookup_code(text) from public, anon, authenticated;
grant execute on function public.lookup_code(text) to service_role;

create or replace function public.consume_code(p_code text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare c text := upper(regexp_replace(coalesce(p_code,''), '\s', '', 'g')); n int;
begin
  update public.invitations set uses = uses + 1,
         accepted_at = case when uses + 1 >= max_uses then now() else accepted_at end
   where code = c and accepted_at is null and expires_at > now() and uses < max_uses;
  get diagnostics n = row_count;
  if n > 0 then return true; end if;
  update public.join_codes set uses = uses + 1
   where code = c and revoked_at is null and expires_at > now() and uses < max_uses;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.consume_code(text) from public, anon, authenticated;
grant execute on function public.consume_code(text) to service_role;

-- =============================================================================
-- 8. rate limit for code checks (the join function is public)
-- =============================================================================
create table if not exists public.code_attempts (
  ip text not null,
  at timestamptz not null default now()
);
alter table public.code_attempts enable row level security;  -- no policies: service role only
create index if not exists code_attempts_ip_at_idx on public.code_attempts (ip, at desc);

create or replace function public.code_attempt_allowed(p_ip text, p_limit int default 10)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into public.code_attempts (ip) values (coalesce(p_ip, 'unknown'));
  if random() < 0.05 then delete from public.code_attempts where at < now() - interval '1 hour'; end if;
  select count(*) into n from public.code_attempts where ip = coalesce(p_ip, 'unknown') and at > now() - interval '1 minute';
  return n <= p_limit;
end $$;
revoke execute on function public.code_attempt_allowed(text, int) from public, anon, authenticated;
grant execute on function public.code_attempt_allowed(text, int) to service_role;

-- Signed-in only: these check private.is_admin_of(), which needs auth.uid(), so anon calls would fail anyway.
revoke execute on function public.create_invite_code(uuid, text, text) from public, anon;
revoke execute on function public.rotate_join_code(uuid, text, int, int) from public, anon;
revoke execute on function public.list_charity_members(uuid) from public, anon;
