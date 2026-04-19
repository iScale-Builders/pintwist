-- Drop the 30-day pin_snapshots retention cron.
-- Rationale: at current scale (low-thousands of rows/day), the cost of
-- keeping full raw time-series is trivial (~$1/month at 1k DAU) and the
-- forensic value is high. Retention was premature optimization.
--
-- The rollup_pin_daily cron stays — pin_daily is still useful as a fast
-- historical aggregate for charts, and costs nothing to maintain.
--
-- Re-evaluation trigger: when public.pin_snapshots passes ~500,000 rows,
-- decide between:
--   (a) push aggregation into SQL SECURITY DEFINER functions (cheap),
--   (b) add monthly partitioning with drop-old-partition retention,
--   (c) archive old rows to a cold-storage table.
--
-- See workspace/skills/pintwist/SKILL.md for the rationale.

select cron.unschedule('retain_pin_snapshots');

-- Verify only cleanup + rollup remain:
-- select jobname, schedule, active from cron.job order by jobname;
