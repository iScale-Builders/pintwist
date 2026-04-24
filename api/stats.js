// GET /api/stats
//
// Small, fast endpoint for the global stats bar: total pins, total snapshots,
// unique installs in last 7d, and latest snapshot timestamp.
//
// Auth: signed-in Clerk user (any role).

import { requireAdmin, supabase, jsonError, checkRateLimit } from "./_lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const rl = await checkRateLimit(auth, "stats", { perMinute: 240 });
  if (!rl.allowed) return jsonError(res, 429, "rate_limited", { retry_after: 60 });

  try {
    const sb = supabase();
    const since7d = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [
      { count: pins },
      { count: snapshots },
      { data: installsRows },
      { data: installs24hRows },
      { data: latestRows },
      { count: niches },
    ] = await Promise.all([
      sb.from("pins").select("*", { count: "exact", head: true }),
      sb.from("pin_snapshots").select("*", { count: "exact", head: true }),
      sb.from("pin_snapshots").select("install_id").gte("seen_at", since7d),
      sb.from("pin_snapshots").select("install_id").gte("seen_at", since24h),
      sb.from("pin_snapshots").select("seen_at").order("seen_at", { ascending: false }).limit(1),
      sb.from("pin_daily").select("*", { count: "exact", head: true }),
    ]);

    const unique7d = new Set((installsRows || []).map((r) => r.install_id)).size;
    const unique24h = new Set((installs24hRows || []).map((r) => r.install_id)).size;

    res.setHeader("cache-control", "no-store");
    return res.status(200).json({
      total_pins: pins ?? 0,
      total_snapshots: snapshots ?? 0,
      installs_7d: unique7d,
      installs_24h: unique24h,
      daily_rows: niches ?? 0,
      latest_seen: latestRows?.[0]?.seen_at || null,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    console.error("stats handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
