// GET /api/snapshots?pin_id=...
//
// Per-pin snapshot timeline: every observation across every install for one pin.
// Used by the pin-detail modal in trending.html. Ordered ascending so charts
// render naturally left-to-right.
//
// Auth: admin. Rate-limited because this is an unbounded read by pin_id.

import { requireAdmin, supabase, jsonError, checkRateLimit } from "./_lib/auth.js";

const PIN_ID_REGEX = /^[0-9]{6,20}$/;

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const rl = await checkRateLimit(auth, "snapshots", { perMinute: 120 });
  if (!rl.allowed) return jsonError(res, 429, "rate_limited", { retry_after: 60 });

  const pinId = (req.query.pin_id || "").toString().trim();
  if (!PIN_ID_REGEX.test(pinId)) return jsonError(res, 400, "invalid_pin_id");

  try {
    const sb = supabase();

    // Fetch the pin's identity row (title/description/link/etc.) and the snapshot
    // timeline in parallel — both are server-side; Vercel function latency wins.
    const [pinRes, timelineRes] = await Promise.all([
      sb.from("pins")
        .select("pin_id, image_url, is_video, pin_created_at, observation_count, first_seen, last_seen, title, description, link, domain, dominant_color, alt_text, board_name, pinner_username")
        .eq("pin_id", pinId)
        .maybeSingle(),
      sb.rpc("pin_snapshot_timeline", { p_pin_id: pinId }),
    ]);

    if (pinRes.error) {
      console.error("snapshots: pins fetch error:", pinRes.error.message);
      return jsonError(res, 500, "db_error");
    }
    if (timelineRes.error) {
      console.error("snapshots: timeline rpc error:", timelineRes.error.message);
      return jsonError(res, 500, "db_error");
    }
    if (!pinRes.data) return jsonError(res, 404, "pin_not_found");

    const snapshots = timelineRes.data || [];

    res.setHeader("cache-control", "no-store");
    return res.status(200).json({
      pin: pinRes.data,
      snapshots,
      snapshot_count: snapshots.length,
      reach: new Set(snapshots.map((s) => s.install_id_short)).size,
    });
  } catch (err) {
    console.error("snapshots handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
