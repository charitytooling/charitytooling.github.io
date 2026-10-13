-- CostTooling tenancy inside this project. Auth users and profiles are shared
-- with CharityTooling; everything CostTooling-specific is prefixed ct_.

create table if not exists public.ct_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.ct_companies enable row level security;

create table if not exists public.ct_company_members (
  company_id uuid not null references public.ct_companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','member')),
  invited_by uuid references auth.users(id),
  invited_at timestamptz default now(),
  accepted_at timestamptz,
  deactivated_at timestamptz,
  primary key (company_id, user_id)
);
alter table public.ct_company_members enable row level security;
create index if not exists ct_company_members_user_idx on public.ct_company_members (user_id);

create table if not exists public.ct_invitations (
  id uuid primary key default gen_random_uuid(),
  email text,
  company_id uuid not null references public.ct_companies(id) on delete cascade,
  role text not null check (role in ('admin','member')),
  token text not null unique,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  code text unique,
  max_uses int not null default 1 check (max_uses >= 1),
  uses int not null default 0 check (uses >= 0)
);
alter table public.ct_invitations enable row level security;
create index if not exists ct_invitations_email_idx on public.ct_invitations (lower(email));
create index if not exists ct_invitations_company_idx on public.ct_invitations (company_id);

create table if not exists public.ct_join_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.ct_companies(id) on delete cascade,
  code text not null unique,
  role text not null check (role in ('admin','member')),
  max_uses int not null default 25 check (max_uses >= 1),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz not null,
  created_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.ct_join_codes enable row level security;
create index if not exists ct_join_codes_company_idx on public.ct_join_codes (company_id);

-- One row per project; the app's own JSON is the source of truth. Photos live
-- in the ct-photos bucket under <company_id>/<photo_id>-full.jpg and -thumb.jpg.
create table if not exists public.ct_projects (
  id text primary key,
  company_id uuid not null references public.ct_companies(id) on delete cascade,
  name text,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);
alter table public.ct_projects enable row level security;
create index if not exists ct_projects_company_idx on public.ct_projects (company_id, updated_at desc);

-- Helpers -------------------------------------------------------------------
create or replace function private.ct_is_member_of(c uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select private.is_super_admin()
    or exists (select 1 from public.ct_company_members
               where user_id = auth.uid() and company_id = c and deactivated_at is null);
$$;
create or replace function private.ct_is_admin_of(c uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select private.is_super_admin()
    or exists (select 1 from public.ct_company_members
               where user_id = auth.uid() and company_id = c and role = 'admin' and deactivated_at is null);
$$;

-- Policies ------------------------------------------------------------------
drop policy if exists "members read ct_companies" on public.ct_companies;
create policy "members read ct_companies" on public.ct_companies for select using (private.ct_is_member_of(id));
drop policy if exists "admins update ct_companies" on public.ct_companies;
create policy "admins update ct_companies" on public.ct_companies for update using (private.ct_is_admin_of(id)) with check (private.ct_is_admin_of(id));
drop policy if exists "super admin deletes ct_companies" on public.ct_companies;
create policy "super admin deletes ct_companies" on public.ct_companies for delete using (private.is_super_admin());

drop policy if exists "members read ct_company_members" on public.ct_company_members;
create policy "members read ct_company_members" on public.ct_company_members for select using (private.ct_is_member_of(company_id) or user_id = auth.uid());
drop policy if exists "admins manage ct_company_members" on public.ct_company_members;
create policy "admins manage ct_company_members" on public.ct_company_members for all using (private.ct_is_admin_of(company_id)) with check (private.ct_is_admin_of(company_id));

drop policy if exists "admins manage ct_invitations" on public.ct_invitations;
create policy "admins manage ct_invitations" on public.ct_invitations for all using (private.ct_is_admin_of(company_id)) with check (private.ct_is_admin_of(company_id));
drop policy if exists "admins manage ct_join_codes" on public.ct_join_codes;
create policy "admins manage ct_join_codes" on public.ct_join_codes for all using (private.ct_is_admin_of(company_id)) with check (private.ct_is_admin_of(company_id));

drop policy if exists "members read ct_projects" on public.ct_projects;
create policy "members read ct_projects" on public.ct_projects for select using (private.ct_is_member_of(company_id));
drop policy if exists "members insert ct_projects" on public.ct_projects;
create policy "members insert ct_projects" on public.ct_projects for insert with check (private.ct_is_member_of(company_id));
drop policy if exists "members update ct_projects" on public.ct_projects;
create policy "members update ct_projects" on public.ct_projects for update using (private.ct_is_member_of(company_id)) with check (private.ct_is_member_of(company_id));
drop policy if exists "admins delete ct_projects" on public.ct_projects;
create policy "admins delete ct_projects" on public.ct_projects for delete using (private.ct_is_admin_of(company_id));

-- Company creation: the creator becomes its first admin.
create or replace function public.ct_create_company(p_name text)
returns public.ct_companies language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.ct_companies;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;
  insert into public.ct_companies (name, created_by) values (trim(p_name), auth.uid()) returning * into c;
  insert into public.ct_company_members (company_id, user_id, role, invited_by, accepted_at) values (c.id, auth.uid(), 'admin', auth.uid(), now());
  return c;
end $$;
revoke execute on function public.ct_create_company(text) from public, anon;
grant execute on function public.ct_create_company(text) to authenticated;

-- Codes ---------------------------------------------------------------------
create or replace function private.ct_generate_code(c_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  prefix text; suffix text; candidate text; i int;
begin
  select upper(regexp_replace(coalesce(name, ''), '[^A-Za-z]', '', 'g')) into prefix from public.ct_companies where id = c_id;
  prefix := rpad(substr(coalesce(prefix, ''), 1, 4), 4, 'X');
  loop
    suffix := '';
    for i in 1..4 loop suffix := suffix || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    candidate := prefix || '-' || suffix;
    exit when not exists (select 1 from public.ct_invitations where code = candidate)
         and not exists (select 1 from public.ct_join_codes where code = candidate)
         and not exists (select 1 from public.invitations where code = candidate)
         and not exists (select 1 from public.join_codes where code = candidate);
  end loop;
  return candidate;
end $$;

create or replace function public.ct_new_invite_code(c_id uuid)
returns text language sql security definer set search_path = public, pg_temp as $$ select private.ct_generate_code(c_id); $$;
revoke execute on function public.ct_new_invite_code(uuid) from public, anon, authenticated;
grant execute on function public.ct_new_invite_code(uuid) to service_role;

create or replace function public.ct_create_invite_code(c_id uuid, p_role text, p_email text default null)
returns public.ct_invitations language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.ct_invitations;
begin
  if not private.ct_is_admin_of(c_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin','member') then raise exception 'invalid role'; end if;
  insert into public.ct_invitations (email, company_id, role, token, invited_by, code)
  values (nullif(lower(trim(p_email)), ''), c_id, p_role, gen_random_uuid()::text, auth.uid(), private.ct_generate_code(c_id))
  returning * into inv;
  return inv;
end $$;
revoke execute on function public.ct_create_invite_code(uuid, text, text) from public, anon;
grant execute on function public.ct_create_invite_code(uuid, text, text) to authenticated;

create or replace function public.ct_rotate_join_code(c_id uuid, p_role text default 'member', p_max_uses int default 25, p_days int default 30)
returns public.ct_join_codes language plpgsql security definer set search_path = public, pg_temp as $$
declare jc public.ct_join_codes;
begin
  if not private.ct_is_admin_of(c_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin','member') then raise exception 'invalid role'; end if;
  update public.ct_join_codes set revoked_at = now() where company_id = c_id and revoked_at is null;
  insert into public.ct_join_codes (company_id, code, role, max_uses, expires_at, created_by)
  values (c_id, private.ct_generate_code(c_id), p_role, greatest(1, p_max_uses), now() + make_interval(days => greatest(1, p_days)), auth.uid())
  returning * into jc;
  return jc;
end $$;
revoke execute on function public.ct_rotate_join_code(uuid, text, int, int) from public, anon;
grant execute on function public.ct_rotate_join_code(uuid, text, int, int) to authenticated;

create or replace function public.ct_list_members(c_id uuid)
returns table (user_id uuid, email text, full_name text, role text, invited_at timestamptz, accepted_at timestamptz, deactivated_at timestamptz, must_change_password boolean, suspended_at timestamptz)
language sql security definer stable set search_path = public, pg_temp as $$
  select m.user_id, p.email, p.full_name, m.role, m.invited_at, m.accepted_at, m.deactivated_at, coalesce(p.must_change_password, false), p.suspended_at
  from public.ct_company_members m left join public.profiles p on p.id = m.user_id
  where m.company_id = c_id and private.ct_is_admin_of(c_id)
  order by m.deactivated_at nulls first, m.invited_at asc nulls last;
$$;
revoke execute on function public.ct_list_members(uuid) from public, anon;
grant execute on function public.ct_list_members(uuid) to authenticated;

create or replace function public.ct_lookup_code(p_code text)
returns table (kind text, company_id uuid, company_name text, role text, email text, invited_by uuid, valid boolean, reason text)
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare inv public.ct_invitations; jc public.ct_join_codes; c text := private.normalize_code(p_code);
begin
  select * into inv from public.ct_invitations where code = c;
  if found then
    return query select 'invite'::text, inv.company_id, co.name, inv.role, inv.email, inv.invited_by,
      (inv.accepted_at is null and inv.expires_at > now() and inv.uses < inv.max_uses),
      case when inv.accepted_at is not null or inv.uses >= inv.max_uses then 'used' when inv.expires_at <= now() then 'expired' else null end
      from public.ct_companies co where co.id = inv.company_id;
    return;
  end if;
  select * into jc from public.ct_join_codes where code = c;
  if found then
    return query select 'join'::text, jc.company_id, co.name, jc.role, null::text, jc.created_by,
      (jc.revoked_at is null and jc.expires_at > now() and jc.uses < jc.max_uses),
      case when jc.revoked_at is not null then 'revoked' when jc.uses >= jc.max_uses then 'used' when jc.expires_at <= now() then 'expired' else null end
      from public.ct_companies co where co.id = jc.company_id;
    return;
  end if;
  return query select 'none'::text, null::uuid, null::text, null::text, null::text, null::uuid, false, 'not-found'::text;
end $$;
revoke execute on function public.ct_lookup_code(text) from public, anon, authenticated;
grant execute on function public.ct_lookup_code(text) to service_role;

create or replace function public.ct_consume_code(p_code text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare c text := private.normalize_code(p_code); n int;
begin
  update public.ct_invitations set uses = uses + 1, accepted_at = case when uses + 1 >= max_uses then now() else accepted_at end
   where code = c and accepted_at is null and expires_at > now() and uses < max_uses;
  get diagnostics n = row_count;
  if n > 0 then return true; end if;
  update public.ct_join_codes set uses = uses + 1 where code = c and revoked_at is null and expires_at > now() and uses < max_uses;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke execute on function public.ct_consume_code(text) from public, anon, authenticated;
grant execute on function public.ct_consume_code(text) to service_role;

-- Triggers: reconcile CostTooling invites alongside charity ones -------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  configured_email text;
  bootstrap_email  text := 'robert@douglasmining.com';
begin
  begin configured_email := current_setting('app.bootstrap_admin_email', true); exception when others then configured_email := null; end;
  if configured_email is not null and configured_email <> '' then bootstrap_email := configured_email; end if;

  insert into public.profiles (id, email, is_super_admin)
  values (new.id, new.email, lower(new.email) = lower(bootstrap_email))
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id) values (new.id) on conflict (user_id) do nothing;

  insert into public.charity_members (charity_id, user_id, role, invited_by, invited_at, accepted_at)
  select i.charity_id, new.id, i.role, i.invited_by, i.created_at, null
  from public.invitations i
  where i.email is not null and lower(i.email) = lower(new.email) and i.accepted_at is null and i.expires_at > now()
  on conflict (charity_id, user_id) do nothing;

  insert into public.ct_company_members (company_id, user_id, role, invited_by, invited_at, accepted_at)
  select i.company_id, new.id, i.role, i.invited_by, i.created_at, null
  from public.ct_invitations i
  where i.email is not null and lower(i.email) = lower(new.email) and i.accepted_at is null and i.expires_at > now()
  on conflict (company_id, user_id) do nothing;

  return new;
end $$;

create or replace function private.handle_user_signed_in()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.last_sign_in_at is null and new.last_sign_in_at is not null then
    update public.charity_members set accepted_at = new.last_sign_in_at where user_id = new.id and accepted_at is null;
    update public.invitations set accepted_at = new.last_sign_in_at where email is not null and lower(email) = lower(new.email) and accepted_at is null;
    update public.ct_company_members set accepted_at = new.last_sign_in_at where user_id = new.id and accepted_at is null;
    update public.ct_invitations set accepted_at = new.last_sign_in_at where email is not null and lower(email) = lower(new.email) and accepted_at is null;
  end if;
  return new;
end $$;

-- Photos bucket --------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit) values ('ct-photos', 'ct-photos', false, 5242880) on conflict (id) do nothing;
drop policy if exists "ct members read photos" on storage.objects;
create policy "ct members read photos" on storage.objects for select using (bucket_id = 'ct-photos' and private.ct_is_member_of((storage.foldername(name))[1]::uuid));
drop policy if exists "ct members write photos" on storage.objects;
create policy "ct members write photos" on storage.objects for insert with check (bucket_id = 'ct-photos' and private.ct_is_member_of((storage.foldername(name))[1]::uuid));
drop policy if exists "ct members update photos" on storage.objects;
create policy "ct members update photos" on storage.objects for update using (bucket_id = 'ct-photos' and private.ct_is_member_of((storage.foldername(name))[1]::uuid)) with check (bucket_id = 'ct-photos' and private.ct_is_member_of((storage.foldername(name))[1]::uuid));
drop policy if exists "ct members delete photos" on storage.objects;
create policy "ct members delete photos" on storage.objects for delete using (bucket_id = 'ct-photos' and private.ct_is_member_of((storage.foldername(name))[1]::uuid));
