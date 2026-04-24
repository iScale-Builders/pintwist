// GET /api/trending
//
// Thin wrapper around public.trending_agg() Postgres function.
// All aggregation, filtering, sorting, pagination happens server-side in SQL
// so this scales to millions of snapshots without Node memory pressure.

import { requireAdmin, supabase, jsonError, checkRateLimit } from "./_lib/auth.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 40;
const CSV_MAX_ROWS = 5000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
const SORT_OPTIONS = ["reach", "saves", "comments", "repins", "reactions", "shares", "velocity", "newest"];

function toCsvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCsv(rows) {
  const headers = [
    "pin_id", "reach", "obs",
    "max_saves", "max_comments", "max_repins", "max_reactions", "max_shares",
    "velocity", "pin_url", "latest_search_terms", "latest_source",
    "latest_seen", "pin_created_at", "image_url", "is_video",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.pin_id, r.reach, r.obs,
      r.max_saves, r.max_comments, r.max_repins, r.max_reactions, r.max_shares,
      r.velocity,
      `https://www.pinterest.com/pin/${r.pin_id}/`,
      r.latest_search_terms, r.latest_source,
      r.latest_seen, r.pin_created_at, r.image_url, r.is_video,
    ].map(toCsvCell).join(","));
  }
  return lines.join("\r\n");
}

function parseInt0(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function parseIso(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const rl = await checkRateLimit(auth, "trending", { perMinute: 120 });
  if (!rl.allowed) return jsonError(res, 429, "rate_limited", { retry_after: 60 });

  const format = (req.query.format || "json").toString().toLowerCase();
  const isCsv = format === "csv";

  const q = (req.query.q || "").toString().trim().toLowerCase();
  const sort = SORT_OPTIONS.includes(req.query.sort) ? req.query.sort : "reach";
  const days = Math.min(MAX_DAYS, Math.max(1, Number(req.query.days) || DEFAULT_DAYS));
  const requestedLimit = Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT);
  const limit = isCsv ? Math.min(CSV_MAX_ROWS, requestedLimit) : Math.min(MAX_LIMIT, requestedLimit);

  // Cursor in this API is an offset integer. Client starts at 0, sends back
  // whatever next_cursor the previous response returned.
  const offset = isCsv ? 0 : Math.max(0, Number(req.query.cursor) || 0);

  const params = {
    p_days: days,
    p_q: q,
    p_sort: sort,
    p_min_saves: parseInt0(req.query.min_saves),
    p_max_saves: parseInt0(req.query.max_saves),
    p_min_comments: parseInt0(req.query.min_comments),
    p_max_comments: parseInt0(req.query.max_comments),
    p_min_repins: parseInt0(req.query.min_repins),
    p_max_repins: parseInt0(req.query.max_repins),
    p_min_reactions: parseInt0(req.query.min_reactions),
    p_max_reactions: parseInt0(req.query.max_reactions),
    p_min_shares: parseInt0(req.query.min_shares),
    p_max_shares: parseInt0(req.query.max_shares),
    p_min_pin_created: parseIso(req.query.min_pin_created),
    p_max_pin_created: parseIso(req.query.max_pin_created),
    p_limit: limit,
    p_offset: offset,
  };

  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("trending_agg", params);
    if (error) {
      console.error("trending_agg rpc error:", error);
      return jsonError(res, 500, "db_error");
    }

    const rows = data || [];

    if (isCsv) {
      const csv = rowsToCsv(rows);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `pintwist-trending-${sort}-${days}d-${stamp}.csv`;
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    }
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    const items = rows.map((r) => ({
      pin_id: r.pin_id,
      reach: r.reach,
      obs: r.obs,
      max_saves: r.max_saves,
      max_comments: r.max_comments,
      max_repins: r.max_repins,
      max_reactions: r.max_reactions,
      max_shares: r.max_shares,
      velocity: r.velocity,
      latest_source: r.latest_source,
      latest_search_terms: r.latest_search_terms,
      latest_seen: r.latest_seen,
      image_url: r.image_url,
      is_video: r.is_video,
      pin_created_at: r.pin_created_at,
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
    console.error("trending handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
