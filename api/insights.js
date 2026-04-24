// GET /api/insights
// Thin wrapper around public.insights_agg() which returns {cross_niche, momentum, velocity}.

import { requireAdmin, supabase, jsonError, checkRateLimit } from "./_lib/auth.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const rl = await checkRateLimit(auth, "insights", { perMinute: 60 });
  if (!rl.allowed) return jsonError(res, 429, "rate_limited", { retry_after: 60 });

  const days = Math.min(MAX_DAYS, Math.max(7, Number(req.query.days) || DEFAULT_DAYS));

  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("insights_agg", { p_days: days });
    if (error) {
      console.error("insights_agg rpc error:", error);
      return jsonError(res, 500, "db_error");
    }

    // insights_agg returns a single jsonb object (not a row set).
    // supabase-js unpacks single scalar returns as `data` directly.
    const payload = data || {
      window_days: days,
      cross_niche: [],
      momentum: [],
      velocity: [],
    };

    res.setHeader("cache-control", "no-store");
    return res.status(200).json(payload);
  } catch (err) {
    console.error("insights handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
