-- Schedules the Edge Functions with pg_cron + pg_net (both free on Supabase).
--
-- Before this works, store two secrets in Vault once (SQL editor), replacing the values:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<the same value as the CRON_SECRET function secret>', 'cron_secret');
-- The jobs read them at run time, so nothing secret lives in this file.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.call_edge_function(fn text, payload jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := payload,
    timeout_milliseconds := 30000
  );
$$;

-- nobody but the scheduler should be able to trigger these
revoke all on function public.call_edge_function(text, jsonb) from public, anon, authenticated;

-- Every 15 minutes: send nightly summaries to everyone whose chosen time has passed today.
-- (The function sends at most one daily, and on Sundays one weekly, email per user per day.)
select cron.schedule('dayflow-daily-summary', '*/15 * * * *', $$ select public.call_edge_function('daily-summary') $$);

-- Every minute: push reminders for blocks that start soon.
select cron.schedule('dayflow-reminders', '* * * * *', $$ select public.call_edge_function('send-reminders') $$);

-- Housekeeping: pg_net keeps response rows; drop old ones daily.
select cron.schedule('dayflow-net-cleanup', '17 3 * * *', $$ delete from net._http_response where created < now() - interval '2 days' $$);
