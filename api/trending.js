// GET /api/trending
//
// Query params:
//   q           — search string (matches source_url, search_terms, pin_id)
//   sort        — reach | saves | velocity | newest
//   days        — lookback window in days (default 7, max 30)
//   min_saves   — minimum max-saves filter
//   limit       — page size (default 40, max 100)
//   cursor      — opaque pagination cursor (pin_id of last item)
//
// Returns { items: [...], next_cursor: string|null }
//
// Auth: signed-in Clerk user required.

import { requireAuth, supabase, jsonError } from "./_lib/auth.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 40;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return jsonError(res, 405, "method_not_allowed");
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  const q = (req.query.q || "").toString().trim().toLowerCase();
  const SORT_OPTIONS = [
    "reach", "saves", "comments", "repins", "reactions", "shares",
    "velocity", "newest",
  ];
  const sort = SORT_OPTIONS.includes(req.query.sort) ? req.query.sort : "reach";
  const days = Math.min(MAX_DAYS, Math.max(1, Number(req.query.days) || DEFAULT_DAYS));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
  const cursor = (req.query.cursor || "").toString() || null;

  // Min/max range filters on each metric. Undefined/blank means "no bound".
  const parseNum = (v) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const ranges = {
    saves:     [parseNum(req.query.min_saves),     parseNum(req.query.max_saves)],
    comments:  [parseNum(req.query.min_comments),  parseNum(req.query.max_comments)],
    repins:    [parseNum(req.query.min_repins),    parseNum(req.query.max_repins)],
    reactions: [parseNum(req.query.min_reactions), parseNum(req.query.max_reactions)],
    shares:    [parseNum(req.query.min_shares),    parseNum(req.query.max_shares)],
  };

  // Pin creation date range (ISO date string, e.g. "2026-03-01").
  const parseDateMs = (v) => {
    if (!v) return null;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  };
  const minCreatedMs = parseDateMs(req.query.min_pin_created);
  const maxCreatedMs = parseDateMs(req.query.max_pin_created);

  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();

  try {
    // Pull raw observations for the window. At current scale this is acceptable;
    // once pin_snapshots exceeds a few million rows, migrate this to a SECURITY DEFINER
    // rollup function that returns aggregated rows directly.
    const sb = supabase();

    let snapQuery = sb
      .from("pin_snapshots")
      .select("pin_id, saves, comments, repins, reactions, shares, install_id, source_url, search_terms, seen_at")
      .gte("seen_at", since);

    if (q) {
      // PostgREST `or` filter: pin_id ILIKE %q% OR search_terms ILIKE %q% OR source_url ILIKE %q%
      const likeQ = q.replace(/[%_]/g, "\\$&");
      snapQuery = snapQuery.or(
        [
          `pin_id.ilike.%${likeQ}%`,
          `search_terms.ilike.%${likeQ}%`,
          `source_url.ilike.%${likeQ}%`,
        ].join(",")
      );
    }

    // Cap raw pulled rows for safety. At current scale we'd pull all.
    // Increase this cap if queries go deeper.
    snapQuery = snapQuery.limit(20000);

    const { data: snaps, error: snapErr } = await snapQuery;
    if (snapErr) {
      console.error("pin_snapshots query error:", snapErr);
      return jsonError(res, 500, "db_error", { stage: "snapshots" });
    }

    // Aggregate client-side
    const byPin = new Map();
    for (const row of snaps || []) {
      let agg = byPin.get(row.pin_id);
      if (!agg) {
        agg = {
          pin_id: row.pin_id,
          reach: new Set(),
          obs: 0,
          max_saves: 0,
          max_comments: 0,
          max_repins: 0,
          max_reactions: 0,
          max_shares: 0,
          total_saves: 0,
          latest_source: null,
          latest_search_terms: null,
          latest_seen: null,
        };
        byPin.set(row.pin_id, agg);
      }
      agg.reach.add(row.install_id);
      agg.obs += 1;
      if ((row.saves || 0) > agg.max_saves) agg.max_saves = row.saves || 0;
      if ((row.comments || 0) > agg.max_comments) agg.max_comments = row.comments || 0;
      if ((row.repins || 0) > agg.max_repins) agg.max_repins = row.repins || 0;
      if ((row.reactions || 0) > agg.max_reactions) agg.max_reactions = row.reactions || 0;
      if ((row.shares || 0) > agg.max_shares) agg.max_shares = row.shares || 0;
      agg.total_saves += row.saves || 0;
      if (!agg.latest_seen || row.seen_at > agg.latest_seen) {
        agg.latest_seen = row.seen_at;
        if (row.source_url) agg.latest_source = row.source_url;
        if (row.search_terms) agg.latest_search_terms = row.search_terms;
      }
    }

    const passes = (val, [mn, mx]) =>
      (mn === null || val >= mn) && (mx === null || val <= mx);

    let rows = Array.from(byPin.values())
      .map((a) => ({
        pin_id: a.pin_id,
        reach: a.reach.size,
        obs: a.obs,
        max_saves: a.max_saves,
        max_comments: a.max_comments,
        max_repins: a.max_repins,
        max_reactions: a.max_reactions,
        max_shares: a.max_shares,
        velocity: a.reach.size > 0 ? Math.round(a.total_saves / a.reach.size) : 0,
        latest_source: a.latest_source,
        latest_search_terms: a.latest_search_terms,
        latest_seen: a.latest_seen,
      }))
      .filter((r) =>
        passes(r.max_saves, ranges.saves) &&
        passes(r.max_comments, ranges.comments) &&
        passes(r.max_repins, ranges.repins) &&
        passes(r.max_reactions, ranges.reactions) &&
        passes(r.max_shares, ranges.shares)
      );

    // Sort. Every metric falls back to reach, then pin_id for stable ordering.
    const byMetric = (field) => (a, b) =>
      (b[field] - a[field]) || (b.reach - a.reach) || a.pin_id.localeCompare(b.pin_id);
    const sorters = {
      reach:     (a, b) => b.reach - a.reach || b.max_saves - a.max_saves || a.pin_id.localeCompare(b.pin_id),
      saves:     byMetric("max_saves"),
      comments:  byMetric("max_comments"),
      repins:    byMetric("max_repins"),
      reactions: byMetric("max_reactions"),
      shares:    byMetric("max_shares"),
      velocity:  byMetric("velocity"),
      newest:    (a, b) => (b.latest_seen || "").localeCompare(a.latest_seen || "") || a.pin_id.localeCompare(b.pin_id),
    };
    rows.sort(sorters[sort]);

    // Cursor pagination (opaque, pin_id of last shown item)
    if (cursor) {
      const idx = rows.findIndex((r) => r.pin_id === cursor);
      if (idx >= 0) rows = rows.slice(idx + 1);
    }

    // Apply pin_created_at range by fetching metadata BEFORE paginating.
    // When a date filter is active, fetch metadata for the top few hundred
    // candidates, filter, then slice. Otherwise enrich only the page.
    const dateFilterActive = minCreatedMs !== null || maxCreatedMs !== null;

    if (dateFilterActive) {
      // Fetch metadata for up to 1000 top candidates, filter in place.
      const candidates = rows.slice(0, Math.min(1000, rows.length));
      const { data: pinRows } = await sb
        .from("pins")
        .select("pin_id, image_url, is_video, pin_created_at")
        .in("pin_id", candidates.map((p) => p.pin_id));
      const meta = new Map();
      for (const p of pinRows || []) meta.set(p.pin_id, p);
      rows = candidates
        .map((r) => {
          const m = meta.get(r.pin_id);
          if (m) {
            r.image_url = m.image_url;
            r.is_video = m.is_video;
            r.pin_created_at = m.pin_created_at;
          }
          return r;
        })
        .filter((r) => {
          if (!r.pin_created_at) return false; // no date = excluded when date filter on
          const t = Date.parse(r.pin_created_at);
          if (!Number.isFinite(t)) return false;
          if (minCreatedMs !== null && t < minCreatedMs) return false;
          if (maxCreatedMs !== null && t > maxCreatedMs) return false;
          return true;
        });
    }

    const page = rows.slice(0, limit);
    const next_cursor = page.length === limit && rows.length > limit ? page[page.length - 1].pin_id : null;

    // Enrich page with image_url from pins table (if not already enriched via date-filter path).
    if (page.length > 0 && !dateFilterActive) {
      const pinIds = page.map((p) => p.pin_id);
      const { data: pinRows } = await sb.from("pins").select("pin_id, image_url, is_video, pin_created_at").in("pin_id", pinIds);
      const meta = new Map();
      for (const p of pinRows || []) meta.set(p.pin_id, p);
      for (const p of page) {
        const m = meta.get(p.pin_id);
        if (m) {
          p.image_url = m.image_url;
          p.is_video = m.is_video;
          p.pin_created_at = m.pin_created_at;
        }
      }
    }

    res.setHeader("cache-control", "private, max-age=30");
    return res.status(200).json({ items: page, next_cursor, window_days: days, sort });
  } catch (err) {
    console.error("trending handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
