-- Schedule the activity-digest Edge Function.
--
-- Same strategy as the push digest (see 20260522000001_cron.sql): pg_cron runs
-- hourly UTC and POSTs to the Edge Function with the service-role bearer stored
-- in Supabase Vault. The function does the timezone math itself - sending daily
-- digests at 8am and weekly digests on Monday 8am in the relevant timezone -
-- and is idempotent per recipient/period, so an extra hourly fire is harmless.
--
-- Reuses the existing 'cron_service_role_key' vault secret created for the push
-- digest; no new secret is required. Idempotent and safe to re-run.

create or replace function private.invoke_activity_digest()
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  url text := 'https://cjwybuhogxyayjnuxpem.supabase.co/functions/v1/activity-digest';
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
  select jobid into jid from cron.job where jobname = 'charitytooling-activity-digest';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'charitytooling-activity-digest',
  '0 * * * *',
  $$select private.invoke_activity_digest();$$
);
