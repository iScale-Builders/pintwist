export const CATALOG_STORAGE_KEY = 'pintwist_catalog_rows';
// CSV imports live here, independent of the scan-accumulation store above, so they
// never affect the bar's "N saved (manual scans)" count. The catalog page displays
// the union of the two; only this key is written by imports/clear on the catalog page.
export const CATALOG_IMPORTS_KEY = 'pintwist_catalog_imports';

export function parseCsvText(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
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
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = (rows.shift() || []).map((header) => normalizeHeader(header));
  if (!headers.length) return [];

  return rows
    .filter((values) => values.some((value) => String(value || '').trim()))
    .map((values) => {
      const record = {};
      headers.forEach((header, index) => {
        if (header) record[header] = values[index] || '';
      });
      return normalizeCatalogRow(record);
    })
    .filter(Boolean);
}

export function normalizeCatalogRow(row) {
  if (!row || typeof row !== 'object') return null;
  const pinId = clean(row.pin_id || row.pinId || row.id || extractPinId(row.pin_url || row.url));
  const pinUrl = clean(
    row.pin_url || row.pinUrl || (pinId ? `https://www.pinterest.com/pin/${pinId}/` : '')
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
    scanned_at: clean(row.scanned_at || row.scannedAt) || new Date().toISOString(),
  };
}

export const METRIC_KEYS = ['saves', 'comments', 'repins', 'reactions', 'shares'];

// A single observation of a pin's metrics at one point in time.
export function snapshotOf(row) {
  const saves = toNumber(row.saves);
  const comments = toNumber(row.comments);
  const repins = toNumber(row.repins);
  const reactions = toNumber(row.reactions);
  const shares = toNumber(row.shares);
  return {
    scanned_at: clean(row.scanned_at) || clean(row.last_seen_at) || clean(row.first_seen_at) || '',
    saves,
    comments,
    repins,
    reactions,
    shares,
    total_engagement: saves + comments + repins + reactions + shares,
  };
}

export function sameMetrics(a, b) {
  return METRIC_KEYS.every((k) => toNumber(a[k]) === toNumber(b[k]));
}

// An all-zero metric read is almost always a failed/partial scrape (the pin's
// data hadn't loaded), not a real metric state. A pin that ever showed real
// engagement never genuinely drops back to all-zeros, so such reads are noise.
export function isZeroSnapshot(snap) {
  return METRIC_KEYS.every((k) => toNumber(snap[k]) === 0);
}

// Turn a list of raw observations into a chronological, deduped history: a new
// entry is only kept when at least one metric changed vs the previous state
// (a "true rescrape"). Identical consecutive observations are collapsed, and
// all-zero reads are dropped once the pin has shown any non-zero engagement
// (those are failed scrapes, not real rescrapes — they were inflating history).
export function buildHistory(observations) {
  const sorted = (observations || [])
    .filter(Boolean)
    .map((o, i) => ({ o, i }))
    .sort(
      (x, y) =>
        String(x.o.scanned_at || '').localeCompare(String(y.o.scanned_at || '')) || x.i - y.i
    )
    .map((w) => w.o);
  const hasReal = sorted.some((snap) => !isZeroSnapshot(snap));
  const history = [];
  for (const snap of sorted) {
    if (hasReal && isZeroSnapshot(snap)) continue; // failed/partial read — not a rescrape
    const prev = history[history.length - 1];
    if (prev && sameMetrics(prev, snap)) continue; // not a true rescrape — nothing new
    history.push(snap);
  }
  if (!history.length && sorted.length) history.push(sorted[0]); // genuinely-zero pin keeps one entry
  return history;
}

// Dedupe pins by id and accumulate each pin's scrape history. The same pin
// appearing across multiple CSVs (different timestamps/metrics) becomes one pin
// with a cycle-able history; the top-level metrics reflect the latest snapshot.
// Streaming dedup/merge. Ingest rows in batches, then finalize once. This is the memory-
// efficient core: snapshots kept per pin are lean (metrics + timestamp), and a big import
// streams files through ONE merger instead of holding every raw row in memory.
//   opts.keyFn          — overrides the identity used for dedup. Imports use the default
//                         title+desc key (catalogPinKey) so Pinterest's duplicate-design
//                         pins (different IDs) merge; the scan store / catalog-page union
//                         pass catalogScanKey (stable NUMERIC pin id first, else the design
//                         identity) so the grid keeps the toolbar's scan-count identity AND
//                         volatile-token pins still collapse instead of splitting (audit H1).
//   opts.maxObservations — bounds per-pin history memory on very large imports. Once a
//                         bucket's raw observations exceed 2x the cap they're collapsed to
//                         deduped history and trimmed to the most recent N (plenty for the
//                         card's sparkline). 0/undefined = unbounded (default, unchanged).
export function createCatalogMerger(opts) {
  const keyOf = (opts && opts.keyFn) || catalogPinKey;
  const maxObs = (opts && opts.maxObservations) || 0;
  const byKey = new Map();
  const ingestOne = (raw) => {
    const normalized = normalizeCatalogRow(raw);
    if (!normalized) return;
    const key =
      keyOf(normalized) || normalized.pin_id || normalized.pin_url || normalized.image_url;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { meta: normalized, observations: [], seen: 0 };
      byKey.set(key, bucket);
    } else {
      bucket.meta = mergeRow(bucket.meta, normalized);
    }
    if (Array.isArray(raw && raw.history) && raw.history.length) {
      raw.history.forEach((h) => bucket.observations.push(snapshotOf(h)));
      // Carry the TRUE sighting count from an already-finalized row. Its history is the
      // collapsed (deduped) set, so counting history.length here would shrink seen_count
      // toward the history length on every re-merge — use the stored seen_count when present.
      bucket.seen += Number(raw.seen_count) || raw.history.length;
    } else {
      bucket.observations.push(snapshotOf(normalized));
      bucket.seen += 1;
    }
    if (maxObs && bucket.observations.length > maxObs * 2) {
      // Collapse to true rescrapes, then keep the most recent N — bounds memory without
      // losing the shape of the history (buildHistory drops no-change/failed reads).
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
    },
  };
}

function finalizeBuckets(byKey, maxObs) {
  const out = Array.from(byKey.values()).map((bucket) => {
    let history = buildHistory(bucket.observations);
    if (maxObs && history.length > maxObs) history = history.slice(-maxObs); // keep most recent N
    const latest = history[history.length - 1] || snapshotOf(bucket.meta);
    const stamps = bucket.observations
      .map((o) => o.scanned_at)
      .filter(Boolean)
      .sort();
    return {
      ...bucket.meta,
      saves: latest.saves,
      comments: latest.comments,
      repins: latest.repins,
      reactions: latest.reactions,
      shares: latest.shares,
      total_engagement: latest.total_engagement,
      history,
      first_seen_at: stamps[0] || bucket.meta.scanned_at || '',
      last_seen_at: stamps[stamps.length - 1] || bucket.meta.scanned_at || '',
      last_changed_at: (history[history.length - 1] || {}).scanned_at || '',
      seen_count: bucket.seen || bucket.observations.length,
      scanned_at: latest.scanned_at || bucket.meta.scanned_at || '',
    };
  });
  return out.sort((a, b) => b.total_engagement - a.total_engagement);
}

// Dedupe pins by identity and accumulate each pin's scrape history. Thin wrapper over
// createCatalogMerger so all dedup logic has a single source.
export function mergeCatalogRows(existingRows, incomingRows, opts) {
  return createCatalogMerger(opts).ingest(existingRows).ingest(incomingRows).finalize();
}

export function catalogSummary(rows) {
  const safeRows = rows || [];
  const terms = new Set();
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
    engagement,
  };
}

export function formatCompactNumber(value) {
  const num = toNumber(value);
  if (num >= 1000000) return trimFixed(num / 1000000) + 'M';
  if (num >= 1000) return trimFixed(num / 1000) + 'K';
  return String(num);
}

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function clean(value) {
  return String(value || '').trim();
}

function toNumber(value) {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/,/g, '');
  if (!raw) return 0;
  const multiplier = raw.endsWith('M') ? 1000000 : raw.endsWith('K') ? 1000 : 1;
  const parsed = Number.parseFloat(raw.replace(/[KM]$/, ''));
  return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : 0;
}

function parseBoolean(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function extractPinId(url) {
  const match = String(url || '').match(/\/pin\/(\d+)/);
  return match ? match[1] : '';
}

// Normalize a pin title/name so the same product collapses to one identity:
// lowercase, drop variant suffixes (| Color: Black | Size: L), strip punctuation,
// collapse whitespace. Returns "" when there's no usable name.
export function normalizeCatalogName(title) {
  const n = String(title || '')
    .toLowerCase()
    .replace(/\s*\|\s*(color|size|style|fit|colour)\s*:[^|]*/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return n.length >= 4 ? n : '';
}

// Free-text normalization for the description part of the identity (no length gate):
// lowercase, strip punctuation, collapse whitespace.
export function normalizeCatalogText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// A STABLE numeric Pinterest pin id, or '' when the row carries none. The pin_id field is
// normally the numeric id (rock-stable for the same pin), BUT some surfaced pins — ads /
// aggregated / "more ideas like this" — instead carry an ~88-char base64 token that CHANGES
// with the search context. Keying on that token splits ONE design into a separate card per
// keyword, so we trust pin_id only when it's all-digits, then recover the numeric id from the
// /pin/<id> URL. Anything else is treated as "no stable id" and handed to the design key.
function stableNumericId(row) {
  const id = String((row && (row.pin_id || row.pinId || row.id)) || '').trim();
  if (/^\d+$/.test(id)) return id;
  const m = String((row && (row.pin_url || row.pinUrl || row.url || row.source_url)) || '').match(
    /\/pin\/(\d+)/
  );
  return m ? m[1] : '';
}

// The image's content filename (the pinimg / Amazon hash), lowercased — a strong "same
// picture" signal that's stable across re-pins and size buckets. '' when there's no image.
function imageFileKey(row) {
  const img = String(
    (row &&
      (row.image_url || row.imageUrl || row.image || row.display_image_url || row.thumbnail)) ||
      ''
  );
  const file = img.split('?')[0].split('#')[0].split('/').filter(Boolean).pop();
  return file ? file.toLowerCase() : '';
}

// One stable identity for a catalog entry so the same DESIGN dedupes to a single row, in
// order of how trustworthy each signal is:
//   1. NAME + DESCRIPTION together (two different listings ~never share both word-for-word);
//   2. a real NUMERIC pin id — beats the image so the SAME pin still merges even when one
//      scrape carried an image_url and another didn't;
//   3. the IMAGE's content hash — so volatile-token copies of one design (no numeric id) still
//      collapse instead of splitting one card per keyword;
//   4. the raw (non-numeric) id as a last-resort tiebreaker, so distinct identityless rows
//      don't all merge into one. The ~88-char token only reaches here when there's no image
//      AND no name — i.e. nothing better to group on — never ahead of the image.
export function catalogPinKey(row) {
  if (!row) return '';
  const name = normalizeCatalogName(row.title || row.name);
  if (name) return 'name:' + name + '|desc:' + normalizeCatalogText(row.description);
  const numeric = stableNumericId(row);
  if (numeric) return 'pin:' + numeric;
  const img = imageFileKey(row);
  if (img) return 'img:' + img;
  const id = String(row.pin_id || row.pinId || row.id || '').trim();
  return id ? 'pin:' + id : '';
}

// Identity key for the scan store / catalog-page union. Prefer a STABLE numeric pin id so
// re-scrapes of the same pin collapse to one row; when there's no real numeric id (a sparse CSV
// row, or an ad/aggregated pin that only carries a volatile token) fall back to the design
// identity (image / title+desc) so duplicates STILL merge instead of scattering one card per
// keyword. Mirrors content.js `pintwistScanKey` (a parity test enforces the two stay equal).
export function catalogScanKey(row) {
  if (!row) return '';
  const numeric = stableNumericId(row);
  if (numeric) return 'pin:' + numeric;
  return catalogPinKey(row);
}

// Collapse per-pin rows into one row per DESIGN (title+desc identity) for the catalog's
// "group by design" view. Unlike the storage merge, this does NOT pool metrics — it picks
// the single best-performing copy (highest total engagement) as the representative, so every
// displayed number still belongs to one real pin. It just adds design-level aggregates:
//   design_copies            — how many distinct pins of this design exist (a demand signal)
//   design_total_saves       — saves summed across all copies
//   design_total_engagement  — total engagement summed across all copies
export function groupByDesign(rows) {
  const byKey = new Map();
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
    design_total_engagement: g.totalEngagement,
  }));
}

// Strict host allowlist for Pinterest pin links — the EXACT set of registrable Pinterest
// hosts the extension supports, kept in lockstep with manifest.json `host_permissions`
// (a test in tests/catalog-utils.test.ts cross-checks the two so they can't drift).
//
// Why an explicit list and not a regex: the old `pinterest\.[a-z]{2,}$` fallback accepted
// ANY single label, so fake TLDs like `pinterest.evil` passed; and the partial two-label
// list rejected real ccTLDs like `pinterest.co.in` (Pinterest India). Both are fixed by
// matching only the registrable hosts the manifest actually grants. A host qualifies if it
// equals one of these or is a subdomain of one (`www.`, `br.`, …); lookalikes like
// `pinterest.com.evil.io` and `evilpinterest.com` fail because neither is `=== sfx` nor
// ends with `.` + sfx.
export const PINTEREST_HOST_SUFFIXES = [
  'pinterest.com',
  'pinterest.at',
  'pinterest.ca',
  'pinterest.ch',
  'pinterest.cl',
  'pinterest.co.in',
  'pinterest.co.kr',
  'pinterest.co.nz',
  'pinterest.co.uk',
  'pinterest.com.au',
  'pinterest.com.mx',
  'pinterest.cz',
  'pinterest.de',
  'pinterest.dk',
  'pinterest.es',
  'pinterest.fi',
  'pinterest.fr',
  'pinterest.ie',
  'pinterest.it',
  'pinterest.jp',
  'pinterest.nl',
  'pinterest.nz',
  'pinterest.ph',
  'pinterest.pt',
  'pinterest.ru',
  'pinterest.se',
];
export function isPinterestHost(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  return PINTEREST_HOST_SUFFIXES.some((sfx) => h === sfx || h.endsWith('.' + sfx));
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
    total_engagement: toNumber(next.total_engagement),
  };
}

function trimFixed(value) {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}
