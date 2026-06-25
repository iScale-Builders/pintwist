"use strict";
var PintwistCatalog = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // catalog-utils.js
  var catalog_utils_exports = {};
  __export(catalog_utils_exports, {
    CATALOG_IMPORTS_KEY: () => CATALOG_IMPORTS_KEY,
    CATALOG_STORAGE_KEY: () => CATALOG_STORAGE_KEY,
    METRIC_KEYS: () => METRIC_KEYS,
    PINTEREST_HOST_SUFFIXES: () => PINTEREST_HOST_SUFFIXES,
    buildHistory: () => buildHistory,
    catalogPinKey: () => catalogPinKey,
    catalogScanKey: () => catalogScanKey,
    catalogSummary: () => catalogSummary,
    createCatalogMerger: () => createCatalogMerger,
    formatCompactNumber: () => formatCompactNumber,
    groupByDesign: () => groupByDesign,
    isPinterestHost: () => isPinterestHost,
    isZeroSnapshot: () => isZeroSnapshot,
    mergeCatalogRows: () => mergeCatalogRows,
    normalizeCatalogName: () => normalizeCatalogName,
    normalizeCatalogRow: () => normalizeCatalogRow,
    normalizeCatalogText: () => normalizeCatalogText,
    parseCsvText: () => parseCsvText,
    sameMetrics: () => sameMetrics,
    snapshotOf: () => snapshotOf
  });
  var CATALOG_STORAGE_KEY = "pintwist_catalog_rows";
  var CATALOG_IMPORTS_KEY = "pintwist_catalog_imports";
  function parseCsvText(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      const next = source[i + 1];
      if (quoted) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (ch !== "\r") {
        cell += ch;
      }
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    const headers = (rows.shift() || []).map((header) => normalizeHeader(header));
    if (!headers.length) return [];
    return rows.filter((values) => values.some((value) => String(value || "").trim())).map((values) => {
      const record = {};
      headers.forEach((header, index) => {
        if (header) record[header] = values[index] || "";
      });
      return normalizeCatalogRow(record);
    }).filter(Boolean);
  }
  function normalizeCatalogRow(row) {
    if (!row || typeof row !== "object") return null;
    const pinId = clean(row.pin_id || row.pinId || row.id || extractPinId(row.pin_url || row.url));
    const pinUrl = clean(
      row.pin_url || row.pinUrl || (pinId ? `https://www.pinterest.com/pin/${pinId}/` : "")
    );
    const imageUrl = clean(row.image_url || row.imageUrl || row.image || row.thumbnail);
    if (!pinId && !pinUrl && !imageUrl) return null;
    const saves = toNumber(row.saves);
    const comments = toNumber(row.comments);
    const repins = toNumber(row.repins);
    const reactions = toNumber(row.reactions);
    const shares = toNumber(row.shares);
    const totalEngagement = saves + comments + repins + reactions + shares;
    return {
      search_term: clean(row.search_term || row.searchTerm || row.term),
      pin_id: pinId,
      pin_url: pinUrl,
      title: clean(row.title),
      description: clean(row.description),
      link: clean(row.link),
      domain: clean(row.domain),
      board_name: clean(row.board_name || row.boardName),
      pinner_username: clean(row.pinner_username || row.pinnerUsername),
      dominant_color: clean(row.dominant_color || row.dominantColor),
      alt_text: clean(row.alt_text || row.altText),
      saves,
      comments,
      repins,
      reactions,
      shares,
      total_engagement: totalEngagement,
      pin_created_at: clean(
        row.pin_created_at || row.last_activity || row.pinCreatedAt || row.createdAt
      ),
      image_url: imageUrl,
      is_video: parseBoolean(row.is_video || row.isVideo),
      scanned_at: clean(row.scanned_at || row.scannedAt) || (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  var METRIC_KEYS = ["saves", "comments", "repins", "reactions", "shares"];
  function snapshotOf(row) {
    const saves = toNumber(row.saves);
    const comments = toNumber(row.comments);
    const repins = toNumber(row.repins);
    const reactions = toNumber(row.reactions);
    const shares = toNumber(row.shares);
    return {
      scanned_at: clean(row.scanned_at) || clean(row.last_seen_at) || clean(row.first_seen_at) || "",
      saves,
      comments,
      repins,
      reactions,
      shares,
      total_engagement: saves + comments + repins + reactions + shares
    };
  }
  function sameMetrics(a, b) {
    return METRIC_KEYS.every((k) => toNumber(a[k]) === toNumber(b[k]));
  }
  function isZeroSnapshot(snap) {
    return METRIC_KEYS.every((k) => toNumber(snap[k]) === 0);
  }
  function buildHistory(observations) {
    const sorted = (observations || []).filter(Boolean).map((o, i) => ({ o, i })).sort(
      (x, y) => String(x.o.scanned_at || "").localeCompare(String(y.o.scanned_at || "")) || x.i - y.i
    ).map((w) => w.o);
    const hasReal = sorted.some((snap) => !isZeroSnapshot(snap));
    const history = [];
    for (const snap of sorted) {
      if (hasReal && isZeroSnapshot(snap)) continue;
      const prev = history[history.length - 1];
      if (prev && sameMetrics(prev, snap)) continue;
      history.push(snap);
    }
    if (!history.length && sorted.length) history.push(sorted[0]);
    return history;
  }
  function createCatalogMerger(opts) {
    const keyOf = opts && opts.keyFn || catalogPinKey;
    const maxObs = opts && opts.maxObservations || 0;
    const byKey = /* @__PURE__ */ new Map();
    const ingestOne = (raw) => {
      const normalized = normalizeCatalogRow(raw);
      if (!normalized) return;
      const key = keyOf(normalized) || normalized.pin_id || normalized.pin_url || normalized.image_url;
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = { meta: normalized, observations: [], seen: 0 };
        byKey.set(key, bucket);
      } else {
        bucket.meta = mergeRow(bucket.meta, normalized);
      }
      if (Array.isArray(raw && raw.history) && raw.history.length) {
        raw.history.forEach((h) => bucket.observations.push(snapshotOf(h)));
        bucket.seen += Number(raw.seen_count) || raw.history.length;
      } else {
        bucket.observations.push(snapshotOf(normalized));
        bucket.seen += 1;
      }
      if (maxObs && bucket.observations.length > maxObs * 2) {
        bucket.observations = buildHistory(bucket.observations).slice(-maxObs);
      }
    };
    return {
      ingest(rows) {
        (rows || []).forEach(ingestOne);
        return this;
      },
      size() {
        return byKey.size;
      },
      finalize() {
        return finalizeBuckets(byKey, maxObs);
      }
    };
  }
  function finalizeBuckets(byKey, maxObs) {
    const out = Array.from(byKey.values()).map((bucket) => {
      let history = buildHistory(bucket.observations);
      if (maxObs && history.length > maxObs) history = history.slice(-maxObs);
      const latest = history[history.length - 1] || snapshotOf(bucket.meta);
      const stamps = bucket.observations.map((o) => o.scanned_at).filter(Boolean).sort();
      return {
        ...bucket.meta,
        saves: latest.saves,
        comments: latest.comments,
        repins: latest.repins,
        reactions: latest.reactions,
        shares: latest.shares,
        total_engagement: latest.total_engagement,
        history,
        first_seen_at: stamps[0] || bucket.meta.scanned_at || "",
        last_seen_at: stamps[stamps.length - 1] || bucket.meta.scanned_at || "",
        last_changed_at: (history[history.length - 1] || {}).scanned_at || "",
        seen_count: bucket.seen || bucket.observations.length,
        scanned_at: latest.scanned_at || bucket.meta.scanned_at || ""
      };
    });
    return out.sort((a, b) => b.total_engagement - a.total_engagement);
  }
  function mergeCatalogRows(existingRows, incomingRows, opts) {
    return createCatalogMerger(opts).ingest(existingRows).ingest(incomingRows).finalize();
  }
  function catalogSummary(rows) {
    const safeRows = rows || [];
    const terms = /* @__PURE__ */ new Set();
    let saves = 0;
    let repins = 0;
    let comments = 0;
    let reactions = 0;
    let shares = 0;
    let engagement = 0;
    safeRows.forEach((row) => {
      if (row.search_term) terms.add(row.search_term);
      saves += toNumber(row.saves);
      repins += toNumber(row.repins);
      comments += toNumber(row.comments);
      reactions += toNumber(row.reactions);
      shares += toNumber(row.shares);
      engagement += toNumber(row.total_engagement);
    });
    return {
      pins: safeRows.length,
      terms: terms.size,
      saves,
      repins,
      comments,
      reactions,
      shares,
      engagement
    };
  }
  function formatCompactNumber(value) {
    const num = toNumber(value);
    if (num >= 1e6) return trimFixed(num / 1e6) + "M";
    if (num >= 1e3) return trimFixed(num / 1e3) + "K";
    return String(num);
  }
  function normalizeHeader(header) {
    return String(header || "").trim().replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }
  function clean(value) {
    return String(value || "").trim();
  }
  function toNumber(value) {
    const raw = String(value ?? "").trim().toUpperCase().replace(/,/g, "");
    if (!raw) return 0;
    const multiplier = raw.endsWith("M") ? 1e6 : raw.endsWith("K") ? 1e3 : 1;
    const parsed = Number.parseFloat(raw.replace(/[KM]$/, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : 0;
  }
  function parseBoolean(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    return raw === "true" || raw === "1" || raw === "yes";
  }
  function extractPinId(url) {
    const match = String(url || "").match(/\/pin\/(\d+)/);
    return match ? match[1] : "";
  }
  function normalizeCatalogName(title) {
    const n = String(title || "").toLowerCase().replace(/\s*\|\s*(color|size|style|fit|colour)\s*:[^|]*/gi, "").replace(/[^a-z0-9]+/g, " ").trim();
    return n.length >= 4 ? n : "";
  }
  function normalizeCatalogText(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function stableNumericId(row) {
    const id = String(row && (row.pin_id || row.pinId || row.id) || "").trim();
    if (/^\d+$/.test(id)) return id;
    const m = String(row && (row.pin_url || row.pinUrl || row.url || row.source_url) || "").match(
      /\/pin\/(\d+)/
    );
    return m ? m[1] : "";
  }
  function imageFileKey(row) {
    const img = String(
      row && (row.image_url || row.imageUrl || row.image || row.display_image_url || row.thumbnail) || ""
    );
    const file = img.split("?")[0].split("#")[0].split("/").filter(Boolean).pop();
    return file ? file.toLowerCase() : "";
  }
  function catalogPinKey(row) {
    if (!row) return "";
    const name = normalizeCatalogName(row.title || row.name);
    if (name) return "name:" + name + "|desc:" + normalizeCatalogText(row.description);
    const numeric = stableNumericId(row);
    if (numeric) return "pin:" + numeric;
    const img = imageFileKey(row);
    if (img) return "img:" + img;
    const id = String(row.pin_id || row.pinId || row.id || "").trim();
    return id ? "pin:" + id : "";
  }
  function catalogScanKey(row) {
    if (!row) return "";
    const numeric = stableNumericId(row);
    if (numeric) return "pin:" + numeric;
    return catalogPinKey(row);
  }
  function groupByDesign(rows) {
    const byKey = /* @__PURE__ */ new Map();
    (rows || []).forEach((row) => {
      if (!row) return;
      const key = catalogPinKey(row) || row.pin_id || row.pin_url || row.image_url;
      if (!key) return;
      let g = byKey.get(key);
      if (!g) {
        g = { best: row, copies: 0, totalSaves: 0, totalEngagement: 0 };
        byKey.set(key, g);
      }
      g.copies += 1;
      g.totalSaves += toNumber(row.saves);
      g.totalEngagement += toNumber(row.total_engagement);
      if (toNumber(row.total_engagement) > toNumber(g.best.total_engagement)) g.best = row;
    });
    return Array.from(byKey.values()).map((g) => ({
      ...g.best,
      design_copies: g.copies,
      design_total_saves: g.totalSaves,
      design_total_engagement: g.totalEngagement
    }));
  }
  var PINTEREST_HOST_SUFFIXES = [
    "pinterest.com",
    "pinterest.at",
    "pinterest.ca",
    "pinterest.ch",
    "pinterest.cl",
    "pinterest.co.in",
    "pinterest.co.kr",
    "pinterest.co.nz",
    "pinterest.co.uk",
    "pinterest.com.au",
    "pinterest.com.mx",
    "pinterest.cz",
    "pinterest.de",
    "pinterest.dk",
    "pinterest.es",
    "pinterest.fi",
    "pinterest.fr",
    "pinterest.ie",
    "pinterest.it",
    "pinterest.jp",
    "pinterest.nl",
    "pinterest.nz",
    "pinterest.ph",
    "pinterest.pt",
    "pinterest.ru",
    "pinterest.se"
  ];
  function isPinterestHost(hostname) {
    const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
    return PINTEREST_HOST_SUFFIXES.some((sfx) => h === sfx || h.endsWith("." + sfx));
  }
  function mergeRow(prev, next) {
    return {
      ...prev,
      ...next,
      title: next.title || prev.title,
      description: next.description || prev.description,
      image_url: next.image_url || prev.image_url,
      pin_created_at: next.pin_created_at || prev.pin_created_at,
      scanned_at: next.scanned_at || prev.scanned_at,
      total_engagement: toNumber(next.total_engagement)
    };
  }
  function trimFixed(value) {
    const fixed = value.toFixed(1);
    return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
  }
  return __toCommonJS(catalog_utils_exports);
})();
