// GET /api/insights
//
// Returns three insight blocks computed over the selected window:
//   - cross_niche:  niche pairs that share pins (co-occurrence)
//   - momentum:     niches whose unique-pin count is growing week-over-week
//   - velocity:     niches with highest avg saves per pin (demand / saturation)
//
// Query params:
//   days — window for velocity & base aggregations (default 30, max 90)
//
// Auth: signed-in Clerk user required.

import { requireAuth, supabase, jsonError } from "./_lib/auth.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const CROSS_LIMIT = 30;
const MOMENTUM_LIMIT = 30;
const VELOCITY_LIMIT = 30;
const CROSS_MIN_SHARED = 2;
const CROSS_MAX_NICHES = 80; // cap term-pair combinatorics

function normTerm(s) {
  return (s || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "GET") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const days = Math.min(MAX_DAYS, Math.max(7, Number(req.query.days) || DEFAULT_DAYS));
  const nowMs = Date.now();
  const since = new Date(nowMs - days * 86400 * 1000).toISOString();
  const thisWeekStart = new Date(nowMs - 7 * 86400 * 1000).toISOString();
  const prevWeekStart = new Date(nowMs - 14 * 86400 * 1000).toISOString();

  try {
    const sb = supabase();
    const { data: snaps, error } = await sb
      .from("pin_snapshots")
      .select("pin_id, search_terms, saves, seen_at")
      .gte("seen_at", since)
      .not("search_terms", "is", null)
      .limit(50000);

    if (error) {
      console.error("insights query error:", error);
      return jsonError(res, 500, "db_error");
    }

    // Per-niche aggregates for velocity + unique-pin map for cross-niche
    const nicheMap = new Map(); // term -> { pins: Set, saveTotal, saveCount, maxSaves }
    // Per-pin -> niches seen (for cross-niche overlap)
    const pinToNiches = new Map(); // pin_id -> Set<term>
    // Weekly counts for momentum
    const weeklyCounts = new Map(); // term -> { thisWeek: Set<pin_id>, prevWeek: Set<pin_id> }

    for (const row of snaps || []) {
      const term = normTerm(row.search_terms);
      if (!term) continue;

      let n = nicheMap.get(term);
      if (!n) {
        n = { pins: new Set(), saveTotal: 0, saveCount: 0, maxSaves: 0 };
        nicheMap.set(term, n);
      }
      n.pins.add(row.pin_id);
      if (typeof row.saves === "number") {
        n.saveTotal += row.saves;
        n.saveCount += 1;
        if (row.saves > n.maxSaves) n.maxSaves = row.saves;
      }

      let pn = pinToNiches.get(row.pin_id);
      if (!pn) {
        pn = new Set();
        pinToNiches.set(row.pin_id, pn);
      }
      pn.add(term);

      let wc = weeklyCounts.get(term);
      if (!wc) {
        wc = { thisWeek: new Set(), prevWeek: new Set() };
        weeklyCounts.set(term, wc);
      }
      if (row.seen_at >= thisWeekStart) wc.thisWeek.add(row.pin_id);
      else if (row.seen_at >= prevWeekStart) wc.prevWeek.add(row.pin_id);
    }

    // ---- Velocity: top niches by avg saves ----
    const velocity = Array.from(nicheMap.entries())
      .filter(([, v]) => v.saveCount >= 3 && v.pins.size >= 3)
      .map(([term, v]) => ({
        term,
        unique_pins: v.pins.size,
        avg_saves: Math.round(v.saveTotal / v.saveCount),
        max_saves: v.maxSaves,
      }))
      .sort((a, b) => b.avg_saves - a.avg_saves)
      .slice(0, VELOCITY_LIMIT);

    // ---- Momentum: week-over-week unique pin growth ----
    const momentum = Array.from(weeklyCounts.entries())
      .map(([term, v]) => {
        const tw = v.thisWeek.size;
        const pw = v.prevWeek.size;
        // Laplace-smoothed growth ratio so brand-new niches still rank
        const ratio = (tw + 1) / (pw + 1);
        return {
          term,
          pins_this_week: tw,
          pins_prev_week: pw,
          growth_ratio: Math.round(ratio * 100) / 100,
        };
      })
      .filter((r) => r.pins_this_week >= 3) // require at least some signal this week
      .sort((a, b) => b.growth_ratio - a.growth_ratio || b.pins_this_week - a.pins_this_week)
      .slice(0, MOMENTUM_LIMIT);

    // ---- Cross-niche: term pairs sharing pins ----
    // Limit to top N niches (by unique pins) before computing pairs to bound O(n^2).
    const topNiches = Array.from(nicheMap.entries())
      .sort((a, b) => b[1].pins.size - a[1].pins.size)
      .slice(0, CROSS_MAX_NICHES)
      .map(([term]) => term);
    const topNichesSet = new Set(topNiches);

    const pairCounts = new Map(); // "a\x00b" -> shared pin count
    for (const niches of pinToNiches.values()) {
      const filtered = Array.from(niches).filter((n) => topNichesSet.has(n));
      if (filtered.length < 2) continue;
      filtered.sort();
      for (let i = 0; i < filtered.length; i++) {
        for (let j = i + 1; j < filtered.length; j++) {
          const key = filtered[i] + "\x00" + filtered[j];
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
    }

    const cross_niche = Array.from(pairCounts.entries())
      .filter(([, n]) => n >= CROSS_MIN_SHARED)
      .map(([key, n]) => {
        const [a, b] = key.split("\x00");
        return { term_a: a, term_b: b, shared_pins: n };
      })
      .sort((a, b) => b.shared_pins - a.shared_pins)
      .slice(0, CROSS_LIMIT);

    res.setHeader("cache-control", "private, max-age=120");
    return res.status(200).json({
      window_days: days,
      cross_niche,
      momentum,
      velocity,
    });
  } catch (err) {
    console.error("insights handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
