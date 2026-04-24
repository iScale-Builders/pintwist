-- Per-user rate limiting for the web API routes.
-- The extension's ingest endpoint already has its own install_id-keyed
-- rate limit (ingest_rate_limits + bump_rate_limit). This is the parallel
-- for the admin web APIs, keyed by Clerk user ID (text, not UUID).
--
-- Design: time-bucketed counters with explicit expires_at so cleanup is
-- a single DELETE on an indexed column. Callers pass a `window_key`
-- (e.g. "m:29354281" for minute #29354281) and an `expires_at` for TTL.

create table public.api_rate_limits (
  user_id text not null,
  window_key text not null,
  count integer not null default 0,
  expires_at timestamptz not null,
  primary key (user_id, window_key)
);

create index api_rate_limits_expires_idx on public.api_rate_limits (expires_at);

-- Atomic bump + check. Returns (allowed, current_count).
create or replace function public.bump_api_rate_limit(
  p_user_id text,
  p_window_key text,
  p_expires_at timestamptz,
  p_limit integer
) returns table(allowed boolean, current_count integer)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count integer;
begin
  insert into public.api_rate_limits (user_id, window_key, expires_at, count)
  values (p_user_id, p_window_key, p_expires_at, 1)
  on conflict (user_id, window_key)
  do update set count = public.api_rate_limits.count + 1
  returning public.api_rate_limits.count into v_count;

  return query select (v_count <= p_limit), v_count;
end;
$$;

revoke all on function public.bump_api_rate_limit(text, text, timestamptz, integer) from public;
grant execute on function public.bump_api_rate_limit(text, text, timestamptz, integer) to service_role;

-- Hourly cleanup of expired windows
select cron.schedule(
  'cleanup_api_rate_limits',
  '0 * * * *',
  $$delete from public.api_rate_limits where expires_at < now()$$
);

alter table public.api_rate_limits enable row level security;
