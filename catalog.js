import {
  CATALOG_STORAGE_KEY,
  catalogSummary,
  catalogScanKey,
  createCatalogMerger,
  formatCompactNumber,
  groupByDesign,
  isPinterestHost,
  mergeCatalogRows,
  parseCsvText,
} from './catalog-utils.js';
import { initImportsBackend, loadImports, saveImports as persistImports } from './catalog-store.js';

const els = {
  input: document.getElementById('csv-input'),
  inputFolder: document.getElementById('csv-input-folder'),
  clear: document.getElementById('clear-catalog'),
  search: document.getElementById('search-input'),
  term: document.getElementById('term-filter'),
  type: document.getElementById('type-filter'),
  sort: document.getElementById('sort-select'),
  perPage: document.getElementById('per-page-select'),
  groupToggle: document.getElementById('group-by-design'),
  filterBar: document.getElementById('catalog-filter-bar'),
  status: document.getElementById('catalog-status'),
  grid: document.getElementById('catalog-grid'),
  template: document.getElementById('pin-card-template'),
  pagePrev: document.getElementById('page-prev'),
  pageNext: document.getElementById('page-next'),
  pageInfo: document.getElementById('page-info'),
  modeDark: document.getElementById('catalog-mode-dark'),
  modeLight: document.getElementById('catalog-mode-light'),
  stats: {
    pins: document.getElementById('stat-pins'),
    terms: document.getElementById('stat-terms'),
    saves: document.getElementById('stat-saves'),
    repins: document.getElementById('stat-repins'),
    comments: document.getElementById('stat-comments'),
    reactions: document.getElementById('stat-reactions'),
    shares: document.getElementById('stat-shares'),
    engagement: document.getElementById('stat-engagement'),
  },
};

// `catalogRows` is the DISPLAY union (scans + imports) the grid/filters/stats run on.
// `importedRows` is the catalog page's own data (CSV imports), persisted to
// CATALOG_IMPORTS_KEY. `scanRows` is the scan-accumulation store (read-only here);
// it's owned by the toolbar and counted by the bar's "N saved". Keeping imports out
// of scanRows is the whole point — importing can never change the scan count.
let catalogRows = [];
let importedRows = [];
let scanRows = [];
let currentPage = 1;
let _catalogSyncTimer = null;
// "Group by design" view: collapse per-pin rows into one card per design (title+desc),
// showing the best-performing copy + a copy count. Off = one card per pin (default).
let groupByDesignOn = false;

// ---- Perf caches for large catalogs (50k+) ----
// Recompute heavy work ONLY when its inputs actually change, so paging/typing don't
// re-filter + re-sort + re-stat the whole set every interaction. `_dataVersion` bumps
// on every catalogRows change and invalidates all three caches below.
let _dataVersion = 0;
let _statsVersion = -1; // dataVersion the stats + term dropdown were last rendered at
let _groupedCache = null; // groupByDesign(catalogRows), memoized per dataVersion
let _groupedVersion = -1;
let _viewCache = null; // last filtered+sorted rows
let _viewSig = ''; // signature of the inputs that produced _viewCache

function debounce(fn, ms) {
  let t = null;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

init();

async function init() {
  await hydrateTheme();
  await initImportsBackend();
  await loadStores();
  // Re-merge the imports on open (keyed by pin_id) so any rows stored before a dedup change
  // collapse consistently with how they're stored/displayed now.
  const remerged = mergeCatalogRows([], importedRows, { keyFn: catalogScanKey });
  if (remerged.length < importedRows.length) await saveImports(remerged);
  else recomputeUnion();
  await hydratePageSize();
  const gres = await chrome.storage.local.get({ pintwist_catalog_group_by_design: false });
  groupByDesignOn = !!gres.pintwist_catalog_group_by_design;
  if (els.groupToggle) els.groupToggle.checked = groupByDesignOn;
  render();
  els.input.addEventListener('change', importCsvFiles);
  els.inputFolder?.addEventListener('change', importCsvFiles);
  els.clear.addEventListener('click', clearCatalog);
  // Debounce the live "input" path so typing in search doesn't re-filter the whole
  // catalog on every keystroke; "change" (commit/blur/select) stays immediate.
  const onInput = debounce(() => {
    currentPage = 1;
    render();
  }, 180);
  [els.search, els.term, els.type, els.perPage].forEach((control) => {
    control.addEventListener('input', onInput);
    control.addEventListener('change', async () => {
      currentPage = 1;
      if (control === els.perPage)
        await chrome.storage.local.set({ pintwist_catalog_per_page: els.perPage.value });
      render();
    });
  });
  els.sort.addEventListener('change', async () => {
    currentPage = 1;
    // "copies" / "reach" are design-level sorts — they only mean anything once pins are
    // grouped per design, so selecting one turns on Group by design automatically.
    if ((els.sort.value === 'copies' || els.sort.value === 'reach') && !groupByDesignOn) {
      groupByDesignOn = true;
      if (els.groupToggle) els.groupToggle.checked = true;
      await chrome.storage.local.set({ pintwist_catalog_group_by_design: true });
    }
    render();
  });
  if (els.groupToggle) {
    els.groupToggle.addEventListener('change', async () => {
      groupByDesignOn = els.groupToggle.checked;
      currentPage = 1;
      // Design-level sorts are meaningless in per-pin view — drop back to engagement.
      if (!groupByDesignOn && (els.sort.value === 'copies' || els.sort.value === 'reach')) {
        els.sort.value = 'engagement';
      }
      await chrome.storage.local.set({ pintwist_catalog_group_by_design: groupByDesignOn });
      render();
    });
  }
  wireFilterBar();
  els.pagePrev.addEventListener('click', () => {
    currentPage = Math.max(1, currentPage - 1);
    render();
  });
  els.pageNext.addEventListener('click', () => {
    currentPage += 1;
    render();
  });
  els.modeDark?.addEventListener('click', () => setThemeMode('dark'));
  els.modeLight?.addEventListener('click', () => setThemeMode('light'));
}

// Read BOTH stores: scans (read-only, chrome.storage.local) + imports (the page owns these,
// now in IndexedDB).
async function loadStores() {
  const result = await chrome.storage.local.get({ [CATALOG_STORAGE_KEY]: [] });
  scanRows = Array.isArray(result[CATALOG_STORAGE_KEY]) ? result[CATALOG_STORAGE_KEY] : [];
  importedRows = await loadImports();
  recomputeUnion();
}

// The grid/filters/stats run on the union of scans + imports. Key by pin_id (catalogScanKey)
// so scan rows keep the same identity the toolbar counts them by — otherwise the grid would
// re-collapse scans by title+desc and disagree with the "N scanned" count (audit H1).
function recomputeUnion() {
  catalogRows = mergeCatalogRows(scanRows, importedRows, { keyFn: catalogScanKey });
  // Data changed → invalidate the stats / grouped / filtered-view caches (they all key off this).
  _dataVersion++;
}

// Persist ONLY the imports store — the catalog page never writes the scan store, so
// importing/clearing here can't touch the bar's scan count.
async function saveImports(rows) {
  importedRows = rows;
  recomputeUnion();
  try {
    await persistImports(rows);
    return true;
  } catch (e) {
    // Surface failures (e.g. storage limits) instead of rejecting silently.
    console.warn('PinTwist catalog save failed:', (e && e.message) || e);
    try {
      setStatus('Save failed — the catalog may be too large to store.');
    } catch {}
    return false;
  }
}

async function hydrateTheme() {
  const result = await chrome.storage.sync.get({
    pintwist_theme_color: '#4ade80',
    pintwist_theme_mode: 'dark',
  });
  const theme = result.pintwist_theme_color || '#4ade80';
  document.documentElement.style.setProperty('--theme-color', theme);
  applyThemeMode(result.pintwist_theme_mode);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.pintwist_theme_color) {
      document.documentElement.style.setProperty(
        '--theme-color',
        changes.pintwist_theme_color.newValue || '#4ade80'
      );
    }
    if (area === 'sync' && changes.pintwist_theme_mode) {
      applyThemeMode(changes.pintwist_theme_mode.newValue);
    }
    // Keep the grid fresh when the toolbar accumulates scans while this page is
    // open (audit M4). Only the scan store is watched — imports are written by
    // this page itself, so reacting to them would just re-trigger our own save.
    // Debounced so a burst of scan flushes collapses into one reload + render.
    if (area === 'local' && changes[CATALOG_STORAGE_KEY]) {
      clearTimeout(_catalogSyncTimer);
      _catalogSyncTimer = setTimeout(() => {
        loadStores()
          .then(render)
          .catch(() => {});
      }, 500);
    }
  });
}

function normalizeThemeMode(mode) {
  return mode === 'light' ? 'light' : 'dark';
}

function applyThemeMode(mode) {
  const normalized = normalizeThemeMode(mode);
  document.documentElement.dataset.themeMode = normalized;
  document.body?.classList.toggle('theme-mode-light', normalized === 'light');
  document.body?.classList.toggle('theme-mode-dark', normalized !== 'light');
  const isDark = normalized === 'dark';
  els.modeDark?.classList.toggle('active', isDark);
  els.modeLight?.classList.toggle('active', !isDark);
  els.modeDark?.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  els.modeLight?.setAttribute('aria-pressed', isDark ? 'false' : 'true');
}

async function setThemeMode(mode) {
  const normalized = normalizeThemeMode(mode);
  applyThemeMode(normalized);
  await chrome.storage.sync.set({ pintwist_theme_mode: normalized });
}

async function hydratePageSize() {
  const result = await chrome.storage.local.get({ pintwist_catalog_per_page: '48' });
  if (
    [...els.perPage.options].some(
      (option) => option.value === String(result.pintwist_catalog_per_page)
    )
  ) {
    els.perPage.value = String(result.pintwist_catalog_per_page);
  }
}

async function importCsvFiles(event) {
  // Works for single file, multiple files, or a whole folder (webkitdirectory).
  // Keep only the .csv files and ignore everything else.
  const target = event.target;
  const selected = Array.from(target.files || []);
  const files = selected.filter((file) => /\.csv$/i.test(file.name) || file.type === 'text/csv');
  if (!files.length) {
    target.value = '';
    setStatus(selected.length ? 'No .csv files in that selection.' : 'Nothing selected.');
    return;
  }

  // Disable the import controls while we work so a second selection can't race in.
  if (els.input) els.input.disabled = true;
  if (els.inputFolder) els.inputFolder.disabled = true;

  // Stream every file through ONE merger so peak memory is bounded by the number of
  // UNIQUE pins, not the raw row total. The old code accumulated every parsed row in
  // memory then merged once, so a big folder (e.g. 350 MB / 400k rows of overlapping
  // autoexports) blew memory and had to be truncated at a byte/row cap. Now a heavily-
  // duplicated folder loads in full. Only sanity caps remain (file count + unique rows).
  const MAX_IMPORT_FILES = 2000;
  const MAX_UNIQUE_ROWS = 500000;
  let capNote = '';
  let toRead = files;
  if (toRead.length > MAX_IMPORT_FILES) {
    capNote += ` (capped at ${MAX_IMPORT_FILES} files)`;
    toRead = toRead.slice(0, MAX_IMPORT_FILES);
  }

  try {
    // Seed with the existing imports so re-importing the same folder merges (idempotent)
    // instead of duplicating. Key by pin_id (catalogScanKey) so each distinct Pinterest pin
    // keeps its OWN metrics + scrape history — metrics belong to a pin_id and must never be
    // pooled across the design's other copies. (Rows with no pin_id fall back to title+desc.)
    // maxObservations bounds each pin's history so a pin scraped hundreds of times can't grow
    // unboundedly (24 is plenty for the sparkline).
    const merger = createCatalogMerger({ maxObservations: 24, keyFn: catalogScanKey });
    merger.ingest(importedRows);
    let rawRows = 0;
    for (let i = 0; i < toRead.length; i++) {
      // Show progress per file. Reading a large CSV can take a moment, and with a
      // folder of dozens of files the whole import used to look frozen.
      setStatus(`Reading CSV ${i + 1} of ${toRead.length}…`, {
        busy: true,
        progress: i / toRead.length,
      });
      // Yield so the status actually repaints before we block on the next read.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const text = await toRead[i].text();
      const rows = parseCsvText(text);
      rawRows += rows.length;
      merger.ingest(rows); // lean snapshots kept; the raw rows are freed after this
      if (merger.size() > MAX_UNIQUE_ROWS) {
        capNote += ` (capped at ${MAX_UNIQUE_ROWS.toLocaleString()} unique pins)`;
        break;
      }
    }

    // Finalize is synchronous and can be heavy for a big catalog — flag it, and let the
    // message paint before we block the main thread. No measurable progress here, so the
    // bar runs indeterminate (animated) for merge + save.
    setStatus('Merging into the catalog…', { busy: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Merge into the IMPORTS store only — never the scan-accumulation store.
    const merged = merger.finalize();

    setStatus('Saving catalog…', { busy: true });
    await saveImports(merged);

    target.value = '';
    const skipped = selected.length - files.length;
    setStatus(
      `Imported ${rawRows.toLocaleString()} rows from ${files.length} CSV file${files.length === 1 ? '' : 's'} → ${merged.length.toLocaleString()} unique pins` +
        (skipped > 0 ? ` (ignored ${skipped} non-CSV file${skipped === 1 ? '' : 's'})` : '') +
        capNote +
        '.'
    );
    render();
  } catch (err) {
    setStatus('Import failed — ' + (err && err.message ? err.message : 'unknown error') + '.');
  } finally {
    if (els.input) els.input.disabled = false;
    if (els.inputFolder) els.inputFolder.disabled = false;
  }
}

async function clearCatalog() {
  if (!importedRows.length) {
    setStatus(
      scanRows.length
        ? 'Nothing to clear here — these are scanned pins. Clear them from the toolbar (export resets the count).'
        : 'Nothing to clear.'
    );
    return;
  }
  if (!confirm('Clear all IMPORTED pins from the local catalog? (Scanned pins are kept.)')) return;
  await saveImports([]);
  setStatus('Imported pins cleared.');
  render();
}

function render() {
  // Stats + term dropdown depend ONLY on catalogRows — rebuild once per data change,
  // not on every filter/sort/page interaction (rebuilding the dropdown DOM over 50k
  // rows every click was a big part of the lag).
  if (_statsVersion !== _dataVersion) {
    renderStats();
    renderTermFilter();
    _statsVersion = _dataVersion;
  }
  const rows = filteredRowsMemo();
  const pagination = pageSlice(rows);
  renderGrid(pagination.rows);
  renderPagination(pagination, rows.length);
  if (catalogRows.length) {
    const start = rows.length ? pagination.start + 1 : 0;
    // Scanned and imported are independent counts; show both so it's clear the
    // imported pins never roll into the toolbar's scan-accumulation number.
    const unit = groupByDesignOn ? 'designs' : 'pins';
    setStatus(
      `Showing ${start}-${pagination.end} of ${rows.length} matching ${unit} ` +
        `(${importedRows.length.toLocaleString()} imported · ${scanRows.length.toLocaleString()} scanned).`
    );
  }
}

function pageSlice(rows) {
  const perPage = Number(els.perPage.value) || 48;
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  currentPage = Math.min(Math.max(1, currentPage), pageCount);
  const start = (currentPage - 1) * perPage;
  const end = Math.min(rows.length, start + perPage);
  return { rows: rows.slice(start, end), page: currentPage, pageCount, start, end, perPage };
}

function renderPagination(pagination, totalRows) {
  const hasRows = totalRows > 0;
  els.pagePrev.disabled = !hasRows || pagination.page <= 1;
  els.pageNext.disabled = !hasRows || pagination.page >= pagination.pageCount;
  els.pageInfo.textContent = hasRows
    ? `Page ${pagination.page} of ${pagination.pageCount}`
    : 'Page 1 of 1';
}

function wireFilterBar() {
  const bar = els.filterBar;
  if (!bar) return;
  const rerender = () => {
    currentPage = 1;
    render();
  };
  // Debounced for the keystroke ("input") path; "change" commits immediately.
  const rerenderDebounced = debounce(rerender, 180);
  bar.querySelectorAll('.filter-input').forEach((el) => {
    el.addEventListener('input', () => {
      // Typing a date by hand clears any active preset highlight.
      if (el.dataset.metric === 'date')
        bar
          .querySelectorAll('.date-preset-chip.active')
          .forEach((c) => c.classList.remove('active'));
      rerenderDebounced();
    });
    el.addEventListener('change', rerender);
  });
  bar.querySelectorAll('.date-preset-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const days = Number(chip.dataset.days) || 0;
      const fmt = (d) => d.toISOString().split('T')[0];
      const minEl = bar.querySelector('.filter-input[data-metric="date"][data-bound="min"]');
      const maxEl = bar.querySelector('.filter-input[data-metric="date"][data-bound="max"]');
      if (minEl) minEl.value = fmt(new Date(Date.now() - days * 86400000));
      if (maxEl) maxEl.value = fmt(new Date());
      bar
        .querySelectorAll('.date-preset-chip')
        .forEach((c) => c.classList.toggle('active', c === chip));
      rerender();
    });
  });
  const reset = document.getElementById('catalog-reset-filters');
  if (reset) {
    reset.addEventListener('click', () => {
      bar.querySelectorAll('.filter-input').forEach((el) => {
        el.value = '';
      });
      bar.querySelectorAll('.date-preset-chip.active').forEach((c) => c.classList.remove('active'));
      rerender();
    });
  }
}

// Read a metric min/max bound from the filter bar. Blank = unbounded.
function metricBound(metric, bound, fallback) {
  const bar = els.filterBar;
  if (!bar) return fallback;
  const el = bar.querySelector(`.filter-input[data-metric="${metric}"][data-bound="${bound}"]`);
  const raw = el ? String(el.value).trim().replace(/,/g, '') : '';
  if (raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
// Read a date bound as a timestamp. Blank = unbounded; the max bound covers the whole day.
function dateBound(bound, fallback) {
  const bar = els.filterBar;
  if (!bar) return fallback;
  const el = bar.querySelector(`.filter-input[data-metric="date"][data-bound="${bound}"]`);
  const raw = el ? String(el.value).trim() : '';
  if (raw === '') return fallback;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return fallback;
  return bound === 'max' ? t + 86399999 : t;
}

// groupByDesign over the whole catalog is O(n) — memoize it per data change so toggling
// pages/filters/sort doesn't re-collapse 50k rows every time.
function groupedRowsMemo() {
  if (_groupedVersion !== _dataVersion || !_groupedCache) {
    _groupedCache = groupByDesign(catalogRows);
    _groupedVersion = _dataVersion;
  }
  return _groupedCache;
}

// A cheap fingerprint of everything that affects the filtered+sorted view. Reads all
// filter inputs generically (so no filter can be missed) plus data version / group / sort.
// Pagination + per-page are intentionally NOT here — changing the page reuses the cached
// view and just re-slices, instead of re-filtering + re-sorting the whole set.
function viewSignature() {
  const fb = els.filterBar;
  const filters = fb
    ? Array.from(fb.querySelectorAll('.filter-input'))
        .map((e) => e.value)
        .join('\u0001')
    : '';
  return [
    _dataVersion,
    groupByDesignOn ? 'g' : 'p',
    els.sort.value,
    els.search.value,
    els.term.value,
    els.type.value,
    filters,
  ].join('\u0001');
}

// Returns the filtered+sorted rows, recomputing only when the signature changes.
function filteredRowsMemo() {
  const sig = viewSignature();
  if (sig === _viewSig && _viewCache) return _viewCache;
  _viewCache = filteredRows();
  _viewSig = sig;
  return _viewCache;
}

function filteredRows() {
  const query = els.search.value.trim().toLowerCase();
  const term = els.term.value;
  const type = els.type.value;

  const mn = {
    saves: metricBound('saves', 'min', -Infinity),
    comments: metricBound('comments', 'min', -Infinity),
    repins: metricBound('repins', 'min', -Infinity),
    reactions: metricBound('reactions', 'min', -Infinity),
    shares: metricBound('shares', 'min', -Infinity),
  };
  const mx = {
    saves: metricBound('saves', 'max', Infinity),
    comments: metricBound('comments', 'max', Infinity),
    repins: metricBound('repins', 'max', Infinity),
    reactions: metricBound('reactions', 'max', Infinity),
    shares: metricBound('shares', 'max', Infinity),
  };
  const dMin = dateBound('min', -Infinity);
  const dMax = dateBound('max', Infinity);
  const dateActive = dMin !== -Infinity || dMax !== Infinity;
  const n = (v) => Number(v) || 0;

  // In "group by design" mode, collapse to one row per design (best copy + copy count)
  // BEFORE filtering/sorting, so the grid shows designs while every metric still belongs
  // to one real pin. Off = one row per pin.
  const source = groupByDesignOn ? groupedRowsMemo() : catalogRows;

  const rows = source.filter((row) => {
    if (term && row.search_term !== term) return false;
    if (type === 'video' && !row.is_video) return false;
    if (type === 'image' && row.is_video) return false;
    // Metric range filters (blank bound = unbounded).
    if (n(row.saves) < mn.saves || n(row.saves) > mx.saves) return false;
    if (n(row.comments) < mn.comments || n(row.comments) > mx.comments) return false;
    if (n(row.repins) < mn.repins || n(row.repins) > mx.repins) return false;
    if (n(row.reactions) < mn.reactions || n(row.reactions) > mx.reactions) return false;
    if (n(row.shares) < mn.shares || n(row.shares) > mx.shares) return false;
    if (dateActive) {
      const t = Date.parse(row.pin_created_at || '');
      if (Number.isNaN(t) || t < dMin || t > dMax) return false;
    }
    if (!query) return true;
    return [
      row.search_term,
      row.title,
      row.description,
      row.domain,
      row.board_name,
      row.pinner_username,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  const num = (v) => Number(v) || 0;
  const sortBy = els.sort.value;
  // Date sort: decorate-sort-undecorate so Date.parse runs once per row (O(n)) instead of
  // on every comparison (O(n log n) parses) — a real cost at 50k rows.
  if (sortBy === 'date' || sortBy === 'newest') {
    return rows
      .map((r) => ({ r, t: Date.parse(r.pin_created_at || '') || 0 }))
      .sort((a, b) => b.t - a.t)
      .map((x) => x.r);
  }
  return rows.sort((a, b) => {
    switch (sortBy) {
      case 'saves':
        return num(b.saves) - num(a.saves);
      case 'shares':
        return num(b.shares) - num(a.shares);
      case 'reactions':
        return num(b.reactions) - num(a.reactions);
      case 'repins':
        return num(b.repins) - num(a.repins);
      case 'comments':
        return num(b.comments) - num(a.comments);
      case 'term':
        return (a.search_term || '').localeCompare(b.search_term || '');
      case 'copies':
        // Design-level: how many distinct pins back this design (0 in per-pin view).
        return num(b.design_copies) - num(a.design_copies);
      case 'reach':
        // Design-level: total engagement summed across all copies of the design.
        return num(b.design_total_engagement) - num(a.design_total_engagement);
      default:
        return num(b.total_engagement) - num(a.total_engagement);
    }
  });
}

function renderStats() {
  const summary = catalogSummary(catalogRows);
  els.stats.pins.textContent = formatCompactNumber(summary.pins);
  els.stats.terms.textContent = formatCompactNumber(summary.terms);
  els.stats.saves.textContent = formatCompactNumber(summary.saves);
  els.stats.repins.textContent = formatCompactNumber(summary.repins);
  els.stats.comments.textContent = formatCompactNumber(summary.comments);
  els.stats.reactions.textContent = formatCompactNumber(summary.reactions);
  els.stats.shares.textContent = formatCompactNumber(summary.shares);
  els.stats.engagement.textContent = formatCompactNumber(summary.engagement);
}

function renderTermFilter() {
  const current = els.term.value;
  const terms = Array.from(
    new Set(catalogRows.map((row) => row.search_term).filter(Boolean))
  ).sort();
  els.term.innerHTML = '<option value="">All search terms</option>';
  terms.forEach((term) => {
    const option = document.createElement('option');
    option.value = term;
    option.textContent = term;
    els.term.appendChild(option);
  });
  if (terms.includes(current)) els.term.value = current;
}

function renderGrid(rows) {
  els.grid.innerHTML = '';
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.textContent = catalogRows.length
      ? 'No pins match the current filters.'
      : 'Import PinTwist CSV files or run new scans to fill this catalog.';
    els.grid.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  rows.forEach((row) => fragment.appendChild(createCard(row)));
  els.grid.appendChild(fragment);
}

// Inline SVG icons — identical set to the post-scan results overlay (content.js ICONS),
// so the catalog cards read the same as the results pins.
const ICONS = {
  heart:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  reaction:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.536-4.464a.75.75 0 10-1.061-1.061 3.5 3.5 0 01-4.95 0 .75.75 0 00-1.06 1.06 5 5 0 007.07 0zM9 8.5c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S7.448 7 8 7s1 .672 1 1.5zm3 1.5c.552 0 1-.672 1-1.5S12.552 7 12 7s-1 .672-1 1.5.448 1.5 1 1.5z" clip-rule="evenodd"/></svg>',
  share:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>',
  repin:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 9v4H6V9H4v6h6v5l6-5h4V9h-2z"/><path d="M6 15v-4h12v4h2V9h-6l-6 5v1H6z"/></svg>',
  comment:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/></svg>',
  calendar:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z"/></svg>',
  download:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>',
};

// Mirrors getDaysAgo() in content.js so the date chip reads the same (e.g. "3W", "1MO", "5Y").
function daysAgoLabel(value) {
  const t = Date.parse(value || '');
  if (!t) return '—';
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days <= 0) return 'TODAY';
  if (days === 1) return 'YSTRDY';
  if (days < 7) return days + 'D';
  if (days < 30) return Math.floor(days / 7) + 'W';
  if (days < 365) return Math.floor(days / 30) + 'MO';
  return Math.floor(days / 365) + 'Y';
}

// Maps the active sort to the badge shown top-right on each card (label + row field).
// A null field means show the date instead.
const SORT_BADGE = {
  saves: ['Saves', 'saves'],
  shares: ['Shares', 'shares'],
  reactions: ['Reactions', 'reactions'],
  repins: ['Repins', 'repins'],
  comments: ['Comments', 'comments'],
  engagement: ['Engagement', 'total_engagement'],
  date: ['Date', null],
  term: ['Saves', 'saves'],
  copies: ['Copies', 'design_copies'],
  reach: ['Reach', 'design_total_engagement'],
};

// An imported CSV is untrusted input. Only allow Pinterest's image CDN to be loaded
// or downloaded — otherwise a crafted row could point image URLs at an arbitrary host
// (tracking pixels / deanonymizing fetches) or get them opened in a tab.
function safeImageUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)pinimg\.com$/i.test(x.hostname) ? x.href : '';
  } catch {
    return '';
  }
}
// Pin links may point at a Pinterest page or the image CDN; anything else is dropped.
function safePinHref(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:') return '';
    // pinimg CDN or a real Pinterest host. isPinterestHost rejects lookalikes like
    // pinterest.com.evil.io that the old broad regex let through (codex finding 1).
    return /(^|\.)pinimg\.com$/i.test(x.hostname) || isPinterestHost(x.hostname) ? x.href : '';
  } catch {
    return '';
  }
}

function downloadPinImage(url, row, _btn) {
  if (!safeImageUrl(url)) return; // never download from a non-Pinterest host
  const safeTerm =
    (row.search_term || 'pintwist').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'pintwist';
  // Route through the background so the user's configured download folder is honored
  // (the background derives the extension and prefixes the folder).
  const filename = `${safeTerm}-${row.pin_id || 'pin'}`;
  try {
    chrome.runtime.sendMessage({ action: 'downloadImage', url, filename }, () => {
      void chrome.runtime.lastError; // swallow; do NOT fall back to opening the URL
    });
  } catch {
    /* non-fatal */
  }
}

function createCard(row) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const link = node.querySelector('.pin-image-link');
  const img = node.querySelector('.pin-image');
  const title = row.title || row.description || row.pin_id || 'Pinterest pin';

  // Untrusted CSV input: restrict links to Pinterest/pinimg and images to the
  // pinimg CDN (blocks javascript: URLs and arbitrary off-Pinterest hosts).
  const pinUrl = safePinHref(row.pin_url) || safePinHref(row.image_url) || '#';
  const imageUrl = safeImageUrl(row.image_url);

  link.href = pinUrl;
  img.src = imageUrl || 'images/logo-icon.png';
  img.alt = title;
  const termText = row.search_term || 'Manual scan';
  // In group-by-design mode show how many distinct pins back this design (a demand signal).
  node.querySelector('.pin-term').textContent =
    row.design_copies > 1 ? `${termText} · ${row.design_copies}×` : termText;

  // Inline the SVG icons into their placeholders.
  node.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = ICONS[el.dataset.icon] || '';
  });

  // The pin's own age (date cell) doesn't change between scrapes.
  node.querySelector('[data-metric="date"]').textContent = daysAgoLabel(row.pin_created_at);

  // Scrape history: each entry is one "true rescrape" (a snapshot where a metric
  // changed). Cycling the dots/arrows shows that snapshot's numbers + timestamp.
  const history =
    Array.isArray(row.history) && row.history.length
      ? row.history.slice()
      : [
          {
            scanned_at: row.scanned_at || row.last_seen_at || '',
            saves: Number(row.saves) || 0,
            comments: Number(row.comments) || 0,
            repins: Number(row.repins) || 0,
            reactions: Number(row.reactions) || 0,
            shares: Number(row.shares) || 0,
            total_engagement: Number(row.total_engagement) || 0,
          },
        ];
  let activeIdx = history.length - 1;

  const [badgeLabel, badgeField] = SORT_BADGE[els.sort.value] || SORT_BADGE.saves;
  const badge = node.querySelector('.pin-badge');
  badge.href = pinUrl;
  const valEl = (m) => node.querySelector('[data-metric="' + m + '"]');
  const stampEl = node.querySelector('.pin-history-stamp');
  const historyBar = node.querySelector('.pin-history');
  const dotEls = [];

  const scrapeDate = (snap) => {
    const t = Date.parse(snap.scanned_at || '');
    if (!t) return '';
    return new Date(t).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  function applySnapshot(idx) {
    const snap = history[idx] || history[history.length - 1];
    valEl('saves').textContent = formatCompactNumber(snap.saves);
    valEl('reactions').textContent = formatCompactNumber(snap.reactions);
    valEl('shares').textContent = formatCompactNumber(snap.shares);
    valEl('repins').textContent = formatCompactNumber(snap.repins);
    valEl('comments').textContent = formatCompactNumber(snap.comments);
    badge.textContent = badgeField
      ? `${badgeLabel}: ${formatCompactNumber(snap[badgeField] != null ? snap[badgeField] : row[badgeField])}`
      : daysAgoLabel(row.pin_created_at);
    if (history.length > 1) {
      const d = scrapeDate(snap);
      stampEl.textContent = `${idx + 1}/${history.length}` + (d ? ' · ' + d : '');
      dotEls.forEach((dot, i) => dot.classList.toggle('is-active', i === idx));
    }
  }

  if (history.length > 1) {
    historyBar.hidden = false;
    const dotsWrap = node.querySelector('.pin-history-dots');
    dotsWrap.innerHTML = '';
    history.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'pin-history-dot';
      dot.setAttribute('aria-label', 'Scrape ' + (i + 1));
      dot.addEventListener('click', () => {
        activeIdx = i;
        applySnapshot(activeIdx);
      });
      dotsWrap.appendChild(dot);
      dotEls.push(dot);
    });
    node.querySelector('.pin-history-prev').addEventListener('click', () => {
      activeIdx = (activeIdx - 1 + history.length) % history.length;
      applySnapshot(activeIdx);
    });
    node.querySelector('.pin-history-next').addEventListener('click', () => {
      activeIdx = (activeIdx + 1) % history.length;
      applySnapshot(activeIdx);
    });
  }

  applySnapshot(activeIdx);

  // Download the pin image (extension has the "downloads" permission).
  const dl = node.querySelector('.pin-download');
  if (!imageUrl) dl.disabled = true;
  else dl.addEventListener('click', () => downloadPinImage(imageUrl, row, dl));

  return node;
}

function setStatus(message, opts) {
  els.status.textContent = '';
  if (!opts || !opts.busy) {
    els.status.textContent = message;
    return;
  }
  // Busy: spinner + text + a loading bar, all on one row (see .catalog-status flex).
  // opts.progress is a 0..1 fraction for a determinate bar; omit it for an
  // indeterminate (animated) bar when we can't measure progress.
  const hasProgress = typeof opts.progress === 'number';
  const spinner = document.createElement('span');
  spinner.className = 'catalog-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'catalog-status-text';
  label.textContent = message;
  const bar = document.createElement('span');
  bar.className = 'catalog-progress' + (hasProgress ? '' : ' catalog-progress--indeterminate');
  bar.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('span');
  fill.className = 'catalog-progress-fill';
  if (hasProgress) {
    fill.style.width = Math.max(0, Math.min(1, opts.progress)) * 100 + '%';
  }
  bar.appendChild(fill);
  els.status.appendChild(spinner);
  els.status.appendChild(label);
  els.status.appendChild(bar);
}
