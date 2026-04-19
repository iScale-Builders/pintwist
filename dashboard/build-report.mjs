#!/usr/bin/env node
// Pintwist ops dashboard — generates a static HTML report from Supabase.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node build-report.mjs
//   (or put the vars in dashboard/.env)
//
// Output: dashboard/report.html (open in any browser).

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env if present
const envPath = resolve(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See dashboard/README.md.");
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

function fmtNum(n) {
  if (n === null || n === undefined) return "-";
  n = Number(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function runRaw(sql) {
  // supabase-js can't run arbitrary SQL without a Postgres function.
  // Use the pg-meta REST endpoint via PostgREST's `rpc` fallback isn't available for raw.
  // Simpler path: use the supabase-js query builder where possible; fall back to small SELECT via .rpc
  throw new Error("runRaw not used — using query builder instead");
}

async function fetchNow() {
  // Last 24h summary
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: snap24h } = await supabase
    .from("pin_snapshots")
    .select("*", { count: "exact", head: true })
    .gte("seen_at", since);

  const { data: topPinsRaw } = await supabase
    .from("pin_snapshots")
    .select("pin_id, saves, comments, repins, source_url, seen_at")
    .gte("seen_at", since)
    .order("saves", { ascending: false })
    .limit(10);

  const { data: installsData } = await supabase
    .from("pin_snapshots")
    .select("install_id")
    .gte("seen_at", since);
  const uniqueInstalls = new Set((installsData || []).map((r) => r.install_id)).size;

  const { count: totalPins } = await supabase
    .from("pins")
    .select("*", { count: "exact", head: true });
  const { count: totalSnaps } = await supabase
    .from("pin_snapshots")
    .select("*", { count: "exact", head: true });

  return {
    snap24h: snap24h ?? 0,
    uniqueInstalls,
    totalPins: totalPins ?? 0,
    totalSnaps: totalSnaps ?? 0,
    topPins: topPinsRaw || [],
  };
}

async function fetchTrending() {
  // Top pins last 7d by cross-user reach + save count.
  // Fetch raw and aggregate client-side to avoid needing a pg function.
  const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { data } = await supabase
    .from("pin_snapshots")
    .select("pin_id, saves, install_id, source_url, seen_at")
    .gte("seen_at", since);

  const byPin = new Map();
  for (const row of data || []) {
    let agg = byPin.get(row.pin_id);
    if (!agg) {
      agg = { pin_id: row.pin_id, reach: new Set(), maxSaves: 0, obs: 0, latestSource: null };
      byPin.set(row.pin_id, agg);
    }
    agg.reach.add(row.install_id);
    if ((row.saves || 0) > agg.maxSaves) agg.maxSaves = row.saves;
    agg.obs += 1;
    if (!agg.latestSource && row.source_url) agg.latestSource = row.source_url;
  }

  const ranked = [...byPin.values()]
    .map((a) => ({
      pin_id: a.pin_id,
      reach: a.reach.size,
      maxSaves: a.maxSaves,
      obs: a.obs,
      latestSource: a.latestSource,
    }))
    .sort((a, b) => b.reach - a.reach || b.maxSaves - a.maxSaves)
    .slice(0, 25);

  return ranked;
}

async function fetchNiches() {
  // Top search terms last 7d
  const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const { data } = await supabase
    .from("pin_snapshots")
    .select("search_terms, saves")
    .gte("seen_at", since)
    .not("search_terms", "is", null);

  const byTerm = new Map();
  for (const row of data || []) {
    const t = (row.search_terms || "").trim().toLowerCase();
    if (!t) continue;
    let agg = byTerm.get(t);
    if (!agg) {
      agg = { term: t, volume: 0, maxSaves: 0, saveTotal: 0 };
      byTerm.set(t, agg);
    }
    agg.volume += 1;
    agg.saveTotal += row.saves || 0;
    if ((row.saves || 0) > agg.maxSaves) agg.maxSaves = row.saves;
  }

  return [...byTerm.values()]
    .map((a) => ({ ...a, avgSaves: Math.round(a.saveTotal / a.volume) }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 25);
}

function pinLink(pinId) {
  return `https://www.pinterest.com/pin/${esc(pinId)}/`;
}

function renderHTML({ now, trending, niches, generatedAt }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pintwist Ops Report</title>
<style>
  :root { --border:#e0e0e0; --muted:#888; --accent:#F48FB1; }
  * { box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin:0; padding:32px; max-width:1200px; margin-left:auto; margin-right:auto; color:#222; }
  h1 { margin:0 0 4px; }
  .subtitle { color: var(--muted); margin-bottom: 32px; font-size: 13px; }
  h2 { margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--accent); }
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
  .stat { padding: 16px; border: 1px solid var(--border); border-radius: 6px; }
  .stat .n { font-size: 28px; font-weight: 700; }
  .stat .l { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { background: #fafafa; font-weight: 600; color: #555; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
  tr:hover td { background: #fafafa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  a { color: #444; text-decoration: none; }
  a:hover { text-decoration: underline; color: var(--accent); }
  .truncate { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: var(--muted); font-style: italic; padding: 12px; }
</style>
</head>
<body>
  <h1>Pintwist Ops Report</h1>
  <div class="subtitle">Generated ${esc(generatedAt)} · Service-role query, do not share publicly</div>

  <h2>Now &mdash; last 24 hours</h2>
  <div class="stat-grid">
    <div class="stat"><div class="n">${fmtNum(now.snap24h)}</div><div class="l">Snapshots</div></div>
    <div class="stat"><div class="n">${fmtNum(now.uniqueInstalls)}</div><div class="l">Unique installs</div></div>
    <div class="stat"><div class="n">${fmtNum(now.totalPins)}</div><div class="l">Total pins (all time)</div></div>
    <div class="stat"><div class="n">${fmtNum(now.totalSnaps)}</div><div class="l">Total snapshots</div></div>
  </div>
  <h3>Top 10 highest-save pins seen in last 24h</h3>
  ${
    now.topPins.length === 0
      ? '<div class="empty">No snapshots in the last 24 hours.</div>'
      : `<table>
    <thead><tr><th>Pin</th><th class="num">Saves</th><th class="num">Comments</th><th class="num">Repins</th><th>Source URL</th></tr></thead>
    <tbody>
      ${now.topPins
        .map(
          (p) => `<tr>
        <td><a href="${pinLink(p.pin_id)}" target="_blank">${esc(p.pin_id)}</a></td>
        <td class="num">${fmtNum(p.saves)}</td>
        <td class="num">${fmtNum(p.comments)}</td>
        <td class="num">${fmtNum(p.repins)}</td>
        <td class="truncate">${esc(p.source_url || "")}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`
  }

  <h2>Trending &mdash; last 7 days, by cross-user reach</h2>
  ${
    trending.length === 0
      ? '<div class="empty">No observations in the last 7 days.</div>'
      : `<table>
    <thead><tr><th>Pin</th><th class="num">Reach</th><th class="num">Max saves</th><th class="num">Observations</th><th>Latest source</th></tr></thead>
    <tbody>
      ${trending
        .map(
          (p) => `<tr>
        <td><a href="${pinLink(p.pin_id)}" target="_blank">${esc(p.pin_id)}</a></td>
        <td class="num">${fmtNum(p.reach)}</td>
        <td class="num">${fmtNum(p.maxSaves)}</td>
        <td class="num">${fmtNum(p.obs)}</td>
        <td class="truncate">${esc(p.latestSource || "")}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`
  }

  <h2>Niches &mdash; top search terms last 7 days</h2>
  ${
    niches.length === 0
      ? '<div class="empty">No search-based pins in the last 7 days.</div>'
      : `<table>
    <thead><tr><th>Search term</th><th class="num">Pin volume</th><th class="num">Max saves</th><th class="num">Avg saves</th></tr></thead>
    <tbody>
      ${niches
        .map(
          (n) => `<tr>
        <td>${esc(n.term)}</td>
        <td class="num">${fmtNum(n.volume)}</td>
        <td class="num">${fmtNum(n.maxSaves)}</td>
        <td class="num">${fmtNum(n.avgSaves)}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`
  }

  <div class="subtitle" style="margin-top:48px;">Pintwist dashboard &middot; regenerate with <code>node dashboard/build-report.mjs</code></div>
</body>
</html>
`;
}

console.log("Querying Supabase...");
const [now, trending, niches] = await Promise.all([fetchNow(), fetchTrending(), fetchNiches()]);
const html = renderHTML({
  now,
  trending,
  niches,
  generatedAt: new Date().toISOString(),
});
const outPath = resolve(__dirname, "report.html");
writeFileSync(outPath, html);
console.log(`Wrote ${outPath} (${html.length} bytes)`);
console.log(`Open it in your browser: file://${outPath.replace(/\\/g, "/")}`);
