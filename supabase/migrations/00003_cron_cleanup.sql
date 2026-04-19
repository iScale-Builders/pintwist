-- Enable pg_cron and schedule rate-limit table cleanup.
-- Rate-limit rows only matter for the current 60-second window;
-- 5 minutes gives a safety margin, every 10 minutes is plenty.

create extension if not exists pg_cron with schema extensions;

grant usage on schema cron to postgres;

select cron.schedule(
  'cleanup_ingest_rate_limits',
  '*/10 * * * *',
  $$delete from public.ingest_rate_limits where window_start < now() - interval '5 minutes'$$
);
