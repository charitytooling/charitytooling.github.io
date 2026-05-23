-- Fix: private.write_audit() previously assumed every audited table has an
-- `id` column. public.charity_members uses a composite primary key
-- (charity_id, user_id) and has no `id` column, so the cast
-- (to_jsonb(NEW) ->> 'id')::uuid resolved to NULL and the insert into
-- public.audit_log (entity_id NOT NULL) raised a not-null violation. That
-- failure surfaced as "Database error saving new user" whenever Supabase
-- Auth tried to insert into auth.users with the on_auth_user_created trigger
-- chain firing handle_new_user -> insert into charity_members -> write_audit.
--
-- Resolution: coalesce the entity id through `id`, then `user_id`, then a
-- synthetic uuid. For charity_members audits this records the affected user;
-- for any future audited composite-key table the fallback prevents the
-- trigger from blowing up the entire transaction.

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
    e_id := coalesce(
      (to_jsonb(new) ->> 'id')::uuid,
      (to_jsonb(new) ->> 'user_id')::uuid,
      gen_random_uuid()
    );
    diff := jsonb_build_object('after', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    c_id := (to_jsonb(new) ->> 'charity_id')::uuid;
    e_id := coalesce(
      (to_jsonb(new) ->> 'id')::uuid,
      (to_jsonb(new) ->> 'user_id')::uuid,
      gen_random_uuid()
    );
    diff := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  elsif tg_op = 'DELETE' then
    c_id := (to_jsonb(old) ->> 'charity_id')::uuid;
    e_id := coalesce(
      (to_jsonb(old) ->> 'id')::uuid,
      (to_jsonb(old) ->> 'user_id')::uuid,
      gen_random_uuid()
    );
    diff := jsonb_build_object('before', to_jsonb(old));
  end if;

  insert into public.audit_log (actor_id, charity_id, entity_type, entity_id, action, diff)
  values (auth.uid(), c_id, tg_table_name, e_id, lower(tg_op), diff);

  return coalesce(new, old);
end $$;
