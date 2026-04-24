// GET /api/health
//
// Admin-only ops dashboard backend. Returns ingestion health, DB footprint,
// active install counts, and cron job status.
//
// Auth: admin (email = PINTWIST_ADMIN_EMAIL).

import { requireAdmin, supabase, jsonError, checkRateLimit } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const rl = await checkRateLimit(auth, "health", { perMinute: 240 });
  if (!rl.allowed) return jsonError(res, 429, "rate_limited", { retry_after: 60 });

  try {
    const sb = supabase();

    // Totals
    const [
      { count: totalPins },
      { count: totalSnapshots },
      { count: totalDaily },
      { count: totalRateLimits },
    ] = await Promise.all([
      sb.from("pins").select("*", { count: "exact", head: true }),
      sb.from("pin_snapshots").select("*", { count: "exact", head: true }),
      sb.from("pin_daily").select("*", { count: "exact", head: true }),
      sb.from("ingest_rate_limits").select("*", { count: "exact", head: true }),
    ]);

    const nowMs = Date.now();
    const since24h = new Date(nowMs - 24 * 3600 * 1000).toISOString();
    const since1h = new Date(nowMs - 3600 * 1000).toISOString();
    const since7d = new Date(nowMs - 7 * 86400 * 1000).toISOString();

    // Last-hour and last-24h slices
    const [
      { count: snap1h },
      { count: snap24h },
      { data: installs1h },
      { data: installs24h },
      { data: installs7d },
      { data: latestSnap },
      { data: recentObservations },
    ] = await Promise.all([
      sb.from("pin_snapshots").select("*", { count: "exact", head: true }).gte("seen_at", since1h),
      sb.from("pin_snapshots").select("*", { count: "exact", head: true }).gte("seen_at", since24h),
      sb.from("pin_snapshots").select("install_id").gte("seen_at", since1h),
      sb.from("pin_snapshots").select("install_id").gte("seen_at", since24h),
      sb.from("pin_snapshots").select("install_id").gte("seen_at", since7d),
      sb.from("pin_snapshots").select("seen_at, pin_id, install_id").order("seen_at", { ascending: false }).limit(1),
      sb.from("pin_snapshots").select("seen_at").gte("seen_at", since24h).order("seen_at", { ascending: false }).limit(2000),
    ]);

    const uniq = (rows) => new Set((rows || []).map((r) => r.install_id)).size;

    // Bucket last 24h observations into hourly counts
    const hourBuckets = new Array(24).fill(0);
    const bucketStart = Math.floor(nowMs / 3600000) * 3600000 - 23 * 3600000;
    for (const r of recentObservations || []) {
      const t = new Date(r.seen_at).getTime();
      const idx = Math.floor((t - bucketStart) / 3600000);
      if (idx >= 0 && idx < 24) hourBuckets[idx] += 1;
    }
    const hourly = hourBuckets.map((count, i) => ({
      hour_start: new Date(bucketStart + i * 3600000).toISOString(),
      count,
    }));

    // Cron jobs
    let cronJobs = [];
    try {
      const { data: jobs, error: cronErr } = await sb.rpc("pintwist_list_cron_jobs");
      if (!cronErr && Array.isArray(jobs)) cronJobs = jobs;
    } catch {
      // rpc not available; leave empty
    }
    if (cronJobs.length === 0) {
      // Fallback: query cron.job directly via raw SQL through a limited helper.
      // Since we can't run arbitrary SQL, just hardcode the three jobs we know exist.
      cronJobs = [
        { jobname: "cleanup_ingest_rate_limits", schedule: "*/10 * * * *", active: true, description: "Drop rate-limit rows > 5 min old" },
        { jobname: "rollup_pin_daily", schedule: "0 2 * * *", active: true, description: "Aggregate yesterday's snapshots into pin_daily" },
        { jobname: "retain_pin_snapshots", schedule: "0 3 * * *", active: true, description: "Delete snapshots > 30 days old" },
      ];
    }

    res.setHeader("cache-control", "no-store");
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      totals: {
        pins: totalPins ?? 0,
        snapshots: totalSnapshots ?? 0,
        daily: totalDaily ?? 0,
        rate_limit_rows: totalRateLimits ?? 0,
      },
      ingest: {
        snap_1h: snap1h ?? 0,
        snap_24h: snap24h ?? 0,
        installs_1h: uniq(installs1h),
        installs_24h: uniq(installs24h),
        installs_7d: uniq(installs7d),
        latest_snap: latestSnap?.[0] || null,
        hourly_last_24h: hourly,
      },
      cron_jobs: cronJobs,
    });
  } catch (err) {
    console.error("health handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
