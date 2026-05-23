-- pg_cron + pg_net for digest push notifications.
--
-- Strategy: pg_cron runs hourly UTC, calling the `cron-digest` Edge Function.
-- The Edge Function inspects each charity's `default_tz`, decides whether it's
-- 8am locally (and whether it's Monday for the weekly digest), and fans out
-- pushes via VAPID. Doing TZ math in the Edge Function avoids creating one
-- cron entry per charity.
--
-- The service-role bearer is stored in Supabase Vault (not as a GUC) because
-- the `postgres` role on Supabase is not a superuser and therefore cannot
-- ALTER DATABASE ... SET custom parameters. The project URL is not secret
-- and is hardcoded into the helper.
--
-- After applying this migration, store the service-role key once:
--
--   select vault.create_secret('<service-role-key>', 'cron_service_role_key');
--
-- This migration is idempotent and safe to re-run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.invoke_cron_digest()
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  url text := 'https://cjwybuhogxyayjnuxpem.supabase.co/functions/v1/cron-digest';
  key text;
begin
  select decrypted_secret into key
  from vault.decrypted_secrets
  where name = 'cron_service_role_key'
  limit 1;

  if key is null or key = '' then
    raise notice 'cron_service_role_key not in vault; skipping';
    return;
  end if;

  perform net.http_post(
    url := url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
end $$;

-- Unschedule any prior version of the job before re-scheduling.
do $$
declare
  jid bigint;
begin
  select jobid into jid from cron.job where jobname = 'charitytooling-hourly-digest';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'charitytooling-hourly-digest',
  '0 * * * *',
  $$select private.invoke_cron_digest();$$
);
