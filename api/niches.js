// GET /api/niches
//
// Aggregates search_terms into niche stats for the selected window.
//
// Query params:
//   sort        — volume | saves | recency (default volume)
//   days        — lookback window in days (default 30, max 90)
//   min_volume  — minimum pin volume filter (default 1)
//   limit       — page size (default 60, max 200)
//   cursor      — opaque pagination cursor (term of last item)
//
// Returns { items: [...], next_cursor: string|null, window_days, sort }
//
// Auth: signed-in Clerk user required.

import { requireAuth, supabase, jsonError } from "./_lib/auth.js";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 60;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const SORT_OPTIONS = [
    "volume", "reach",
    "saves", "comments", "repins", "reactions", "shares",
    "avg_saves", "recency",
  ];
  const sort = SORT_OPTIONS.includes(req.query.sort) ? req.query.sort : "volume";
  const days = Math.min(MAX_DAYS, Math.max(1, Number(req.query.days) || DEFAULT_DAYS));
  const minVolume = Math.max(1, Number(req.query.min_volume) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));
  const cursor = (req.query.cursor || "").toString() || null;

  const since = new Date(Date.now() - days * 86400 * 1000).toISOString();

  try {
    const sb = supabase();
    const { data: snaps, error } = await sb
      .from("pin_snapshots")
      .select("pin_id, install_id, search_terms, saves, comments, repins, reactions, shares, seen_at")
      .gte("seen_at", since)
      .not("search_terms", "is", null)
      .limit(50000);

    if (error) {
      console.error("niches query error:", error);
      return jsonError(res, 500, "db_error");
    }

    // Aggregate by normalized search_terms
    const METRICS = ["saves", "comments", "repins", "reactions", "shares"];
    const byTerm = new Map();
    for (const row of snaps || []) {
      const term = (row.search_terms || "").trim().toLowerCase();
      if (!term) continue;
      let agg = byTerm.get(term);
      if (!agg) {
        agg = {
          term,
          volume: 0,
          unique_pins: new Set(),
          reach: new Set(),
          max_saves: 0, save_total: 0, save_count: 0,
          max_comments: 0, comment_total: 0, comment_count: 0,
          max_repins: 0, repin_total: 0, repin_count: 0,
          max_reactions: 0, reaction_total: 0, reaction_count: 0,
          max_shares: 0, share_total: 0, share_count: 0,
          latest_seen: null,
        };
        byTerm.set(term, agg);
      }
      agg.volume += 1;
      agg.unique_pins.add(row.pin_id);
      agg.reach.add(row.install_id);
      for (const m of METRICS) {
        const v = row[m];
        if (typeof v === "number") {
          const key = m === "saves" ? "save" : m === "comments" ? "comment" : m === "repins" ? "repin" : m === "reactions" ? "reaction" : "share";
          if (v > agg["max_" + m]) agg["max_" + m] = v;
          agg[key + "_total"] += v;
          agg[key + "_count"] += 1;
        }
      }
      if (!agg.latest_seen || row.seen_at > agg.latest_seen) agg.latest_seen = row.seen_at;
    }

    const avg = (total, count) => (count > 0 ? Math.round(total / count) : 0);
    let rows = Array.from(byTerm.values())
      .map((a) => ({
        term: a.term,
        volume: a.volume,
        unique_pins: a.unique_pins.size,
        reach: a.reach.size,
        max_saves: a.max_saves,
        avg_saves: avg(a.save_total, a.save_count),
        max_comments: a.max_comments,
        avg_comments: avg(a.comment_total, a.comment_count),
        max_repins: a.max_repins,
        avg_repins: avg(a.repin_total, a.repin_count),
        max_reactions: a.max_reactions,
        avg_reactions: avg(a.reaction_total, a.reaction_count),
        max_shares: a.max_shares,
        avg_shares: avg(a.share_total, a.share_count),
        latest_seen: a.latest_seen,
      }))
      .filter((r) => r.volume >= minVolume);

    const byField = (f) => (a, b) => (b[f] - a[f]) || (b.volume - a.volume) || a.term.localeCompare(b.term);
    const sorters = {
      volume:    (a, b) => b.volume - a.volume || b.max_saves - a.max_saves || a.term.localeCompare(b.term),
      reach:     byField("reach"),
      saves:     byField("max_saves"),
      comments:  byField("max_comments"),
      repins:    byField("max_repins"),
      reactions: byField("max_reactions"),
      shares:    byField("max_shares"),
      avg_saves: byField("avg_saves"),
      recency:   (a, b) => (b.latest_seen || "").localeCompare(a.latest_seen || "") || a.term.localeCompare(b.term),
    };
    rows.sort(sorters[sort]);

    if (cursor) {
      const idx = rows.findIndex((r) => r.term === cursor);
      if (idx >= 0) rows = rows.slice(idx + 1);
    }

    const page = rows.slice(0, limit);
    const next_cursor = page.length === limit && rows.length > limit ? page[page.length - 1].term : null;

    res.setHeader("cache-control", "private, max-age=60");
    return res.status(200).json({ items: page, next_cursor, window_days: days, sort });
  } catch (err) {
    console.error("niches handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
