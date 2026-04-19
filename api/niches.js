// GET /api/niches
// Thin wrapper around public.niches_agg() Postgres function.

import { requireAdmin, supabase, jsonError } from "./_lib/auth.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 60;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const SORT_OPTIONS = ["volume", "reach", "saves", "comments", "repins", "reactions", "shares", "avg_saves", "recency"];

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const sort = SORT_OPTIONS.includes(req.query.sort) ? req.query.sort : "volume";
  const days = Math.min(MAX_DAYS, Math.max(1, Number(req.query.days) || DEFAULT_DAYS));
  const minVolume = Math.max(1, Number(req.query.min_volume) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(req.query.cursor) || 0);

  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("niches_agg", {
      p_days: days,
      p_sort: sort,
      p_min_volume: minVolume,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) {
      console.error("niches_agg rpc error:", error);
      return jsonError(res, 500, "db_error");
    }

    const rows = data || [];
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const items = rows.map((r) => ({
      term: r.term,
      volume: r.volume,
      unique_pins: r.unique_pins,
      reach: r.reach,
      max_saves: r.max_saves,
      avg_saves: r.avg_saves,
      max_comments: r.max_comments,
      avg_comments: r.avg_comments,
      max_repins: r.max_repins,
      avg_repins: r.avg_repins,
      max_reactions: r.max_reactions,
      avg_reactions: r.avg_reactions,
      max_shares: r.max_shares,
      avg_shares: r.avg_shares,
      latest_seen: r.latest_seen,
    }));

    const nextOffset = offset + items.length;
    const next_cursor = nextOffset < total ? String(nextOffset) : null;

    res.setHeader("cache-control", "no-store");
    return res.status(200).json({
      items,
      next_cursor,
      total,
      window_days: days,
      sort,
    });
  } catch (err) {
    console.error("niches handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
