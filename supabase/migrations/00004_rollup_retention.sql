-- Nightly rollup: aggregate yesterday's pin_snapshots into permanent pin_daily.
-- Runs at 02:00 UTC. Snapshots older than 30 days get dropped at 03:00 UTC.
-- The rollup runs BEFORE retention so no data is lost.

select cron.schedule(
  'rollup_pin_daily',
  '0 2 * * *',
  $$
  insert into public.pin_daily (
    pin_id, day, unique_observers, observation_count,
    max_saves, min_saves, avg_saves, top_source_urls
  )
  select
    pin_id,
    (seen_at at time zone 'utc')::date as day,
    count(distinct install_id)::integer,
    count(*)::integer,
    max(saves)::integer,
    min(saves)::integer,
    avg(saves),
    (array_agg(distinct source_url) filter (where source_url is not null))[1:10]
  from public.pin_snapshots
  where seen_at >= (now() - interval '1 day')::date
    and seen_at <  now()::date
  group by pin_id, (seen_at at time zone 'utc')::date
  on conflict (pin_id, day) do update set
    unique_observers = excluded.unique_observers,
    observation_count = excluded.observation_count,
    max_saves = excluded.max_saves,
    min_saves = excluded.min_saves,
    avg_saves = excluded.avg_saves,
    top_source_urls = excluded.top_source_urls;
  $$
);

-- Retention: drop pin_snapshots older than 30 days.
-- pin_daily keeps the aggregate. Runs at 03:00 UTC, one hour after rollup,
-- so the prior-day rollup has already landed.
select cron.schedule(
  'retain_pin_snapshots',
  '0 3 * * *',
  $$delete from public.pin_snapshots where seen_at < now() - interval '30 days'$$
);
