'use strict';
const CACHE_TTL = 36e5, // 1h — re-scanning a pin within 1h reuses its cached metrics
  // (no Pinterest re-fetch, less rate-limit risk); after 1h a re-scan fetches fresh numbers.
  // Does NOT affect dedup/accumulation (those are pin_id, permanent) — only metric freshness.
  CONFIG = {
    appVersion: null,
    experimentHash: null,
    handlerId: null,
    origin: 'https://www.pinterest.com',
    path: '/',
    initialized: false,
  },
  State = {
    metricsCache: new Map(),
    loadedIDs: new Set(),
    processingIDs: new Set(),
    sortedPinIDs: new Set(),
    insertedNodes: [],
    selectedMetric: 'saves',
    count: 0,
    timeout: null,
    observer: null,
    currentUrl: window.location.href,
    urlCheckInterval: null,
    aborted: false,
    inFlightRequests: new Map(),
    filterRanges: null,
    activeFilters: null,
  };
// The theme color is stamped straight into inline style attributes and inline
// event handlers below (e.g. `fill:${color}`, an `onmouseover` string). It's
// normally written only by our own `<input type=color>`, so it's always a clean
// `#rrggbb` — but never trust a stored value at an HTML/handler interpolation
// point. Reject anything that isn't a 3/6-digit hex color and fall back. (audit low)
function sanitizeThemeColor(value, fallback) {
  const fb = fallback || '#F48FB1';
  return typeof value === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value.trim())
    ? value.trim()
    : fb;
}
// Pin thumbnails come from Pinterest API metadata, which is untrusted even though it
// originates from Pinterest — a crafted/echoed `image_url` field could point img.src at
// an arbitrary host (tracking pixel / deanonymizing fetch from the page context). Mirror
// the same https `*.pinimg.com` boundary the catalog and download paths enforce. (audit/codex low)
function isPinimgUrl(url) {
  try {
    const x = new URL(url);
    return x.protocol === 'https:' && /(^|\.)pinimg\.com$/i.test(x.hostname);
  } catch {
    return false;
  }
}
function getPinterestHeaderHeight() {
  if (document.getElementById('pintwist-sorted-container') || document.getElementById('pintwist-resort-bar')) return 0;
  const selectors = ['[data-test-id="header"]', '[data-test-id="header-container"]', 'header', '[role="banner"]'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0) return Math.ceil(Math.max(rect.height, rect.bottom));
    }
  }
  return 96;
}
function getPinterestSidebarWidth() {
  const selectors = ['[data-test-id="left-nav-container"]', 'nav[aria-label]', 'div[data-test-id="sidenav"]'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.width < 120) return rect.width;
    }
  }
  return 60;
}
const PINTWIST_DOCK_WIDTH = 304;
function getContentRoot() {
  return (
    document.getElementById('pintwist-sorted-container') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.querySelector('[data-test-id="search-feed"]') ||
    document.querySelector('[data-test-id="masonry-container"]')?.closest('div')
  );
}
function applyContentOffset() {
  // Pill is the ONLY layout — the page is never docked/shifted. The old side-rail
  // path added a left margin to the content (which briefly shoved the page right on
  // load before pill mode kicked in — the "flash"). Just clear any stale docked
  // state instead of ever applying an offset.
  removeContentOffset();
}
function removeContentOffset() {
  const e = document.documentElement;
  (e && e.classList.remove('pintwist-docked'),
    e?.style.removeProperty('--pintwist-dock-offset'),
    e?.style.removeProperty('--pintwist-header-offset'));
  const i = getContentRoot();
  i &&
    i.id !== 'pintwist-initial-bar' &&
    ((i.style.marginTop = ''), (i.style.marginLeft = ''), (i.style.maxWidth = ''), (i.style.boxSizing = ''));
}
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
  },
  METRIC_MAP = { saves: 'saves', share: 'shares', reaction: 'reactions', repin: 'repins', comment: 'comments' },
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function escapeAttr(value) {
  return value
    ? String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    : '';
}
function formatNumber(value) {
  if (value >= 1e6) {
    const s = (value / 1e6).toFixed(1);
    return (s.endsWith('.0') ? s.slice(0, -2) : s) + 'M';
  }
  if (value >= 1e3) {
    const s = (value / 1e3).toFixed(1);
    return (s.endsWith('.0') ? s.slice(0, -2) : s) + 'K';
  }
  return value.toString();
}
function formatDate(value) {
  try {
    return new Date(value).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Unknown';
  }
}
function getDaysAgo(dateInput) {
  try {
    const days = Math.floor((Date.now() - new Date(dateInput)) / 864e5);
    return days === 0
      ? 'TODAY'
      : days === 1
        ? 'YESTERDAY'
        : days < 7
          ? `${days}D`
          : days < 30
            ? `${Math.floor(days / 7)}W`
            : days < 365
              ? `${Math.floor(days / 30)}MO`
              : `${Math.floor(days / 365)}Y`;
  } catch {
    return 'UNKNOWN';
  }
}
function extractConfig() {
  if (CONFIG.initialized) return CONFIG;
  try {
    const e = document.querySelector('#__PWS_DATA__');
    // __PWS_DATA__ is injected during page load. If it isn't in the DOM yet when this runs
    // (a load-timing race), DON'T cache a null config — leave CONFIG uninitialized so the
    // next getFreshConfig() call retries. The old code set initialized=true unconditionally,
    // freezing handlerId=null for the whole session; Pinterest now 403s ("Invalid Resource
    // Request") any /resource/ call missing the x-pinterest-pws-handler header (= handlerId),
    // so every metric fetch failed -> 0 metrics -> overlays never painted. (overlay config-race fix)
    if (!e) return CONFIG;
    const t = JSON.parse(e.textContent || '{}');
    ((CONFIG.appVersion = t.appVersion || 'c7cbc61'),
      (CONFIG.experimentHash = t.context?.experiment_hash || ''),
      (CONFIG.handlerId = t.initialHandlerId || 'www/index.js'),
      (CONFIG.path = t.context?.path || '/'),
      (CONFIG.origin = t.context?.origin || 'https://www.pinterest.com'),
      (CONFIG.initialized = true));
  } catch {
    // Malformed __PWS_DATA__ — fall back to safe defaults (handlerId 'www/index.js' is accepted)
    // and stop retrying so we don't spin on a genuinely broken page.
    ((CONFIG.appVersion = 'c7cbc61'),
      (CONFIG.experimentHash = ''),
      (CONFIG.handlerId = 'www/index.js'),
      (CONFIG.initialized = true));
  }
  return CONFIG;
}
function getFreshConfig() {
  return (
    CONFIG.initialized || extractConfig(),
    {
      appVersion: CONFIG.appVersion,
      experimentHash: CONFIG.experimentHash,
      handlerId: CONFIG.handlerId,
      path: window.location.pathname || CONFIG.path,
      origin: window.location.origin || CONFIG.origin,
    }
  );
}
function getCsrfToken() {
  const e = document.cookie.match(/csrftoken=([^;]+)/);
  return e ? e[1] : null;
}
async function saveCache() {
  try {
    if (!chrome?.storage?.local) return;
    const e = 2e3;
    if (State.metricsCache.size > e) {
      const t = [...State.metricsCache.entries()];
      t.slice(0, t.length - e).forEach(([i]) => State.metricsCache.delete(i));
    }
    await chrome.storage.local.set({ pintwist_cache: Object.fromEntries(State.metricsCache) });
  } catch (e) {
    if (!/context invalidated|Extension context/i.test((e && e.message) || ''))
      console.warn('PinTwist: Cache save failed', e);
  }
}
async function loadCache() {
  try {
    const { pintwist_cache: e } = await chrome.storage.local.get('pintwist_cache');
    if (e) State.metricsCache = new Map(Object.entries(e));
  } catch (e) {
    console.warn('PinTwist: Cache load failed', e);
  }
}
function getCached(e) {
  const t = State.metricsCache.get(e);
  return t && typeof t.timestamp == 'number' && Date.now() - t.timestamp < CACHE_TTL
    ? t
    : (t && State.metricsCache.delete(e), null);
}
function setCache(e, t) {
  ((t.timestamp = Date.now()),
    State.metricsCache.set(e, t),
    State.loadedIDs.add(e),
    State.metricsCache.size % 20 === 0 && saveCache());
}
async function fetchBulk(e) {
  if (!e.length) return new Map();
  const t = new Map(),
    i = [];
  if (
    (e.forEach((r) => {
      const m = getCached(r);
      m ? t.set(r, m) : i.push(r);
    }),
    !i.length)
  )
    return t;
  const n = 35,
    s = 40,
    a = 2;
  for (let r = 0; r < i.length; r += n) {
    const o = i.slice(r, r + n).map(async (l) => {
      for (let d = 0; d <= a; d++) {
        try {
          const h = await chrome.runtime.sendMessage({
            action: 'fetchPinData',
            pinID: l,
            config: getFreshConfig(),
            csrfToken: getCsrfToken(),
          });
          if (h?.success && h.data) {
            const f = extractMetrics(h.data, l);
            return (setCache(l, f), { pinID: l, metrics: f });
          }
        } catch {
          if (d < a) {
            await sleep(1e3);
            continue;
          }
        }
        break;
      }
      return null;
    });
    ((await Promise.all(o)).forEach((l) => {
      l && t.set(l.pinID, l.metrics);
    }),
      r + n < i.length && (await sleep(s)));
  }
  return t;
}
function extractMetrics(e, t) {
  if (!e)
    return {
      pinID: t,
      saves: 0,
      reactions: 0,
      shares: 0,
      repins: 0,
      comments: 0,
      createdAt: null,
      imageUrl: null,
      isVideo: false,
      title: null,
      description: null,
      link: null,
      domain: null,
      dominantColor: null,
      altText: null,
      boardName: null,
      pinnerUsername: null,
      fetchFailed: true,
    };
  const i = !!(e?.videos || e?.story_pin_data?.pages?.[0]?.blocks?.[0]?.video || e?.is_video);
  let n = null;
  if (
    (e?.images &&
      (n =
        e.images.orig?.url ||
        e.images['1200x']?.url ||
        e.images['736x']?.url ||
        e.images['564x']?.url ||
        e.images['474x']?.url ||
        e.images['236x']?.url ||
        Object.values(e.images).find((s) => s?.url)?.url),
    !n && e?.videos?.video_list)
  ) {
    const s = e.videos.video_list;
    for (const a of Object.keys(s))
      if (s[a]?.thumbnail) {
        n = s[a].thumbnail;
        break;
      }
  }
  if (!n && e?.story_pin_data?.pages)
    for (const s of e.story_pin_data.pages) {
      if (s?.image?.images) {
        const a = s.image.images;
        if (((n = a.orig?.url || a['1200x']?.url || Object.values(a).find((r) => r?.url)?.url), n)) break;
      }
      if (s?.blocks)
        for (const a of s.blocks) {
          if (a?.image?.images) {
            const r = a.image.images;
            if (((n = r.orig?.url || Object.values(r).find((m) => m?.url)?.url), n)) break;
          }
          if (a?.video?.video_list) {
            for (const r of Object.values(a.video.video_list))
              if (r?.thumbnail) {
                n = r.thumbnail;
                break;
              }
          }
        }
      if (n) break;
    }
  if (!n && e?.carousel_data?.carousel_slots) {
    for (const s of e.carousel_data.carousel_slots)
      if (s?.images && ((n = s.images.orig?.url || Object.values(s.images).find((a) => a?.url)?.url), n)) break;
  }
  if (!n && e?.closeup_unified_description?.images) {
    const s = e.closeup_unified_description.images;
    n = s.orig?.url || Object.values(s).find((a) => a?.url)?.url;
  }
  return (
    !n &&
      e?.image_signature &&
      (n = `https://i.pinimg.com/originals/${e.image_signature.slice(0, 2)}/${e.image_signature.slice(2, 4)}/${e.image_signature.slice(4, 6)}/${e.image_signature}.jpg`),
    n || (n = e?.image_url || e?.imageUrl || e?.image_medium_url),
    {
      pinID: t,
      // Coerce to Number so a non-numeric API value can never reach an HTML sink
      // (these round-trip through storage and re-render). NaN -> 0 via `|| 0`.
      saves: Number(e?.aggregated_pin_data?.aggregated_stats?.saves) || 0,
      reactions: Number(e?.reaction_counts?.[1]) || 0,
      shares: Number(e?.share_count) || 0,
      repins: Number(e?.repin_count) || 0,
      comments: Number(e?.aggregated_pin_data?.comment_count) || 0,
      createdAt: e?.created_at || null,
      imageUrl: n,
      isVideo: i,
      title: e?.title || e?.grid_title || null,
      description: e?.description || null,
      link: e?.link || null,
      domain: e?.domain || null,
      dominantColor: e?.dominant_color || null,
      altText: e?.auto_alt_text || null,
      boardName: e?.board?.name || null,
      pinnerUsername: e?.pinner?.username || null,
      fetchFailed: false,
    }
  );
}
function createOverlayHTML(e) {
  const t = e.createdAt ? formatDate(e.createdAt) : 'Unknown',
    i = e.createdAt ? getDaysAgo(e.createdAt) : '',
    n = e.imageUrl?.startsWith('https://') ? e.imageUrl : '';
  return `
        <div class="pintwist-metrics-overlay" data-pintwist="overlay">
            <div class="pintwist-metrics-column">
                <div class="pintwist-metric-item" title="Saves">
                    <div class="pintwist-metric-icon">${ICONS.heart}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.saves)}</span>
                </div>
                <div class="pintwist-metric-item" title="Reactions">
                    <div class="pintwist-metric-icon">${ICONS.reaction}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.reactions)}</span>
                </div>
                <div class="pintwist-metric-item" title="Shares">
                    <div class="pintwist-metric-icon">${ICONS.share}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.shares)}</span>
                </div>
                <div class="pintwist-metric-item" title="Repins">
                    <div class="pintwist-metric-icon">${ICONS.repin}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.repins)}</span>
                </div>
                <div class="pintwist-metric-item" title="Comments">
                    <div class="pintwist-metric-icon">${ICONS.comment}</div>
                    <span class="pintwist-metric-value">${formatNumber(e.comments)}</span>
                </div>
                <div class="pintwist-metric-item" title="${escapeAttr(t)}">
                    <div class="pintwist-metric-icon">${ICONS.calendar}</div>
                    <span class="pintwist-metric-value">${i}</span>
                </div>
            </div>
            <button class="pintwist-download-btn" data-pin-id="${escapeAttr(e.pinID)}" data-image-url="${escapeAttr(n)}">
                <span class="pintwist-download-icon">${ICONS.download}</span>
                <span class="pintwist-download-text">Download</span>
                <span class="pintwist-download-loader" style="display:none;">\u23F3</span>
            </button>
        </div>
    `;
}
function downloadImage(pinID, url, btn) {
  if (!url) return;
  const txt = btn.querySelector('.pintwist-download-text'),
    loader = btn.querySelector('.pintwist-download-loader'),
    icon = btn.querySelector('.pintwist-download-icon');
  (txt && (txt.style.display = 'none'),
    icon && (icon.style.display = 'none'),
    loader && (loader.style.display = 'inline'),
    (btn.disabled = true),
    chrome.runtime.sendMessage({ action: 'downloadImage', url, filename: `pinterest_${pinID}_${Date.now()}` }, () => {
      setTimeout(() => {
        (txt && (txt.style.display = 'inline'),
          icon && (icon.style.display = 'inline'),
          loader && (loader.style.display = 'none'),
          (btn.disabled = false));
      }, 1500);
    }));
}
function _pbErr(err) {
  const msg = String((err && err.message) || err);
  if (!msg.includes('Extension context invalidated')) console.warn('PinTwist: scan batch error', err);
}
// DEAD BASE — replaced at load by the perf-hotfix IIFE's `processPinsBulk = async function`
// (viewport-gated bulk overlay renderer). Calls hit the reassigned binding; this base never
// runs. Declaration kept for the strict-mode reassignment target. Body intentionally empty.
async function processPinsBulk() {}
// DEAD BASE — replaced at load by the perf-hotfix IIFE's `initObserver = function`
// (near-viewport + scroll-settle observer). Declaration kept for the strict-mode
// reassignment target. Body intentionally empty.
function initObserver() {}
// DEAD BASE — replaced at load by the perf-hotfix IIFE's `processExisting = function`.
// Declaration kept for the strict-mode reassignment target. Body intentionally empty.
function processExisting() {}
window.sort_all = async function () {
  (document.getElementById('sort-panel')?.remove(),
    document.getElementById('pintwist-initial-bar')?.remove(),
    document.getElementById('pintwist-sorted-container')?.remove(),
    (State.aborted = false),
    applyContentOffset());
  const e = await new Promise((o) => {
      chrome.storage.sync.get(['pintwist_theme_color'], (p) => {
        o(sanitizeThemeColor(p.pintwist_theme_color));
      });
    }),
    t = document.createElement('div');
  t.id = 'pintwist-initial-bar';
  const _i = getPinterestHeaderHeight(),
    n = getPinterestSidebarWidth(),
    s = window.location.hostname.includes('trends.pinterest');
  let _a, _r;
  const m = 15;
  (s ? ((_a = m), (_r = Math.round(window.innerWidth * 0.2))) : ((_a = n + m), (_r = m)),
    (t.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: auto !important;
        z-index: 999999 !important;
        width: ${PINTWIST_DOCK_WIDTH}px !important;
        height: 100vh !important;
        max-height: 100vh !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        background: #ffffff !important;
        border: 0 !important;
        border-right: 1px solid #d7d7d7 !important;
        border-radius: 0 !important;
        padding: 12px 14px !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 8px !important;
        box-shadow: none !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        box-sizing: border-box !important;
    `),
    (t.innerHTML = `
        <div class="pintwist-logo-container" style="display:flex; align-items:center; height:34px; margin:0;">
            <svg class="pintwist-logo-wordmark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0.00 0.00 2959.00 1062.00" style="height:28px; width:auto;">
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 606.29 202.72 A 0.15 0.15 0.0 0 0 606.08 202.86 L 606.08 337.13 A 2.37 2.36 82.7 0 1 604.31 339.42 C 597.59 341.17 590.21 344.19 585.28 345.89 Q 550.45 357.90 534.16 363.39 C 531.76 364.20 528.93 364.83 526.66 365.62 C 502.56 373.99 480.54 381.20 457.22 387.24 A 0.90 0.90 0.0 0 1 456.10 386.37 L 456.10 202.21 A 0.39 0.39 0.0 0 0 455.55 201.86 Q 428.32 214.10 404.51 226.28 Q 381.59 238.00 362.56 252.79 Q 349.75 262.74 341.35 275.06 C 335.39 283.81 333.91 294.26 337.79 304.37 C 340.67 311.86 345.33 317.43 351.32 323.78 Q 354.83 327.50 359.07 330.83 Q 374.56 342.98 385.53 348.96 Q 399.02 356.33 411.69 362.73 A 0.90 0.88 13.8 0 1 412.18 363.52 L 412.18 400.80 A 0.68 0.67 -8.9 0 1 411.71 401.44 C 385.32 409.94 360.46 417.94 333.83 428.08 Q 318.97 433.74 308.47 438.74 Q 306.99 439.45 303.79 439.83 A 1.51 1.47 60.6 0 1 302.66 439.50 C 281.45 422.03 262.57 403.40 248.91 380.41 Q 244.72 373.36 237.42 358.09 Q 224.53 331.16 223.64 301.27 C 223.11 283.05 224.31 265.60 229.47 247.93 Q 238.65 216.44 259.18 190.17 Q 266.52 180.79 275.22 171.47 C 276.57 170.03 277.68 168.13 279.11 166.68 Q 288.38 157.34 291.27 154.76 C 342.93 108.53 408.95 81.53 477.50 72.54 C 551.50 62.83 627.95 73.09 695.49 104.97 C 729.22 120.89 760.01 142.12 785.54 169.46 Q 796.65 181.36 804.51 191.49 C 816.01 206.34 823.65 222.35 831.50 242.25 A 5.32 5.18 33.8 0 1 831.85 243.90 Q 831.92 245.43 832.36 246.90 Q 837.11 262.83 838.34 279.74 Q 838.63 283.76 838.38 302.75 C 838.20 316.59 835.05 333.03 830.07 346.72 Q 816.87 382.98 789.98 411.76 C 777.03 425.63 761.48 439.16 745.21 450.41 C 715.59 470.89 682.67 487.22 649.86 501.59 Q 642.45 504.83 618.91 513.76 C 582.78 527.46 546.46 538.67 507.22 550.33 Q 486.59 556.46 474.77 560.40 Q 453.34 567.56 442.46 570.87 C 429.43 574.84 417.83 579.16 405.79 582.94 C 389.80 587.97 369.14 596.21 357.28 600.82 Q 340.76 607.25 323.06 616.32 C 298.86 628.72 277.28 643.69 261.53 665.02 Q 255.85 672.72 252.65 683.15 A 0.40 0.39 8.6 0 0 253.03 683.66 L 411.62 683.66 A 0.54 0.54 0.0 0 1 412.16 684.20 L 412.16 793.47 A 0.69 0.69 0.0 0 1 411.47 794.16 Q 342.30 794.11 180.00 794.14 Q 176.29 794.14 165.85 792.16 Q 154.23 789.96 144.41 783.63 C 132.32 775.84 123.98 761.05 121.17 747.29 Q 119.16 737.44 119.19 726.75 Q 119.23 707.75 122.76 689.08 Q 126.49 669.40 132.14 652.40 C 139.38 630.63 150.21 609.88 164.70 590.51 C 187.34 560.24 216.78 534.88 249.87 515.64 Q 290.68 491.91 335.87 474.34 Q 379.50 457.38 419.53 445.47 Q 448.26 436.92 450.77 436.12 Q 466.38 431.10 481.96 426.70 C 499.87 421.64 514.36 416.62 532.04 411.22 C 545.65 407.07 558.69 402.09 575.03 396.23 Q 581.61 393.88 592.01 389.66 Q 621.02 377.90 648.06 364.68 Q 648.54 364.44 649.10 363.95 Q 649.67 363.45 650.13 363.21 Q 657.72 359.17 668.73 353.30 Q 680.18 347.19 686.88 342.62 C 698.34 334.82 708.14 327.39 716.58 316.77 Q 722.14 309.76 724.21 303.04 C 727.98 290.74 724.40 280.56 716.31 270.50 Q 710.33 263.07 704.20 257.80 Q 687.44 243.38 664.86 231.14 Q 635.68 215.34 606.29 202.72 Z"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 1658.87 345.16 L 1658.87 473.12 A 0.53 0.53 0.0 0 1 1658.34 473.65 L 1512.26 473.65 A 0.53 0.53 0.0 0 0 1511.73 474.18 L 1511.73 994.04 A 0.53 0.53 0.0 0 1 1511.20 994.57 L 1364.40 994.57 A 0.53 0.53 0.0 0 1 1363.87 994.04 L 1363.87 474.18 A 0.53 0.53 0.0 0 0 1363.34 473.65 L 1222.06 473.65 A 0.53 0.53 0.0 0 1 1221.53 473.12 L 1221.53 345.16 A 0.53 0.53 0.0 0 1 1222.06 344.63 L 1658.34 344.63 A 0.53 0.53 0.0 0 1 1658.87 345.16 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${e}" x="2053.71" y="387.10" width="126.24" height="87.08" rx="0.34"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 2596.95 414.06 L 2723.06 414.06 A 0.61 0.60 90.0 0 1 2723.66 414.67 L 2723.66 548.78 A 0.81 0.81 0.0 0 0 2724.47 549.59 L 2786.21 549.59 A 0.63 0.63 0.0 0 1 2786.84 550.22 L 2786.84 631.63 A 0.43 0.43 0.0 0 1 2786.41 632.06 L 2724.13 632.04 A 0.50 0.49 86.4 0 0 2723.64 632.60 Q 2723.67 632.78 2723.66 861.00 Q 2723.66 869.04 2726.02 876.20 C 2732.10 894.62 2751.39 898.17 2768.26 897.50 Q 2782.37 896.93 2796.22 894.56 A 0.50 0.50 0.0 0 1 2796.81 895.05 L 2796.81 992.57 A 0.60 0.59 86.1 0 1 2796.30 993.16 Q 2752.82 999.93 2711.01 999.11 C 2691.78 998.73 2670.45 995.62 2652.10 988.22 C 2601.22 967.68 2596.61 915.65 2596.61 868.83 Q 2596.63 634.84 2596.63 632.47 A 0.42 0.42 0.0 0 0 2596.21 632.05 L 2553.85 632.05 A 0.37 0.37 0.0 0 1 2553.48 631.68 L 2553.48 550.21 A 0.62 0.62 0.0 0 1 2554.10 549.59 L 2596.14 549.59 A 0.49 0.49 0.0 0 0 2596.63 549.10 L 2596.63 414.39 A 0.33 0.32 -90.0 0 1 2596.95 414.06 Z"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 904.40 549.44 L 1028.50 549.44 A 0.62 0.62 0.0 0 1 1029.12 550.06 L 1029.12 593.36 A 0.33 0.32 -22.9 0 0 1029.68 593.58 C 1060.01 563.04 1099.78 538.48 1144.44 542.17 C 1190.73 546.00 1213.10 584.85 1217.56 627.14 Q 1218.51 636.20 1218.43 653.40 Q 1218.38 666.38 1218.41 994.20 A 0.37 0.37 0.0 0 1 1218.04 994.57 L 1094.24 994.57 A 0.47 0.46 0.0 0 1 1093.77 994.11 Q 1093.78 732.02 1093.77 663.00 C 1093.77 654.62 1092.70 644.52 1087.19 637.64 C 1080.45 629.24 1066.39 629.27 1056.76 632.53 Q 1042.19 637.45 1029.38 646.57 A 0.61 0.60 72.9 0 0 1029.12 647.07 L 1029.12 994.25 A 0.32 0.31 90.0 0 1 1028.81 994.57 L 904.10 994.57 A 0.43 0.42 -0.0 0 1 903.67 994.15 L 903.67 550.17 A 0.73 0.73 0.0 0 1 904.40 549.44 Z"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 2443.38 693.49 A 0.39 0.38 -21.0 0 1 2442.85 693.26 C 2434.62 667.73 2411.94 626.87 2380.16 629.85 C 2369.39 630.86 2360.75 636.59 2357.91 647.44 C 2354.22 661.58 2362.47 674.29 2371.69 684.59 C 2383.49 697.76 2397.51 709.73 2410.73 720.37 C 2427.37 733.75 2442.76 748.12 2459.63 762.54 C 2491.45 789.73 2524.43 822.35 2529.83 866.27 Q 2533.10 892.83 2525.72 917.25 C 2511.54 964.15 2469.10 992.49 2422.47 1000.06 Q 2399.65 1003.76 2373.19 1001.45 Q 2349.94 999.43 2330.46 992.81 C 2298.37 981.91 2273.16 960.38 2254.95 932.04 Q 2242.63 912.87 2233.87 890.94 A 0.41 0.41 0.0 0 1 2234.08 890.42 L 2318.71 853.03 A 0.60 0.59 67.1 0 1 2319.51 853.36 C 2331.61 884.06 2356.36 925.48 2396.36 916.15 C 2412.23 912.45 2416.06 899.23 2412.66 884.47 Q 2410.31 874.30 2402.76 865.24 C 2393.26 853.85 2382.21 844.32 2371.49 835.26 Q 2367.22 831.64 2319.90 792.10 C 2301.98 777.13 2285.28 761.67 2271.21 743.76 Q 2246.43 712.21 2244.04 674.11 Q 2242.61 651.19 2248.40 631.37 C 2263.29 580.40 2311.63 548.70 2362.55 542.88 Q 2384.79 540.33 2407.91 543.89 Q 2456.33 551.35 2488.19 586.99 C 2505.13 605.94 2517.07 630.98 2523.79 656.13 A 0.63 0.62 -19.8 0 1 2523.44 656.86 L 2443.38 693.49 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${e}" x="700.59" y="549.46" width="125.48" height="445.12" rx="0.53"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 1707.96 800.58 L 1742.35 549.80 A 0.42 0.41 -86.0 0 1 1742.76 549.44 L 1832.96 549.44 A 0.44 0.43 86.2 0 1 1833.39 549.82 L 1863.15 806.36 A 0.17 0.17 0.0 0 0 1863.49 806.36 L 1900.89 549.83 A 0.45 0.45 0.0 0 1 1901.34 549.44 L 1997.68 549.44 A 0.35 0.34 -85.7 0 1 1998.02 549.84 L 1931.93 994.18 A 0.45 0.45 0.0 0 1 1931.48 994.57 L 1824.54 994.57 A 0.68 0.67 -3.9 0 1 1823.87 993.99 L 1785.72 745.83 A 0.17 0.17 0.0 0 0 1785.39 745.83 L 1742.60 994.19 A 0.46 0.45 4.4 0 1 1742.15 994.57 L 1636.58 994.57 A 0.48 0.47 85.8 0 1 1636.11 994.16 L 1570.81 549.99 A 0.48 0.48 0.0 0 1 1571.28 549.44 L 1675.17 549.44 A 0.45 0.44 86.3 0 1 1675.61 549.83 L 1707.71 800.58 A 0.13 0.13 0.0 0 0 1707.96 800.58 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${e}" x="2054.54" y="549.45" width="125.40" height="445.12" rx="0.34"/>
                <path class="pintwist-themed-fill" style="fill:${e}" d="M 605.64 566.15 A 0.34 0.34 0.0 0 1 606.08 566.47 Q 606.12 711.52 606.13 870.68 Q 606.13 879.74 605.00 886.24 C 601.84 904.45 595.88 920.87 587.77 938.55 Q 572.46 971.96 550.09 1004.09 Q 542.48 1015.03 531.96 1029.18 A 0.65 0.64 44.1 0 1 530.93 1029.19 Q 522.29 1018.19 510.59 1001.21 Q 492.78 975.36 479.32 948.62 Q 475.01 940.06 472.55 934.18 C 469.06 925.87 466.38 920.52 464.45 914.45 Q 459.88 900.07 457.31 884.43 Q 456.11 877.16 456.11 867.47 Q 456.07 755.78 456.14 613.91 A 1.20 1.19 80.4 0 1 456.94 612.78 C 468.44 608.78 482.28 604.50 502.57 598.50 Q 518.45 593.80 530.48 589.85 C 541.79 586.14 554.86 582.71 567.73 578.51 Q 587.15 572.16 605.64 566.15 Z"/>
            </svg><span style="margin-left:7px;font-size:11px;color:#AAAAAA;letter-spacing:.3px;font-weight:600;align-self:center;">v${chrome.runtime?.getManifest?.().version || ''}</span>
        </div>

        <label class="pintwist-sort-label" style="height:34px; display:flex; align-items:center; color:#555; font-weight:600; font-size:13px; margin:0;">Sort by:</label>
        <div class="custom-dropdown" id="pintwist-initial-dropdown-wrapper" style="display:flex; align-items:center; width:auto; min-width:120px; height:34px; margin:0;">
            <button class="custom-dropdown-btn" id="pintwist-initial-dropdown-btn" type="button" style="height:34px; display:flex; align-items:center; padding:0 12px; background:#FFF; border:1.5px solid #DDD; border-radius:6px; font-size:13px; font-weight:600; color:#555; gap:8px; box-sizing:border-box; cursor:pointer; margin:0;">
                <span class="dropdown-text">Saves</span>
                <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="flex-shrink:0;">
                    <path d="M6 9L1 4h10z"/>
                </svg>
            </button>
            <div class="custom-dropdown-menu" id="pintwist-initial-dropdown-menu">
                <div class="dropdown-item" data-value="saves">Saves</div>
                <div class="dropdown-item" data-value="share">Shares</div>
                <div class="dropdown-item" data-value="reaction">Reactions</div>
                <div class="dropdown-item" data-value="repin">Repins</div>
                <div class="dropdown-item" data-value="comment">Comments</div>
                <div class="dropdown-item" data-value="date">Last activity</div>
            </div>
        </div>
        <input type="hidden" id="pintwist-initial-sort-option" value="saves">

        <label class="pintwist-pages-label" style="height:34px; display:flex; align-items:center; color:#555; font-weight:600; font-size:13px; margin:0;">Pages to load:</label>
        <div class="pintwist-pages-row" style="display:flex; gap:8px; align-items:center; width:100%; margin:0;">
        <input type="number" id="pintwist-pages-input" class="pintwist-pages-input" value="4" min="1" max="50" style="height:34px; width:64px; flex:0 0 64px; padding:0 10px; background:#FFF; border:1.5px solid #DDD; border-radius:6px; font-size:13px; font-weight:600; color:#555; text-align:center; box-sizing:border-box; margin:0;">
        <button id="pintwist-sort-pins-btn" class="pintwist-sort-btn" style="height:34px; flex:1 1 auto; display:flex; align-items:center; justify-content:center; padding:0 16px; background:${e}; color:#FFF; border:none; border-radius:6px; font-weight:700; font-size:12px; cursor:pointer; text-transform:uppercase; box-sizing:border-box; margin:0;">SORT PINS</button>
        </div>

        <div class="pintwist-search-wrapper" style="display:flex; align-items:center; height:34px; margin:0;">
            <input type="text" id="pintwist-search-input-initial" placeholder="Search Pinterest..." style="height:34px; padding:0 12px; border:1.5px solid #DDD; border-right:none; border-radius:16px 0 0 16px; font-size:12px; width:140px; background:#FFF; color:#555; box-sizing:border-box; margin:0;">
            <button id="pintwist-search-btn-initial" style="height:34px; padding:0 12px; border:1.5px solid #DDD; border-left:none; border-radius:0 16px 16px 0; background:#F0F0F0; color:#666; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center; box-sizing:border-box; margin:0;">\u{1F50D}</button>
        </div>

        <label class="pintwist-checkbox-wrapper" style="display:flex; align-items:center; height:34px; gap:6px; cursor:pointer; margin:0;">
            <input type="checkbox" id="pintwist-show-overlays" checked style="width:16px; height:16px; accent-color:${e}; margin:0;">
            <span class="pintwist-checkbox-label" style="color:#555; font-size:12px; font-weight:600;">Show Overlays</span>
        </label>

        <a href="#" id="pintwist-settings-link-initial" class="pintwist-settings-link">Settings</a>
        <div id="pintwist-settings-panel" class="pintwist-settings-panel" hidden>
                <div class="pintwist-settings-row">
                    <label for="pintwist-settings-folder">Download folder</label>
                    <input type="text" id="pintwist-settings-folder" placeholder="PinTwist" autocomplete="off">
                </div>
                <div class="pintwist-settings-hint">Images &amp; CSV save to this folder under your browser's Downloads.</div>
                <button type="button" id="pintwist-settings-done" class="pintwist-settings-done" style="margin-top:8px;width:100%;height:34px;border:none;border-radius:8px;background:var(--pintwist-primary,#F0002D);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">Done</button>
            </div>
        <a href="https://www.youtube.com/watch?v=u9NOn-WJh9I&amp;t=1250s" target="_blank" class="pintwist-tutorial-link" style="height:34px; display:flex; align-items:center; padding:0 12px; background:#EFEFEF; color:#777; font-size:11px; font-weight:600; text-decoration:none; border-radius:4px; margin-left:auto; box-sizing:border-box;">Tutorial</a>
    `),
    document.body.appendChild(t),
    setupInitialBarEvents(t),
    applyContentOffset());
};
function toggleOverlays(e) {
  document.querySelectorAll('.pintwist-metrics-overlay').forEach((i) => {
    i.style.display = e ? '' : 'none';
  });
}
function setupInitialBarEvents(e) {
  const t = document.getElementById('pintwist-initial-dropdown-btn'),
    i = document.getElementById('pintwist-initial-dropdown-menu'),
    n = t.querySelector('.dropdown-text'),
    s = document.getElementById('pintwist-initial-sort-option');
  (t.addEventListener('click', (l) => {
    (l.stopPropagation(), i.classList.toggle('show'));
  }),
    i.querySelectorAll('.dropdown-item').forEach((l) => {
      l.addEventListener('click', (d) => {
        ((s.value = d.target.dataset.value),
          (n.textContent = d.target.textContent),
          i.classList.remove('show'));
      });
    }),
    document.addEventListener('click', (l) => {
      t.contains(l.target) || i.classList.remove('show');
    }));
  const a = document.getElementById('pintwist-search-input-initial'),
    r = document.getElementById('pintwist-search-btn-initial'),
    m = () => {
      const l = a.value.trim();
      l && (window.location.href = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(l)}`);
    };
  (r.addEventListener('click', m),
    a.addEventListener('keypress', (l) => {
      l.key === 'Enter' && m();
    }));
  try {
    if (location.pathname.startsWith('/search/')) {
      const q = new URLSearchParams(location.search).get('q');
      if (q && !a.value) a.value = q;
    }
  } catch {}
  const o = document.getElementById('pintwist-show-overlays');
  (chrome.storage.sync.get(['pintwist_show_overlays'], (l) => {
    const d = l.pintwist_show_overlays !== false;
    ((o.checked = d), toggleOverlays(d));
  }),
    o.addEventListener('change', () => {
      const l = o.checked;
      (chrome.storage.sync.set({ pintwist_show_overlays: l }), toggleOverlays(l));
    }),
    chrome.storage.sync.get(['pintwist_theme_color'], (l) => {
      const d = l.pintwist_theme_color || '#F48FB1';
      applyThemeColor(d);
    }),
    document.getElementById('pintwist-sort-pins-btn').addEventListener('click', async () => {
      const l = parseInt(document.getElementById('pintwist-pages-input').value) || 4,
        d = document.getElementById('pintwist-initial-sort-option').value;
      ((State.pagesToLoad = l), (State.selectedMetric = d), e.remove(), await startSortingProcess(l, d));
    }));
  const settingsLinkInit = document.getElementById('pintwist-settings-link-initial');
  if (settingsLinkInit)
    settingsLinkInit.addEventListener('click', (ev) => {
      ev.preventDefault();
      pintwistToggleSettingsPanel();
    });
  pintwistWireSettingsPanel();
}
// DEAD BASE — replaced at load by the perf-hotfix IIFE's `startSortingProcess = async
// function` (Shadow-DOM scan + progress renderer via installShadowResultsSurface). The old
// light-DOM #pintwist-progress-panel path here never executed; calls hit the reassigned
// binding. Declaration kept for the strict-mode reassignment target. Body empty.
async function startSortingProcess() {}
// finishSort is fully replaced by the Shadow-DOM results renderer in the perf-hotfix
// IIFE below (the `finishSort = function () {...}` reassignment, which builds results
// via createResultCard/installShadowResultsSurface). This base body — the old light-DOM
// #pintwist-sorted-container path — never executed. The declaration is kept (not deleted)
// because that reassignment is an assignment to this binding and the file is in strict
// mode, where assigning to an undeclared name throws. Body intentionally empty.
function finishSort() {}
function reattachListeners() {
  document.querySelectorAll('.pintwist-download-btn').forEach((e) => {
    const t = e.cloneNode(true);
    (e.parentNode.replaceChild(t, e),
      t.addEventListener('click', (i) => {
        (i.preventDefault(), i.stopPropagation(), downloadImage(t.dataset.pinId, t.dataset.imageUrl, t));
      }));
  });
}
function toggleBadges(e) {
  document.querySelectorAll('.pintwist-legacy-badge').forEach((i) => {
    i.style.display = e ? '' : 'none';
  });
}
function applyThemeColor(e) {
  const t = adjustColorBrightness(e, -20);
  (document.documentElement.style.setProperty('--pintwist-primary', e),
    document.documentElement.style.setProperty('--pintwist-primary-dark', t),
    document.querySelectorAll('.pintwist-themed-fill').forEach((a) => {
      a.style.fill = e;
    }),
    document.querySelectorAll('.pintwist-legacy-badge').forEach((a) => {
      a.classList.contains('pintwist-badge-grey') ||
        ((a.style.borderColor = e), (a.style.color = e), (a.style.background = 'rgba(255, 255, 255, 0.9)'));
    }));
  const i = document.getElementById('pintwist-resort-bar');
  i && i.style.setProperty('border-color', e, 'important');
  const n = document.getElementById('pintwist-filter-bar');
  n && n.style.setProperty('border-color', e, 'important');
  const s = document.getElementById('pintwist-initial-bar');
  if (s) {
    if (s.classList.contains('pintwist-is-pill')) {
      (s.style.setProperty('border-color', 'color-mix(in srgb, ' + e + ' 32%, transparent)', 'important'),
        s.style.removeProperty('border-right-color'));
    } else {
      (s.style.setProperty('border-color', 'transparent', 'important'),
        s.style.setProperty('border-right-color', '#d7d7d7', 'important'));
    }
    const a = document.getElementById('pintwist-sort-pins-btn');
    a && (a.style.background = e);
    const r = document.getElementById('pintwist-show-overlays');
    r && (r.style.accentColor = e);
  }
}
function applyUiStyle(e) {
  const t = document.documentElement;
  t &&
    (t.classList.remove(
      'pintwist-ui-style-pinterest-native',
      'pintwist-ui-style-pinterest-glass',
      'pintwist-ui-style-ultra-minimal'
    ),
    t.classList.add(`pintwist-ui-style-${e || 'pinterest-native'}`));
}
function adjustColorBrightness(hex, delta) {
  const int = parseInt(hex.replace('#', ''), 16),
    adj = Math.round(2.55 * delta),
    red = Math.max(0, Math.min(255, (int >> 16) + adj)),
    green = Math.max(0, Math.min(255, ((int >> 8) & 255) + adj)),
    blue = Math.max(0, Math.min(255, (int & 255) + adj));
  return '#' + (16777216 + red * 65536 + green * 256 + blue).toString(16).slice(1);
}
// DEAD BASE — replaced at load by the perf-hotfix IIFE's `setupResortBar = function`
// (Shadow-DOM resort-bar renderer). The intermediate glass-decorator reassignment that
// chained this base was itself overwritten by that shadow version (a previously
// "silently dropped glass decorator") and is removed; its glass styling is applied by
// the live applyThemeColor decorator that runs immediately after setupResortBar() at the
// call site. Declaration kept for the strict-mode reassignment target. Body empty.
function setupResortBar() {}
function setupSearchBar() {
  const e = document.getElementById('pintwist-search-input'),
    t = document.getElementById('pintwist-search-btn');
  if (!e || !t) return;
  try {
    if (location.pathname.startsWith('/search/')) {
      const q = new URLSearchParams(location.search).get('q');
      if (q && !e.value) e.value = q;
    }
  } catch {}
  const i = () => {
    const n = e.value.trim();
    n && (window.location.href = `${window.location.origin}/search/pins/?q=${encodeURIComponent(n)}`);
  };
  (t.addEventListener('click', i),
    e.addEventListener('keypress', (n) => {
      n.key === 'Enter' && i();
    }));
}
function resortPins(e) {
  const t = document.getElementById('pintwist-sorted-container');
  if (!t) return;
  const i = Array.from(t.querySelectorAll('.pinterest--block'));
  (i.forEach((s) => {
    const a = s.dataset.pinId || s.getAttribute('data-test-pin-id');
    if (!a) return;
    const r = getCached(a);
    if (!r) return;
    let m, o;
    (e === 'date'
      ? ((m = new Date(r.createdAt).getTime() || 0),
        (o = new Date(r.createdAt).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })))
      : ((m = { saves: r.saves, share: r.shares, reaction: r.reactions, repin: r.repins, comment: r.comments }[e] || 0),
        (o = `${e.charAt(0).toUpperCase() + e.slice(1)}: ${formatNumber(m)}`)),
      s.setAttribute('rel', m));
    const p = s.querySelector('.pintwist-legacy-badge');
    p && (p.textContent = o);
  }),
    i.sort((s, a) => (parseInt(a.getAttribute('rel')) || 0) - (parseInt(s.getAttribute('rel')) || 0)),
    (t.innerHTML = ''),
    i.forEach((s) => t.appendChild(s)),
    reattachListeners());
  const n = document.querySelector('#pintwist-resort-bar .resort-info');
  n &&
    (n.innerHTML = `<svg class="sorted-icon" width="14" height="14" viewBox="0 0 24 24" fill="#8e8e8e" style="vertical-align: middle; margin-right: 4px; margin-bottom: 2px;"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg>${i.length} PINS SORTED BY PINTWIST`);
}
function calculateFilterRanges(e) {
  const t = new Set();
  e.forEach((n) => {
    const s = n.dataset.pinId;
    s && State.metricsCache.has(s) && t.add(s);
  });
  const i = {
    saves: { min: 1 / 0, max: -1 / 0 },
    comments: { min: 1 / 0, max: -1 / 0 },
    repins: { min: 1 / 0, max: -1 / 0 },
    reactions: { min: 1 / 0, max: -1 / 0 },
    shares: { min: 1 / 0, max: -1 / 0 },
    date: { min: 1 / 0, max: -1 / 0 },
  };
  for (const n of t) {
    const s = State.metricsCache.get(n);
    if (
      ((i.saves.min = Math.min(i.saves.min, s.saves)),
      (i.saves.max = Math.max(i.saves.max, s.saves)),
      (i.comments.min = Math.min(i.comments.min, s.comments)),
      (i.comments.max = Math.max(i.comments.max, s.comments)),
      (i.repins.min = Math.min(i.repins.min, s.repins)),
      (i.repins.max = Math.max(i.repins.max, s.repins)),
      (i.reactions.min = Math.min(i.reactions.min, s.reactions)),
      (i.reactions.max = Math.max(i.reactions.max, s.reactions)),
      (i.shares.min = Math.min(i.shares.min, s.shares)),
      (i.shares.max = Math.max(i.shares.max, s.shares)),
      s.createdAt)
    ) {
      let a;
      if (
        (typeof s.createdAt == 'number' ? (a = s.createdAt) : (a = new Date(s.createdAt).getTime()), a && !isNaN(a))
      ) {
        const m = new Date(new Date(a).toISOString().split('T')[0]).getTime();
        ((i.date.min = Math.min(i.date.min, m)), (i.date.max = Math.max(i.date.max, m)));
      }
    }
  }
  if (i.date.min === 1 / 0 || i.date.max === -1 / 0) {
    console.warn('PinTwist: No valid dates found in pins, using defaults');
    const n = new Date(),
      s = new Date();
    (s.setFullYear(n.getFullYear() - 1),
      (i.date.min = new Date(s.toISOString().split('T')[0]).getTime()),
      (i.date.max = new Date(n.toISOString().split('T')[0]).getTime()));
  }
  return ((State.filterRanges = i), (State.activeFilters = JSON.parse(JSON.stringify(i))), i);
}
function parseFilterValue(e) {
  if (!e) return null;
  const t = e.toString().toUpperCase();
  return t.includes('M') ? parseFloat(t) * 1e6 : t.includes('K') ? parseFloat(t) * 1e3 : parseFloat(t) || 0;
}
function applyFilters() {
  const e = (p, l) => {
      if (!p) return l;
      const h = new Date(p).getTime();
      return isNaN(h) ? l : h;
    },
    t = {
      saves: {
        min: parseFilterValue(document.getElementById('filter-saves-min').value),
        max: parseFilterValue(document.getElementById('filter-saves-max').value),
      },
      comments: {
        min: parseFilterValue(document.getElementById('filter-comments-min').value),
        max: parseFilterValue(document.getElementById('filter-comments-max').value),
      },
      repins: {
        min: parseFilterValue(document.getElementById('filter-repins-min').value),
        max: parseFilterValue(document.getElementById('filter-repins-max').value),
      },
      reactions: {
        min: parseFilterValue(document.getElementById('filter-reactions-min').value),
        max: parseFilterValue(document.getElementById('filter-reactions-max').value),
      },
      shares: {
        min: parseFilterValue(document.getElementById('filter-shares-min').value),
        max: parseFilterValue(document.getElementById('filter-shares-max').value),
      },
      date: {
        min: e(document.getElementById('filter-date-min').value, 0),
        max: e(document.getElementById('filter-date-max').value, Date.now()) + 86399999,
      },
    };
  State.activeFilters = t;
  const i = document.getElementById('pintwist-sorted-container');
  if (!i) return;
  document.querySelector('.pintwist-filter-separator')?.remove();
  const n = Array.from(i.querySelectorAll('.pinterest--block')),
    s = [],
    a = [];
  n.forEach((p) => {
    const l = p.dataset.pinId,
      d = getCached(l);
    if (!d) return;
    const h = new Date(d.createdAt).getTime(),
      // Only exclude on date when the pin HAS a parseable date. Pinterest often omits
      // created_at, and new Date(null/'')=epoch-0/NaN — treating those as "before the
      // min" would silently hide every undated pin the moment any filter is touched.
      // An undated pin passes the date check and is judged on the other metrics only.
      hasDate = d.createdAt != null && !isNaN(h),
      dateOk = !hasDate || (h >= t.date.min && h <= t.date.max),
      f =
        d.saves >= t.saves.min &&
        d.saves <= t.saves.max &&
        d.comments >= t.comments.min &&
        d.comments <= t.comments.max &&
        d.repins >= t.repins.min &&
        d.repins <= t.repins.max &&
        d.reactions >= t.reactions.min &&
        d.reactions <= t.reactions.max &&
        d.shares >= t.shares.min &&
        d.shares <= t.shares.max &&
        dateOk,
      c = p.querySelector('.pintwist-legacy-badge');
    f
      ? (s.push(p), c && c.classList.remove('pintwist-badge-grey'), p.style.removeProperty('display'))
      : (a.push(p), c && c.classList.add('pintwist-badge-grey'), p.style.setProperty('display', 'none', 'important'));
  });
  const r = State.selectedMetric,
    m = (p, l) => {
      const d = getCached(p.dataset.pinId),
        h = getCached(l.dataset.pinId);
      if (!d || !h) return 0;
      let f, c;
      if (r === 'date') ((f = new Date(d.createdAt).getTime()), (c = new Date(h.createdAt).getTime()));
      else {
        const g = { saves: 'saves', comment: 'comments', repin: 'repins', reaction: 'reactions', share: 'shares' }[r];
        ((f = d[g] || 0), (c = h[g] || 0));
      }
      return c - f;
    };
  // Matching pins first (visible), then the non-matching pins appended but hidden
  // (display:none, set in the partition above). They stay in the DOM so relaxing the
  // filter restores them without a re-scan, but they no longer render — the results
  // grid has no greying/badge, so the previous "show them below a separator" path just
  // looked like the filter did nothing. The "N/total PINS SORTED" count below reports
  // how many matched. (date-filter bug)
  s.sort(m);
  a.sort(m);
  i.innerHTML = '';
  s.forEach((p) => i.appendChild(p));
  a.forEach((p) => i.appendChild(p));
  const o = document.getElementById('pintwist-match-count');
  (o &&
    (o.innerHTML = `<svg class="sorted-icon" width="14" height="14" viewBox="0 0 24 24" fill="#8e8e8e" style="vertical-align: middle; margin-right: 4px; margin-bottom: 2px;"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg>${s.length}/${n.length} PINS SORTED BY PINTWIST`),
    reattachListeners(),
    chrome.storage.local.set({ pintwist_active_filters: t }),
    updateActiveFiltersDisplay());
}
function resetFilters() {
  State.filterRanges &&
    ((document.getElementById('filter-saves-min').value = State.filterRanges.saves.min),
    (document.getElementById('filter-saves-max').value = State.filterRanges.saves.max),
    (document.getElementById('filter-comments-min').value = State.filterRanges.comments.min),
    (document.getElementById('filter-comments-max').value = State.filterRanges.comments.max),
    (document.getElementById('filter-repins-min').value = State.filterRanges.repins.min),
    (document.getElementById('filter-repins-max').value = State.filterRanges.repins.max),
    (document.getElementById('filter-reactions-min').value = State.filterRanges.reactions.min),
    (document.getElementById('filter-reactions-max').value = State.filterRanges.reactions.max),
    (document.getElementById('filter-shares-min').value = State.filterRanges.shares.min),
    (document.getElementById('filter-shares-max').value = State.filterRanges.shares.max),
    (document.getElementById('filter-date-min').value = new Date(State.filterRanges.date.min)
      .toISOString()
      .split('T')[0]),
    (document.getElementById('filter-date-max').value = new Date(State.filterRanges.date.max)
      .toISOString()
      .split('T')[0]),
    resizeAllFilterInputs(),
    applyFilters());
}
function resizeAllFilterInputs() {
  document.querySelectorAll('.filter-input').forEach((e) => {
    const i = (e.value || e.placeholder || '0').length,
      n = Math.max(40, Math.min(100, i * 8 + 16));
    e.style.width = n + 'px';
  });
}
function setupFilterBar() {
  const e = document.getElementById('pintwist-filter-toggle'),
    t = document.getElementById('pintwist-filter-bar'),
    i = document.getElementById('pintwist-reset-all-filters');
  let n = null;
  const s = (r) => {
    const o = (r.value || r.placeholder || '0').length,
      p = Math.max(40, Math.min(100, o * 8 + 16));
    r.style.width = p + 'px';
  };
  (document.querySelectorAll('.filter-input').forEach((r) => {
    (s(r),
      r.addEventListener('input', (m) => {
        (s(m.target),
          clearTimeout(n),
          (n = setTimeout(() => {
            applyFilters();
          }, 1e3)));
      }),
      r.addEventListener('keypress', (m) => {
        m.key === 'Enter' && (clearTimeout(n), applyFilters());
      }));
  }),
    setupDateFilterEnhancements(),
    e?.addEventListener('click', () => {
      (t.classList.toggle('pintwist-filter-expanded'),
        (e.textContent = t.classList.contains('pintwist-filter-expanded') ? '\u25BC Filters' : '\u25B6 Filters'));
    }),
    i?.addEventListener('click', resetFilters));
}
function updateActiveFiltersDisplay() {
  if (!State.filterRanges || !State.activeFilters) return;
  document.querySelectorAll('.filter-pills-container').forEach((n) => {
    n.innerHTML = '';
  });
  const e = (n) => {
      const s = document.getElementById(`filter-${n}-min`),
        a = document.getElementById(`filter-${n}-max`);
      if (!s || !a) return false;
      if (n === 'date') {
        const r = new Date(State.filterRanges.date.min).toISOString().split('T')[0],
          m = new Date(State.filterRanges.date.max).toISOString().split('T')[0],
          o = s.value && s.value !== r,
          p = a.value && a.value !== m;
        return o || p;
      } else {
        const r = State.filterRanges[n].min,
          m = State.filterRanges[n].max,
          o = s.value.trim() ? parseFilterValue(s.value) : r,
          p = a.value.trim() ? parseFilterValue(a.value) : m;
        return o !== r || p !== m;
      }
    },
    t = (n) => {
      const s = document.querySelector(`.filter-pills-container[data-metric="${n}"]`);
      if (!s) return;
      const a = document.createElement('div');
      ((a.className = 'filter-pill filter-reset-pill'),
        (a.innerHTML = `
            <div class="filter-pill-remove">\xD7</div>
        `),
        s.appendChild(a),
        a.querySelector('.filter-pill-remove').addEventListener('click', (r) => {
          (r.stopPropagation(), resetMetricFilter(n));
        }));
    };
  ['saves', 'comments', 'repins', 'reactions', 'shares', 'date'].forEach((n) => {
    e(n) && t(n);
  });
}
function resetMetricFilter(e) {
  State.filterRanges &&
    (e === 'date'
      ? ((document.getElementById(`filter-${e}-min`).value = new Date(State.filterRanges.date.min)
          .toISOString()
          .split('T')[0]),
        (document.getElementById(`filter-${e}-max`).value = new Date(State.filterRanges.date.max)
          .toISOString()
          .split('T')[0]))
      : ((document.getElementById(`filter-${e}-min`).value = State.filterRanges[e].min),
        (document.getElementById(`filter-${e}-max`).value = State.filterRanges[e].max)),
    resizeAllFilterInputs(),
    applyFilters());
}
// ===== Extension-context guard =====
// When the extension is reloaded/updated, this already-running content script's
// context is invalidated and every chrome.* call throws "Extension context
// invalidated". That's expected on an already-open tab (a fresh load runs clean).
// Detect it, tear down our recurring timers/observer so we stop trying, and
// swallow the console noise instead of leaking uncaught rejections.
function pintwistContextAlive() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}
function pintwistTeardownDeadContext() {
  try {
    if (State && State.urlCheckInterval) clearInterval(State.urlCheckInterval);
  } catch {}
  try {
    if (State && State.observer && State.observer.disconnect) State.observer.disconnect();
  } catch {}
  // Release the full-screen results overlay too: it scroll-locks <html>
  // (overflow:hidden), mounts #pintwist-host, installs resize listeners and the
  // document-lookup monkey-patch. Without this, an extension reload while results
  // are up leaves the orphaned page frozen (can't scroll) until a full reload.
  try {
    window.__pintwistHideShadowResults?.();
  } catch {}
  // Surface a VISIBLE reason in the automation panel. chrome.* is dead here, but plain DOM
  // still works — so a reload-orphaned tab shows why automation stopped (and how to resume)
  // instead of silently going idle with no message.
  try {
    const cd = document.getElementById('pintwist-auto-countdown');
    if (cd)
      cd.innerHTML =
        '<span class="pintwist-auto-cd--off">Stopped — extension reloaded · refresh this tab to resume</span>';
    console.warn(
      '[PinTwist Automation] stopped — extension context invalidated (the extension was reloaded/updated). Refresh this tab to resume the queue.'
    );
  } catch {}
}
(function pintwistInstallContextGuard() {
  // An orphaned content script (the extension was reloaded / updated / disabled) loses
  // chrome.*, so the next chrome call throws "Cannot read properties of undefined (reading
  // 'local'/'sync'/'runtime')" — NOT the "context invalidated" string, so the old text-only
  // match missed that shape and it surfaced as an uncaught error/rejection. Treat ANY error
  // as a context error once the context is actually dead, so reload/auto-update orphans are
  // always swallowed gracefully; a live context still matches only the strings, so genuine
  // bugs keep surfacing.
  const isCtxErr = (m) =>
    (typeof m === 'string' && /context invalidated|extension context/i.test(m)) ||
    !pintwistContextAlive();
  const reasonText = (r) => (r == null ? '' : typeof r === 'string' ? r : r.message || '');
  window.addEventListener('unhandledrejection', (ev) => {
    if (isCtxErr(reasonText(ev && ev.reason))) {
      ev.preventDefault();
      pintwistTeardownDeadContext();
    }
  });
  window.addEventListener(
    'error',
    (ev) => {
      if (isCtxErr((ev && ev.message) || reasonText(ev && ev.error))) {
        ev.preventDefault();
        pintwistTeardownDeadContext();
      }
    },
    true
  );
})();
function startUrlMonitor() {
  (window.addEventListener('popstate', handleUrlChange),
    window.addEventListener('hashchange', handleUrlChange),
    (State.urlCheckInterval = setInterval(() => {
      if (!pintwistContextAlive()) {
        clearInterval(State.urlCheckInterval);
        return;
      }
      window.location.href !== State.currentUrl && handleUrlChange();
    }, 2e3)));
}
function handleUrlChange() {
  window.location.href !== State.currentUrl &&
    ((State.aborted = true),
    // Tear down the results overlay before re-init. clearState() only resets scan
    // bookkeeping; it does NOT release the scroll-lock, #pintwist-host, resize
    // listeners, or the document-lookup patch. On SPA/Back navigation while results
    // are showing, skipping this leaves the page scroll-locked until a full reload.
    (() => {
      try {
        window.__pintwistHideShadowResults?.();
      } catch {}
    })(),
    clearState(),
    (State.currentUrl = window.location.href),
    State.currentUrl.includes('pinterest') && setTimeout(init, 1e3));
}
function clearState() {
  (State.loadedIDs.clear(),
    State.processingIDs.clear(),
    State.sortedPinIDs.clear(),
    (State.insertedNodes = []),
    (State.count = 0),
    State.timeout && clearTimeout(State.timeout),
    State.observer && (State.observer.disconnect(), (State.observer = null)));
}
chrome.runtime.onMessage.addListener((e, _t, _i) => {
  if (location.href.includes('pinterest'))
    try {
      e.action === 'enableBar'
        ? document.getElementById('pintwist-initial-bar') ||
          document.getElementById('pintwist-resort-bar') ||
          window.sort_all()
        : e.action === 'disableBar'
          ? hideBar()
          : e.action === 'showOverlays'
            ? toggleOverlays(true)
            : e.action === 'hideOverlays'
              ? toggleOverlays(false)
              : e.action === 'updateThemeColor'
                ? applyThemeColor(sanitizeThemeColor(e.data))
                : e.action === 'updateUiStyle' && applyUiStyle(e.data);
    } catch (n) {
      console.warn('PinTwist: Message handler error', n);
    }
});
function hideBar() {
  try {
    window.__pintwistHideShadowResults?.();
  } catch {}
  const e = document.getElementById('pintwist-initial-bar'),
    t = document.getElementById('pintwist-resort-bar'),
    i = document.getElementById('pintwist-filter-bar'),
    n = document.getElementById('newgrid');
  (e && e.remove(), t && t.remove(), i && i.remove(), n && n.remove(), removeContentOffset(), (State.aborted = true));
}
async function checkAuth() {
  return true;
}
let _initHasRun = false;
async function init() {
  if (!location.href.includes('pinterest')) return;
  if (!(await checkAuth())) {
    return;
  }
  ((_initHasRun = true),
    extractConfig(),
    State.metricsCache.size || (await loadCache()),
    State.urlCheckInterval || startUrlMonitor(),
    setTimeout(() => {
      (processExisting(), initObserver());
    }, 1500),
    chrome.storage.sync.get(['pintwist_enabled'], (t) => {
      if (t.pintwist_enabled === false) return;
      // A fixed 2s lets Pinterest's app shell render so the pill positions correctly.
      setTimeout(() => window.sort_all(), 2e3);
    }));
}
(window.addEventListener('beforeunload', saveCache),
  document.readyState === 'complete' || document.readyState === 'interactive'
    ? init()
    : window.addEventListener('load', init));

const PINTWIST_CATALOG_KEY = 'pintwist_catalog_rows';
const PINTWIST_CATALOG_MAX_ROWS = 5000; // default auto-export threshold
const PINTWIST_AUTOEXPORT_KEY = 'pintwist_autoexport_enabled';
const PINTWIST_AUTOEXPORT_N_KEY = 'pintwist_autoexport_threshold';
// User-configurable (⚙ settings): auto-download the accumulated catalog to CSV + reset
// once it reaches N pins. When disabled, the catalog just keeps accumulating (export
// manually with ⤓ CSV). Cached here + kept fresh via storage.onChanged.
let __pintwistAutoexportEnabled = true;
let __pintwistAutoexportN = PINTWIST_CATALOG_MAX_ROWS;
function pintwistLoadAutoexportPrefs() {
  try {
    chrome.storage.sync.get(
      { [PINTWIST_AUTOEXPORT_KEY]: true, [PINTWIST_AUTOEXPORT_N_KEY]: PINTWIST_CATALOG_MAX_ROWS },
      (r) => {
        __pintwistAutoexportEnabled = r[PINTWIST_AUTOEXPORT_KEY] !== false;
        const n = Number(r[PINTWIST_AUTOEXPORT_N_KEY]);
        __pintwistAutoexportN = Number.isFinite(n) && n > 0 ? n : PINTWIST_CATALOG_MAX_ROWS;
      }
    );
    if (chrome.storage.onChanged && !pintwistLoadAutoexportPrefs._wired) {
      pintwistLoadAutoexportPrefs._wired = true;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (changes[PINTWIST_AUTOEXPORT_KEY]) __pintwistAutoexportEnabled = changes[PINTWIST_AUTOEXPORT_KEY].newValue !== false;
        if (changes[PINTWIST_AUTOEXPORT_N_KEY]) {
          const v = Number(changes[PINTWIST_AUTOEXPORT_N_KEY].newValue);
          __pintwistAutoexportN = Number.isFinite(v) && v > 0 ? v : PINTWIST_CATALOG_MAX_ROWS;
        }
      });
    }
  } catch {
    /* non-fatal */
  }
}
try {
  pintwistLoadAutoexportPrefs();
} catch {}
let __pintwistCatalogPendingRows = [];
let __pintwistCatalogSaveTimer = null;

function pintwistCsvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // Neutralize spreadsheet formula injection: attacker-controlled pin text (title,
  // description, etc.) starting with = + - @ (or tab/CR) would execute as a formula
  // when the CSV is opened in Excel/Sheets. Prefix a single quote to force text.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

// SINGLE source of truth for the automation-panel inner layout (one-row controls +
// wrapping queue pills). Injected into BOTH the live "glass" stylesheet and the results
// surface stylesheet so the two contexts can never drift apart again. `s` is the scope
// prefix: high-specificity on the live page (to beat older glass rules), empty on the
// isolated results surface (no competition there). The var() fallbacks resolve to the same solid colors
// in both contexts.
function pintwistAutoLayoutCss(s) {
  return `
      ${s}#pintwist-auto-body{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:8px 10px!important}
      ${s}#pintwist-auto-body > *{flex:0 0 100%!important}
      ${s}#pintwist-auto-body .pintwist-auto-master-row{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;gap:8px!important;width:100%!important;flex:1 1 100%!important;margin:0!important;padding:0!important;border:0!important;grid-template-columns:none!important}
      ${s}#pintwist-auto-body .pintwist-auto-actions{display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;gap:8px!important;width:auto!important;flex:0 0 auto!important;margin:0!important;padding:0!important;border:0!important;grid-template-columns:none!important}
      ${s}#pintwist-auto-body .pintwist-auto-master-row .pintwist-auto-catalog-btn{margin-left:auto!important;width:auto!important;flex:0 0 auto!important}
      ${s}#pintwist-auto-body .pintwist-auto-master-row > *,
      ${s}#pintwist-auto-body .pintwist-auto-actions > *{flex:0 0 auto!important;width:auto!important;min-width:0!important}
      ${s}#pintwist-auto-body .pintwist-auto-divider{display:none!important}
      ${s}#pintwist-auto-body .pintwist-auto-inline-field{display:grid!important;grid-template-columns:minmax(0,1fr) 92px!important;align-items:center!important;gap:10px!important;min-height:34px!important;background:transparent!important;border:0!important;padding:0!important;color:var(--pt-text,#0f172a)!important;font-size:13px!important;font-weight:750!important;text-transform:none!important;letter-spacing:0!important}
      ${s}#pintwist-auto-body .pintwist-auto-checkbox{display:grid!important;grid-template-columns:22px minmax(0,1fr) 92px 18px!important;align-items:center!important;gap:8px!important;min-height:34px!important;background:transparent!important;border:0!important;padding:0!important;color:var(--pt-text,#0f172a)!important;font-size:13px!important;font-weight:750!important;text-transform:none!important;letter-spacing:0!important}
      ${s}#pintwist-auto-body .pintwist-auto-checkbox > input[type="checkbox"]{width:16px!important;height:16px!important;min-height:16px!important;margin:0!important;accent-color:var(--pintwist-primary,#F0002D)!important;background:#fff!important;border:1px solid var(--pt-line-strong,#cfd2d7)!important;border-radius:4px!important}
      ${s}#pintwist-auto-body .pintwist-auto-num-wrap{display:grid!important;grid-template-columns:minmax(0,1fr) 26px!important;align-items:stretch!important;width:92px!important;height:34px!important;min-height:34px!important;background:var(--pt-field-strong,#e9eaed)!important;border:1px solid var(--pt-line-strong,#cfd2d7)!important;border-radius:8px!important;overflow:hidden!important}
      ${s}#pintwist-auto-body .pintwist-auto-num--xs{width:auto!important}
      ${s}#pintwist-auto-body input.pintwist-auto-num{width:100%!important;min-width:0!important;height:34px!important;margin:0!important;padding:0 8px!important;line-height:normal!important;text-align:center!important;border:0!important;background:transparent!important;box-shadow:none!important;outline:0!important;font-size:13px!important;font-weight:850!important;color:var(--pt-text,#0f172a)!important}
      ${s}#pintwist-auto-body .pintwist-auto-num-spin{display:grid!important;grid-template-rows:1fr 1fr!important;width:26px!important;height:100%!important;border-left:1px solid var(--pt-line,#e2e4e8)!important}
      ${s}#pintwist-auto-body .pintwist-auto-num-up,${s}#pintwist-auto-body .pintwist-auto-num-down{min-height:0!important;height:18px!important;width:26px!important;margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;color:var(--pt-muted,#6b7280)!important;font-size:9px!important;line-height:17px!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;box-shadow:none!important}
      ${s}#pintwist-auto-body .pintwist-auto-num-up{border-bottom:1px solid var(--pt-line,#e2e4e8)!important}
      ${s}#pintwist-auto-body .pintwist-auto-switch{display:grid!important;grid-template-columns:44px minmax(0,1fr)!important;align-items:center!important;gap:10px!important;min-height:34px!important;background:transparent!important;border:0!important;padding:0!important;color:var(--pt-text,#0f172a)!important}
      ${s}#pintwist-auto-body .pintwist-auto-switch > input[type="checkbox"]{position:absolute!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;min-height:0!important;margin:0!important;padding:0!important}
      ${s}#pintwist-auto-body .pintwist-auto-switch-track{position:relative!important;grid-column:1!important;grid-row:1!important;width:44px!important;height:24px!important;background:var(--pt-field-strong,#e9eaed)!important;border:1px solid var(--pt-line-strong,#cfd2d7)!important;border-radius:999px!important;overflow:hidden!important}
      ${s}#pintwist-auto-body .pintwist-auto-switch-thumb{position:absolute!important;width:18px!important;height:18px!important;top:2px!important;left:2px!important;background:#fff!important;border-radius:999px!important;transform:translateX(0)!important;transition:transform .2s ease!important;box-shadow:0 1px 2px rgba(0,0,0,.25)!important}
      ${s}#pintwist-auto-body .pintwist-auto-switch input:checked + .pintwist-auto-switch-track{background:var(--pt-green,var(--pintwist-primary,#16a34a))!important;border-color:var(--pt-green,var(--pintwist-primary,#16a34a))!important}
      ${s}#pintwist-auto-body .pintwist-auto-switch input:checked + .pintwist-auto-switch-track .pintwist-auto-switch-thumb{left:2px!important;transform:translateX(20px)!important}
      ${s}#pintwist-auto-body .pintwist-auto-switch-label{grid-column:2!important;grid-row:1!important;color:var(--pt-text,#0f172a)!important;font-size:13px!important;font-weight:750!important;line-height:1.2!important}
      ${s}#pintwist-auto-body .pintwist-auto-actions .pintwist-auto-btn{width:auto!important;min-height:34px!important;height:34px!important;padding:0 12px!important;line-height:1!important;white-space:nowrap!important}
      ${s}#pintwist-auto-body .pintwist-auto-master-row .pintwist-auto-btn,${s}#pintwist-auto-body .pintwist-auto-master-row label{min-height:34px!important;line-height:1!important}
      ${s}#pintwist-auto-queue{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;justify-content:flex-start!important;align-content:flex-start!important;gap:8px!important;align-items:center!important;width:100%!important;max-height:34vh!important;overflow-y:auto!important;margin:10px 0 4px 0!important;padding:12px 0 0 0!important;border-top:1px solid var(--pt-line-strong,#cfd2d7)!important;list-style:none!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-row{display:inline-flex!important;flex:0 0 auto!important;align-items:center!important;gap:6px!important;width:auto!important;max-width:none!important;min-height:0!important;padding:4px 6px 4px 12px!important;border-radius:999px!important;background:var(--pt-field-strong,#e9eaed)!important;border:1px solid var(--pt-line-strong,#cfd2d7)!important;font-size:12px!important;font-weight:700!important;color:var(--pt-text,#0f172a)!important;box-shadow:none!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-row--done{background:color-mix(in srgb, var(--pintwist-primary,#F0002D) 14%, #ffffff)!important;border-color:var(--pintwist-primary,#F0002D)!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-row--current{border-color:var(--pintwist-primary,#F0002D)!important;box-shadow:0 0 0 2px color-mix(in srgb, var(--pintwist-primary,#F0002D) 30%, #ffffff)!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-term{white-space:nowrap!important;max-width:160px!important;overflow:hidden!important;text-overflow:ellipsis!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-row--done .pintwist-auto-queue-term{opacity:.7!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-badge{display:inline-flex!important;align-items:center!important;gap:4px!important;margin-left:2px!important;font-size:11px!important;font-weight:800!important;line-height:1!important;white-space:nowrap!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-badge--done{color:var(--pintwist-primary,#F0002D)!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-badge--failed{color:#e11!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-badge--cancelled{color:#888!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-badge--current{color:var(--pintwist-primary,#F0002D)!important}
      ${s}#pintwist-auto-queue .pintwist-auto-queue-csv{display:inline-flex!important;align-items:center!important;padding:1px 5px!important;border-radius:999px!important;background:var(--pintwist-primary,#F0002D)!important;color:#fff!important;font-size:10px!important;font-weight:800!important;letter-spacing:.2px!important}
      ${s}#pintwist-auto-queue .pintwist-auto-pill-play,
      ${s}#pintwist-auto-queue .pintwist-auto-pill-x{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:22px!important;height:22px!important;min-height:0!important;padding:0!important;border-radius:999px!important;line-height:1!important;cursor:pointer!important;border:0!important;flex:0 0 auto!important}
      ${s}#pintwist-auto-queue .pintwist-auto-pill-play{background:var(--pintwist-primary,#F0002D)!important;color:#ffffff!important;font-size:10px!important}
      ${s}#pintwist-auto-queue .pintwist-auto-pill-x{background:#ffffff!important;color:#888!important;font-size:15px!important;border:1px solid var(--pt-line-strong,#cfd2d7)!important}
      ${s}#pintwist-auto-queue .pintwist-auto-pill-x:hover{color:#e11!important;border-color:#e11!important}
      ${s}#pintwist-auto-body .pintwist-auto-btn{min-height:34px!important;height:34px!important;width:100%!important;border-radius:8px!important;border:1px solid var(--pt-line-strong,#cfd2d7)!important;background:var(--pt-field,#f0f1f3)!important;color:var(--pt-text,#0f172a)!important;font-family:var(--pt-font-body)!important;font-size:13px!important;font-weight:800!important;text-transform:none!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)!important}
      ${s}#pintwist-auto-body .pintwist-auto-btn--primary{background:var(--pt-green,#4ade80)!important;border-color:color-mix(in srgb, var(--pt-green,#4ade80) 55%, rgba(255,255,255,.2))!important;color:#06120c!important;box-shadow:0 0 20px var(--pt-glow-green,transparent), inset 0 1px 0 rgba(255,255,255,.28)!important}
      ${s}#pintwist-auto-body #pintwist-auto-off{background:var(--pt-danger-bg,rgba(248,113,113,.16))!important;border-color:var(--pt-danger-border,rgba(248,113,113,.45))!important;color:var(--pt-danger-text,#fecaca)!important}
      ${s}#pintwist-auto-body #pintwist-auto-clear{background:transparent!important;border:1px solid var(--pt-line-strong,#cfd2d7)!important;color:var(--pt-muted,#5c6270)!important}
      ${s}#pintwist-auto-body .pintwist-auto-stats,${s}#pintwist-auto-body .pintwist-auto-countdown{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:34px!important;padding:0 10px!important;background:var(--pt-field,#f0f1f3)!important;border:1px solid var(--pt-line,#e1e3e6)!important;border-radius:8px!important;color:var(--pt-muted,#5c6270)!important;font-size:12px!important;font-weight:750!important;white-space:nowrap!important}`;
}

function pintwistLightThemeTokenCss(selector) {
  return `
      ${selector}{
        --pt-rail-bg:#f8fafc;
        --pt-panel:#ffffff;
        --pt-panel-strong:#ffffff;
        --pt-field:#f0f1f3;
        --pt-field-strong:#e9eaed;
        --pt-line:#e1e3e6;
        --pt-line-strong:#cfd2d7;
        --pt-text:#0f172a;
        --pt-muted:#5c6270;
        --pt-faint:#8b909c;
        --pt-green:var(--pintwist-primary,#4ade80);
        --pt-blue:#60a5fa;
        --pt-red:#f87171;
        --pt-glow-green:color-mix(in srgb, var(--pt-green) 18%, transparent);
        --pt-glow-blue:rgba(37,99,235,.18);
        --pt-secondary-bg:color-mix(in srgb, var(--pt-green) 10%, #ffffff);
        --pt-secondary-bg-hover:color-mix(in srgb, var(--pt-green) 16%, #ffffff);
        --pt-secondary-border:color-mix(in srgb, var(--pt-green) 38%, rgba(15,23,42,.18));
        --pt-secondary-text:#0f172a;
        --pt-disabled-bg:rgba(15,23,42,.045);
        --pt-disabled-border:rgba(15,23,42,.13);
        --pt-disabled-text:rgba(15,23,42,.58);
        --pt-danger-bg:rgba(220,38,38,.10);
        --pt-danger-border:rgba(220,38,38,.34);
        --pt-danger-text:#991b1b;
        --pt-font-body:'DM Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        --pt-font-heading:'Syne','DM Sans',system-ui,sans-serif;
      }`;
}

function pintwistCurrentSearchTerm() {
  try {
    const url = new URL(location.href);
    return url.pathname.startsWith('/search/') ? url.searchParams.get('q') : null;
  } catch {
    return null;
  }
}

function pintwistCatalogRow(pinID, metrics, opts) {
  if (!pinID || !metrics) return null;
  const options = opts || {};
  const stamp = options.scannedAt || new Date().toISOString();
  const saves = Number(metrics.saves) || 0;
  const comments = Number(metrics.comments) || 0;
  const repins = Number(metrics.repins) || 0;
  const reactions = Number(metrics.reactions) || 0;
  const shares = Number(metrics.shares) || 0;
  return {
    search_term: options.term || pintwistCurrentSearchTerm() || '',
    pin_id: String(pinID),
    pin_url: 'https://www.pinterest.com/pin/' + pinID + '/',
    title: metrics.title || '',
    description: metrics.description || '',
    link: metrics.link || '',
    domain: metrics.domain || '',
    board_name: metrics.boardName || '',
    pinner_username: metrics.pinnerUsername || '',
    dominant_color: metrics.dominantColor || '',
    alt_text: metrics.altText || '',
    saves,
    comments,
    repins,
    reactions,
    shares,
    total_engagement: saves + comments + repins + reactions + shares,
    pin_created_at: metrics.createdAt || '',
    image_url: metrics.imageUrl || '',
    display_image_url: metrics.displayImageUrl || metrics.imageUrl || '',
    is_video: !!metrics.isVideo,
    source_url: options.sourceUrl || location.href,
    first_seen_at: stamp,
    last_seen_at: stamp,
    last_changed_at: stamp,
    seen_count: 1,
    scanned_at: stamp,
    history: [{ scanned_at: stamp, saves, comments, repins, reactions, shares, total_engagement: saves + comments + repins + reactions + shares }],
  };
}

// Two metric snapshots are equal only if every count matches (a "true rescrape"
// requires at least one number to have moved).
function pintwistSameMetrics(a, b) {
  return ['saves', 'comments', 'repins', 'reactions', 'shares'].every((k) => (Number(a[k]) || 0) === (Number(b[k]) || 0));
}
// An all-zero read is almost always a failed/partial scrape (the pin's data
// hadn't loaded) — a pin that ever showed engagement never truly drops to all
// zeros. Mirror of isZeroSnapshot in catalog-utils.js.
function pintwistIsZeroSnap(s) {
  return ['saves', 'comments', 'repins', 'reactions', 'shares'].every((k) => (Number(s[k]) || 0) === 0);
}
// Collapse no-change sightings and drop all-zero (failed) reads once the pin has
// shown real engagement, so they stop inflating the scrape history. Mirror of
// buildHistory in catalog-utils.js (live history is already in time order).
function pintwistCleanHistory(snaps) {
  const list = (snaps || []).filter(Boolean);
  const hasReal = list.some((s) => !pintwistIsZeroSnap(s));
  const kept = [];
  for (const s of list) {
    if (hasReal && pintwistIsZeroSnap(s)) continue;
    const prev = kept[kept.length - 1];
    if (prev && pintwistSameMetrics(prev, s)) continue;
    kept.push(s);
  }
  if (!kept.length && list.length) kept.push(list[0]);
  return kept;
}
function pintwistSnapshot(row) {
  const saves = Number(row.saves) || 0,
    comments = Number(row.comments) || 0,
    repins = Number(row.repins) || 0,
    reactions = Number(row.reactions) || 0,
    shares = Number(row.shares) || 0;
  return {
    scanned_at: row.scanned_at || row.last_seen_at || row.first_seen_at || '',
    saves,
    comments,
    repins,
    reactions,
    shares,
    total_engagement: saves + comments + repins + reactions + shares,
  };
}

// Catalog identity/normalization now lives in ONE place — catalog-utils.js — bundled
// as the `PintwistCatalog` global (loaded as a content script before this one; the test
// harness sets it on globalThis). These thin delegators keep the call sites unchanged
// while eliminating the hand-copied mirror that used to drift.
function pintwistCatalogPinKey(row) {
  return globalThis.PintwistCatalog.catalogPinKey(row);
}
// Dedup key for the SCAN-accumulation store. A STABLE numeric Pinterest pin_id is rock-stable
// for the same pin across re-scans, so we key on it first. But some surfaced pins (ads /
// aggregated) carry a non-numeric ~88-char token that CHANGES with the search context — keying
// on that token splits one design into a separate card per keyword. So we trust pin_id only when
// it's all-digits, then the /pin/<id> URL, then the design key (image / title+desc). Imports use
// the same fallback (their copies have different ids for one design).
function pintwistScanKey(row) {
  if (!row) return '';
  // MUST mirror catalog-utils.js catalogScanKey EXACTLY, or the same pin is keyed differently in
  // the scan store vs the catalog-page union (count/grid disagreement, possible over-merge).
  // A parity test asserts pintwistScanKey === catalogScanKey. (audit M-NEW-1; token-split fix)
  const id = String(row.pin_id || row.pinId || row.id || '').trim();
  if (/^\d+$/.test(id)) return 'pin:' + id;
  const m = String(row.pin_url || row.pinUrl || row.url || row.source_url || '').match(/\/pin\/(\d+)/);
  if (m) return 'pin:' + m[1];
  return pintwistCatalogPinKey(row);
}
function pintwistMergeCatalogRows(existing, incoming) {
  const byPin = new Map();
  // Never DROP a row just because it has no stable identity key. A pin with no id and a
  // too-short/empty title would key to '' and silently vanish on the next merge. Fall back
  // to a content-based surrogate (pin_url/image_url/title/desc) so identityless rows are kept
  // (and still dedupe consistently across re-merges). Only a totally empty row collapses. (audit M-NEW-2)
  const keyFor = (row) =>
    pintwistScanKey(row) ||
    'raw:' +
      String(
        row.pin_url || row.pinUrl || row.url || row.image_url || row.imageUrl || row.title || row.description || ''
      ).trim();
  (Array.isArray(existing) ? existing : []).forEach((row) => {
    if (row) byPin.set(keyFor(row), row);
  });
  (incoming || []).forEach((row) => {
    if (!row) return;
    const key = keyFor(row);
    const previous = byPin.get(key) || {};
    const previousTerms = String(previous.search_term || '')
      .split(/\s+\|\s+/)
      .map((term) => term.trim())
      .filter(Boolean);
    const termSet = new Set(previousTerms);
    if (row.search_term) termSet.add(row.search_term);
    // History: append the new observation, then clean — collapse no-change
    // sightings and drop all-zero (failed) reads once the pin has shown real
    // engagement. The latest cleaned snapshot drives the top-level metrics, so a
    // failed zero-read can't clobber known counts or inflate the scrape count.
    const prevHistory = Array.isArray(previous.history)
      ? previous.history.slice()
      : Object.keys(previous).length
        ? [pintwistSnapshot(previous)]
        : [];
    const incomingSnap = pintwistSnapshot(row);
    prevHistory.push(incomingSnap);
    const history = pintwistCleanHistory(prevHistory);
    const latest = history[history.length - 1] || incomingSnap;
    byPin.set(key, {
      ...previous,
      ...row,
      saves: latest.saves,
      comments: latest.comments,
      repins: latest.repins,
      reactions: latest.reactions,
      shares: latest.shares,
      total_engagement: latest.total_engagement,
      scanned_at: latest.scanned_at || row.scanned_at || previous.scanned_at,
      search_term: Array.from(termSet).join(' | '),
      first_seen_at: previous.first_seen_at || row.first_seen_at || row.scanned_at,
      last_seen_at: row.last_seen_at || row.scanned_at || previous.last_seen_at,
      last_changed_at: latest.scanned_at || previous.last_changed_at || incomingSnap.scanned_at,
      seen_count: (Number(previous.seen_count) || 0) + 1,
      history,
    });
  });
  // No silent trim here — the flush auto-exports to CSV and resets when it reaches the cap,
  // so nothing is dropped without being saved first.
  return Array.from(byPin.values()).sort((a, b) => {
    const bySeen = String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || ''));
    return bySeen || (b.total_engagement || 0) - (a.total_engagement || 0);
  });
}

function pintwistQueueCatalogRows(rows) {
  const cleanRows = (rows || []).filter(Boolean);
  if (!cleanRows.length || !chrome?.storage?.local) return;
  __pintwistCatalogPendingRows.push(...cleanRows);
  if (__pintwistCatalogSaveTimer) return;
  __pintwistCatalogSaveTimer = setTimeout(() => {
    pintwistFlushCatalogRows();
  }, 900);
}

// Serialize flushes (audit C2): overlapping callers (scan queue timer, catalog-open re-merge,
// agent export, clear) otherwise each do an independent read→merge→write on the whole catalog
// array and clobber each other's rows. Chaining makes every flush wait for the previous one, so
// each reads the latest persisted state. Pass the inner fn as both handlers so one failure
// doesn't poison the chain.
let __pintwistFlushChain = Promise.resolve();
function pintwistFlushCatalogRows() {
  __pintwistFlushChain = __pintwistFlushChain.then(
    pintwistFlushCatalogRowsInner,
    pintwistFlushCatalogRowsInner
  );
  return __pintwistFlushChain;
}

// True while a manual export+reset is in flight, so the toolbar button and the settings
// "Export" button (the two reset entry points) can't both run and double-export / clobber
// each other's survivor set. Auto-export is already serialized via the flush chain. (audit H-NEW-1)
let __pintwistExportInFlight = false;

// Remove exactly the exported rows from the catalog, run as a LINK IN THE FLUSH CHAIN so a
// live-feed flush (or the auto-export) can't interleave between the re-read and the write and
// clobber a pin scanned during the (multi-second) download. Pins added during the download are
// NOT in exportedKeys, so the survivors filter keeps them — nothing un-exported is lost. (audit H-NEW-1)
function pintwistResetExportedRows(exportedKeys) {
  const inner = () =>
    new Promise((resolve) => {
      chrome.storage.local.get({ [PINTWIST_CATALOG_KEY]: [] }, (result) => {
        const current = Array.isArray(result[PINTWIST_CATALOG_KEY]) ? result[PINTWIST_CATALOG_KEY] : [];
        const survivors = current.filter((r) => !exportedKeys.has(pintwistScanKey(r)));
        chrome.storage.local.set({ [PINTWIST_CATALOG_KEY]: survivors }, () => {
          if (chrome.runtime.lastError) {
            // Reset failed (the download already succeeded, so no data is lost — the catalog
            // just isn't trimmed). Surface it; don't claim a clean reset.
            console.warn('[PinTwist Catalog] reset after export failed:', chrome.runtime.lastError.message);
          }
          try {
            pintwistRefreshCatalogCount();
          } catch {}
          resolve();
        });
      });
    });
  __pintwistFlushChain = __pintwistFlushChain.then(inner, inner);
  return __pintwistFlushChain;
}
function pintwistFlushCatalogRowsInner() {
  if (__pintwistCatalogSaveTimer) {
    clearTimeout(__pintwistCatalogSaveTimer);
    __pintwistCatalogSaveTimer = null;
  }
  // C3: snapshot the pending rows but DON'T remove them from the shared buffer until the write is
  // confirmed — if the set fails or the content script is torn down mid-flush (Pinterest SPA
  // navigations are routine), the rows stay queued for the next flush instead of vanishing.
  const consumed = __pintwistCatalogPendingRows.length;
  if (!consumed || !chrome?.storage?.local) return Promise.resolve();
  const pending = __pintwistCatalogPendingRows.slice(0, consumed);
  // Remove exactly the rows we persisted; anything queued DURING this flush stays for the next.
  const dropConsumed = () => __pintwistCatalogPendingRows.splice(0, consumed);
  return new Promise((resolve) => {
    chrome.storage.local.get({ [PINTWIST_CATALOG_KEY]: [] }, (result) => {
      const merged = pintwistMergeCatalogRows(result[PINTWIST_CATALOG_KEY], pending);
      // At the (configurable) cap: auto-export the full catalog to CSV, then reset to empty and
      // keep going, so accumulated data is never silently dropped. Skipped when the user turns
      // auto-export off in ⚙ — then the catalog just keeps accumulating.
      if (__pintwistAutoexportEnabled && merged.length >= __pintwistAutoexportN) {
        // Keep the full catalog if anything goes wrong — never clear without a saved backup.
        const keepAll = () =>
          chrome.storage.local.set({ [PINTWIST_CATALOG_KEY]: merged }, () => {
            if (!chrome.runtime.lastError) dropConsumed(); // persisted → safe to consume
            try {
              pintwistRefreshCatalogCount();
            } catch {}
            resolve();
          });
        let csv;
        try {
          csv = pintwistRowsToCsv(merged);
        } catch {
          csv = '';
        }
        if (!csv) return keepAll();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        chrome.runtime.sendMessage(
          { action: 'downloadCsv', csv, filename: 'pintwist_autoexport_' + stamp + '.csv' },
          (res) => {
            if (!chrome.runtime.lastError && res && res.success) {
              // Backup CSV CONFIRMED written to disk (the background now waits for the download to
              // reach 'complete', audit C1) — only now is it safe to reset the catalog.
              chrome.storage.local.set({ [PINTWIST_CATALOG_KEY]: [] }, () => {
                dropConsumed(); // data is safely in the downloaded CSV
                try {
                  pintwistRefreshCatalogCount();
                } catch {}
                resolve();
              });
            } else {
              // Auto-export failed (worker asleep / download error / interrupted) — KEEP everything
              // so accumulated data is never wiped without a backup; we'll bound again next flush.
              console.warn('[PinTwist Catalog] auto-export failed; keeping catalog to avoid data loss');
              keepAll();
            }
          }
        );
        return;
      }
      chrome.storage.local.set({ [PINTWIST_CATALOG_KEY]: merged }, () => {
        if (chrome.runtime.lastError) {
          // Keep the pending rows queued so the next flush retries them (audit C3).
          console.warn('[PinTwist Catalog] Save failed (will retry):', chrome.runtime.lastError.message);
        } else {
          dropConsumed();
        }
        resolve();
      });
    });
  });
}

function pintwistCatalogHeaders() {
  return [
    'search_term',
    'pin_id',
    'pin_url',
    'title',
    'description',
    'link',
    'domain',
    'board_name',
    'pinner_username',
    'dominant_color',
    'alt_text',
    'saves',
    'comments',
    'repins',
    'reactions',
    'shares',
    'total_engagement',
    'pin_created_at',
    'image_url',
    'display_image_url',
    'is_video',
    'source_url',
    'first_seen_at',
    'last_seen_at',
    'last_changed_at',
    'seen_count',
    'scanned_at',
  ];
}

// One row PER history snapshot, so the full scrape history survives a CSV export
// → re-import round-trip (the import groups rows back into per-pin history).
function pintwistRowsToCsv(rows) {
  const headers = pintwistCatalogHeaders();
  // User-facing column label only: the stored `pin_created_at` is really the save date
  // of the copy Pinterest surfaced (a recency signal), NOT an origin/creation date —
  // Pinterest exposes no first-pinned date for re-pinned content. Label it honestly as
  // `last_activity` while keeping the internal key stable for keyed lookup + dedup.
  const lines = [headers.map((h) => (h === 'pin_created_at' ? 'last_activity' : h)).join(',')];
  (rows || []).forEach((row) => {
    const snaps = Array.isArray(row.history) && row.history.length ? row.history : [row];
    snaps.forEach((snap) => {
      const merged = {
        ...row,
        saves: snap.saves,
        comments: snap.comments,
        repins: snap.repins,
        reactions: snap.reactions,
        shares: snap.shares,
        total_engagement: snap.total_engagement != null ? snap.total_engagement : row.total_engagement,
        scanned_at: snap.scanned_at || row.scanned_at,
      };
      lines.push(headers.map((key) => pintwistCsvCell(merged[key])).join(','));
    });
  });
  return lines.join('\r\n');
}

async function pintwistGetCatalogRows() {
  await pintwistFlushCatalogRows();
  const result = await chrome.storage.local.get({ [PINTWIST_CATALOG_KEY]: [] });
  return Array.isArray(result[PINTWIST_CATALOG_KEY]) ? result[PINTWIST_CATALOG_KEY] : [];
}

async function pintwistDownloadAccumulatedCatalogCsv(filename, opts) {
  // opts.reset: after a CONFIRMED successful download, clear the catalog back to
  // 0 (the user-facing "download then start fresh" flow). Off by default so the
  // agent export commands stay non-destructive (they have a separate clearCatalog).
  const reset = !!(opts && opts.reset);
  // Only one reset-export may run at a time, across BOTH reset entry points (toolbar +
  // settings button), so they can't double-export or clobber each other's reset. (audit H-NEW-1)
  if (reset && __pintwistExportInFlight) {
    return { ok: false, error: 'export_in_flight', pinCount: 0 };
  }
  if (reset) __pintwistExportInFlight = true;
  try {
    // Capture anything still queued before we export, so nothing pending is left out.
    if (reset) {
      try {
        await pintwistFlushCatalogRows();
      } catch {}
    }
    const rows = await pintwistGetCatalogRows();
    if (!rows.length) return { ok: false, error: 'no_catalog_rows', pinCount: 0 };
    const csv = pintwistRowsToCsv(rows);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = filename || 'pintwist_accumulated_' + stamp + '.csv';
    const result = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'downloadCsv', csv, filename: target }, (res) => {
          if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
          resolve(res && res.success ? { ok: true } : { ok: false, error: (res && res.error) || 'download_failed' });
        });
      } catch (err) {
        resolve({ ok: false, error: (err && err.message) || String(err) });
      }
    });
    // Only reset once the backup CSV is confirmed written — never wipe without a saved copy.
    // The survivors set-difference runs as a flush-chain link so a flush that completes during
    // the download can't be clobbered (it keeps any pin scanned during the download). (audit H-NEW-1)
    if (result.ok && reset) {
      const exportedKeys = new Set(rows.map((r) => pintwistScanKey(r)));
      await pintwistResetExportedRows(exportedKeys);
    }
    return Object.assign({}, result, { filename: target, pinCount: rows.length, reset: result.ok && reset });
  } finally {
    if (reset) __pintwistExportInFlight = false;
  }
}

let __pintwistCountTimer = null;
// Update the on-bar "N saved" counter from the persisted catalog (all-time, deduped).
function pintwistRefreshCatalogCount() {
  try {
    chrome.storage.local.get({ [PINTWIST_CATALOG_KEY]: [] }, (r) => {
      const n = Array.isArray(r[PINTWIST_CATALOG_KEY]) ? r[PINTWIST_CATALOG_KEY].length : 0;
      document.querySelectorAll('#pintwist-catalog-count').forEach((el) => {
        el.textContent = n.toLocaleString() + ' saved';
      });
    });
  } catch {
    /* non-fatal */
  }
}
// Debounced — called as pins accumulate so the count visibly grows without hammering storage.
function pintwistScheduleCountRefresh() {
  clearTimeout(__pintwistCountTimer);
  __pintwistCountTimer = setTimeout(pintwistRefreshCatalogCount, 1100);
}

// Briefly flash the "N saved" total so the drop to 0 after a download+reset is impossible to miss.
function pintwistFlashCatalogCount() {
  document.querySelectorAll('#pintwist-catalog-count').forEach((el) => {
    try {
      const prev = {
        color: el.style.color,
        weight: el.style.fontWeight,
        transform: el.style.transform,
        transition: el.style.transition,
        display: el.style.display,
      };
      el.style.transition = 'none';
      el.style.display = 'inline-block';
      el.style.color = 'var(--pintwist-primary, #F0002D)';
      el.style.fontWeight = '900';
      el.style.transform = 'scale(1.18)';
      setTimeout(() => {
        el.style.transition = 'color .6s ease, transform .6s ease, font-weight .6s ease';
        el.style.color = prev.color;
        el.style.fontWeight = prev.weight;
        el.style.transform = prev.transform;
        setTimeout(() => {
          el.style.transition = prev.transition;
          el.style.display = prev.display;
        }, 650);
      }, 70);
    } catch {
      /* non-fatal */
    }
  });
}

// Toolbar "Download CSV" → export the FULL accumulated catalog (every scan, deduped) and,
// ONLY once the download is confirmed written, reset the saved total to 0. So the number you
// see is always the real running total and you can never double-export the same pins. The
// count visibly drops to 0 and flashes right after the file lands; a failed download never clears.
async function pintwistDownloadAndResetCatalog(btn) {
  if (btn && btn.dataset.pintwistBusy === '1') return;
  const restore = btn ? btn.innerHTML : null;
  if (btn) {
    btn.dataset.pintwistBusy = '1';
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }
  let res;
  try {
    res = await pintwistDownloadAccumulatedCatalogCsv(null, { reset: true });
  } catch (e) {
    res = { ok: false, error: (e && e.message) || String(e) };
  }
  if (btn) {
    btn.dataset.pintwistBusy = '0';
    btn.disabled = false;
    btn.innerHTML = restore;
  }
  if (res && res.ok) {
    try {
      pintwistRefreshCatalogCount();
    } catch {}
    pintwistFlashCatalogCount();
  } else if (res && res.error === 'no_catalog_rows') {
    alert('No saved pins to download yet — run a scan first.');
  } else {
    alert('CSV download failed — your saved pins were NOT cleared. Please try again.');
  }
}

// =====================================================================
// PINTWIST AUTOMATION
// Queue runner: paste comma/newline separated search terms, automatically
// search -> load N pages -> save CSV -> wait interval (jittered if randomize) ->
// next term. Captcha/rate-limit detected -> 1h cooldown.
// State persisted in chrome.storage.local["pintwist_queue"] so it survives
// the SPA page transitions Pinterest does between searches.
// =====================================================================
(function pintwistAutomation() {
  const QKEY = 'pintwist_queue';
  const DEFAULTS = {
    running: false,
    terms: [],
    currentIdx: 0,
    pagesPerTerm: 40,
    intervalMin: 5, // minutes — default delay between scans
    randomize: false,
    randomizePct: 40,
    cooldownUntil: 0,
    lastNavAt: 0,
    nextNavAt: 0, // when set, we're counting down ON the finished term's page before loading the next search
    panelExpanded: false,
    runNextImmediately: false, // one-shot: skip the page-load delay (set by ▶ buttons)
    pauseReason: '', // human-readable reason automation last went idle (shown in the panel + logged)
  };

  // On script reload (extension reload), nuke any stale automation panel from
  // the previous version so the new layout takes effect immediately. Without
  // this, the existing body element persists and renderBodyScaffold's signature
  // check skips rebuilds, leaving the user looking at the old layout.
  (function nukeStale() {
    const oldBody = document.getElementById('pintwist-auto-body');
    if (oldBody) oldBody.remove();
    const oldToggle = document.getElementById('pintwist-auto-toggle');
    if (oldToggle) oldToggle.remove();
  })();
  // Module-local — survives across same-page renders, resets on navigation.
  let _pendingNextTimeout = null;
  let _pendingNextDeadline = 0;
  let _pendingNextCallback = null; // remembered so settings changes can reschedule
  // Guards against a second scan starting while one is already in flight (audit H3).
  // Pinterest's SPA re-fires the mount observer mid-scan, which re-calls
  // runOnceForCurrentPage(); without this, two scan/monitor loops race the completion
  // block and double-advance currentIdx (skipping a queue term).
  let _scanInFlight = false;

  // This tab's own id (from the background), cached. Used to make the running queue
  // single-OWNER: only the tab that started automation drives it, so a second Pinterest tab
  // can't pause the queue or run the same term twice. (audit HIGH-1/HIGH-2)
  let _myTabId = null;
  function pintwistEnsureTabId() {
    if (_myTabId != null) return Promise.resolve(_myTabId);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'getTabId' }, (res) => {
          if (!chrome.runtime.lastError && res && typeof res.tabId === 'number') _myTabId = res.tabId;
          resolve(_myTabId);
        });
      } catch {
        resolve(_myTabId);
      }
    });
  }
  // Ask the background whether a tab is still open. Used to detect that the tab OWNING the
  // queue was closed so a surviving tab can take over instead of stalling. Defaults to TRUE
  // (assume alive) on ANY uncertainty — so we only ever take over when the owner is provably
  // gone, never on a flaky message.
  function pintwistIsTabOpen(tabId) {
    if (typeof tabId !== 'number') return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'isTabOpen', tabId }, (res) => {
          if (chrome.runtime.lastError || !res) return resolve(true);
          resolve(!!res.open);
        });
      } catch {
        resolve(true);
      }
    });
  }

  // Swallow rejections from the fire-and-forget runOnceForCurrentPage() calls so they
  // don't surface as unhandled promise rejections. Context-invalidated errors are
  // expected (extension reload) and stay silent; anything else is logged.
  function pintwistRunErr(e) {
    const msg = (e && e.message) || String(e || '');
    if (!/context invalidated/i.test(msg)) console.warn('[PinTwist Automation] run error:', msg);
  }
  // Schedule the next pending action (run-now-after-delay, or advance-after-delay)
  // and remember the callback so rescheduleIfPending can re-fire it with a fresh
  // delay when the user tweaks interval/randomize while waiting.
  function schedulePending(callback, delay) {
    if (_pendingNextTimeout) clearTimeout(_pendingNextTimeout);
    _pendingNextCallback = callback;
    _pendingNextDeadline = Date.now() + delay;
    _pendingNextTimeout = setTimeout(() => {
      _pendingNextTimeout = null;
      _pendingNextDeadline = 0;
      const cb = _pendingNextCallback;
      _pendingNextCallback = null;
      if (cb) {
        const r = cb();
        if (r && typeof r.catch === 'function') r.catch(pintwistRunErr);
      }
    }, delay);
  }
  function clearPending() {
    if (_pendingNextTimeout) clearTimeout(_pendingNextTimeout);
    _pendingNextTimeout = null;
    _pendingNextDeadline = 0;
    _pendingNextCallback = null;
  }
  function rescheduleIfPending() {
    if (!_pendingNextTimeout || !_pendingNextCallback) return;
    schedulePending(_pendingNextCallback, jitterDelayMs());
  }
  const COOLDOWN_MS = 60 * 60 * 1000;
  const SCAN_TIMEOUT_MS = 5 * 60 * 1000;

  let state = null;

  async function loadState() {
    const out = await chrome.storage.local.get(QKEY);
    state = Object.assign({}, DEFAULTS, out[QKEY] || {});
    // The automation panel always starts collapsed on a fresh load, regardless of
    // the last session's open/closed state. Queue + settings still persist.
    state.panelExpanded = false;
    // Migrate legacy intervalSec → intervalMin
    if (typeof state.intervalSec === 'number') {
      state.intervalMin = Math.max(0.25, Math.round((state.intervalSec / 60) * 4) / 4);
      delete state.intervalSec;
    }
    if (typeof state.intervalMin !== 'number' || !isFinite(state.intervalMin)) {
      state.intervalMin = DEFAULTS.intervalMin;
    }
    // enabled is dropped — running is the single source of truth now
    delete state.enabled;
    return state;
  }
  async function saveState(patch) {
    // Stamp the current tab as the queue OWNER whenever the queue is (re)started, so the
    // multi-tab guard in runOnceForCurrentPage can tell driver from passive tabs. (audit HIGH-1/HIGH-2)
    if (patch && patch.running === true && patch.ownerTabId === undefined) {
      patch = Object.assign({}, patch, { ownerTabId: await pintwistEnsureTabId() });
    }
    state = Object.assign(state || {}, patch || {});
    await chrome.storage.local.set({ [QKEY]: state });
    renderPanel();
  }

  function parseTerms(raw) {
    if (!raw) return [];
    const text = Array.isArray(raw) ? raw.join('\n') : String(raw);
    return text
      .split(/[\n,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function searchUrlFor(term) {
    return 'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(term);
  }

  // Turn automation off WITH a recorded reason, so a self-pause is never mysterious:
  // it's logged to the console AND surfaced in the panel status line (renderQueueAndStats).
  // `extra` carries any additional state to persist alongside (e.g. currentIdx, nextNavAt).
  async function autoSetOff(reason, extra) {
    try {
      console.log('[PinTwist Automation] off — ' + reason);
    } catch {}
    await saveState(Object.assign({ running: false, pauseReason: reason }, extra || {}));
  }

  function currentSearchTerm() {
    try {
      const u = new URL(location.href);
      if (!u.pathname.startsWith('/search/')) return null;
      return u.searchParams.get('q');
    } catch {
      return null;
    }
  }

  function isOnTermPage(idx) {
    if (!state.terms[idx]) return false;
    const cur = currentSearchTerm();
    if (!cur) return false;
    return cur.trim().toLowerCase() === state.terms[idx].term.trim().toLowerCase();
  }

  function jitterDelayMs() {
    const base = Math.max(0.25, state.intervalMin) * 60 * 1000;
    if (!state.randomize) return base;
    const pct = Math.max(0, Math.min(95, state.randomizePct)) / 100;
    const min = base * (1 - pct);
    const max = base * (1 + pct);
    return Math.floor(min + Math.random() * (max - min));
  }

  function looksLikeCaptcha() {
    const t = (document.title || '').toLowerCase();
    if (t.includes('security check') || t.includes('verify')) return true;
    if (document.querySelector('[data-test-id="captcha-form"]')) return true;
    const body = (document.body && document.body.innerText) || '';
    if (/checking your browser|unusual activity|verify you.{1,3}re a human/i.test(body.slice(0, 4000))) return true;
    return false;
  }

  async function triggerCooldown(reason) {
    const until = Date.now() + COOLDOWN_MS;
    clearPending(); // no stray scheduled scan should survive into a cooldown
    await saveState({ cooldownUntil: until, running: false, nextNavAt: 0, pauseReason: 'Cooldown — ' + reason });
    console.warn('[PinTwist Automation] Cooldown:', reason, 'until', new Date(until).toISOString());
    try {
      alert('PinTwist: ' + reason + '\nQueue paused for 1 hour. Resume from the toolbar when ready.');
    } catch {}
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Neutralize spreadsheet formula injection (matches pintwistCsvCell): a cell
    // from attacker-controlled pin text starting with = + - @ tab CR can execute
    // in Excel/Sheets, so prefix a quote.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsvForCurrentScan(term) {
    const ids = Array.from(State.sortedPinIDs || []);
    const rows = [];
    const headers = [
      'search_term',
      'pin_id',
      'pin_url',
      'title',
      'description',
      'link',
      'domain',
      'board_name',
      'pinner_username',
      'dominant_color',
      'alt_text',
      'saves',
      'comments',
      'repins',
      'reactions',
      'shares',
      'last_activity',
      'image_url',
      'is_video',
      'scanned_at',
    ];
    rows.push(headers.join(','));
    const stamp = new Date().toISOString();
    for (const id of ids) {
      const m = State.metricsCache.get(id);
      if (!m) continue;
      rows.push(
        [
          term,
          id,
          'https://www.pinterest.com/pin/' + id + '/',
          m.title,
          m.description,
          m.link,
          m.domain,
          m.boardName,
          m.pinnerUsername,
          m.dominantColor,
          m.altText,
          m.saves,
          m.comments,
          m.repins,
          m.reactions,
          m.shares,
          m.createdAt,
          m.imageUrl,
          m.isVideo,
          stamp,
        ]
          .map(csvCell)
          .join(',')
      );
    }
    return { csv: rows.join('\r\n'), pinCount: ids.length };
  }

  function saveScanToLocalCatalog(term, stamp) {
    const ids = Array.from(State.sortedPinIDs || []);
    if (!ids.length || !chrome?.storage?.local) return;
    const rows = ids
      .map((id) => pintwistCatalogRow(id, State.metricsCache.get(id), { term, scannedAt: stamp }))
      .filter(Boolean);
    pintwistQueueCatalogRows(rows);
  }

  function waitFor(predicate, opts) {
    const o = opts || {};
    const timeoutMs = o.timeoutMs || 30000;
    const intervalMs = o.intervalMs || 250;
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        try {
          if (predicate()) return resolve(true);
        } catch {}
        if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  // immediate=true means "user just clicked ▶ — skip any countdown delay".
  // Otherwise (page load, scheduled callback) we always defer the actual scan
  // by jitterDelayMs() so opening Pinterest never auto-scans on its own.
  async function runOnceForCurrentPage(immediate) {
    await loadState();
    if (!state.running) return;
    // Multi-tab safety (audit HIGH-1, refined): a passive background tab must not PAUSE the
    // queue, but whichever tab is on the current term's results page is the one driving it —
    // so it CLAIMS ownership here. That way the owner tab refreshing (or any tab on the results
    // page) resumes the run seamlessly instead of getting stuck on "Starting…", while only the
    // owner is allowed to pause it (gated in the !isOnTermPage branch below). Unknown owner /
    // no tab id → behaves as before, so single-tab automation is never broken.
    await pintwistEnsureTabId();
    if (_myTabId != null && state.ownerTabId !== _myTabId && isOnTermPage(state.currentIdx)) {
      console.log(
        '[PinTwist Automation] tab ' + _myTabId + ' took ownership of the queue (previous owner: ' + state.ownerTabId + ')'
      );
      await saveState({ ownerTabId: _myTabId });
    }
    if (state.cooldownUntil && Date.now() < state.cooldownUntil) return;
    if (state.currentIdx >= state.terms.length) return;

    const term = state.terms[state.currentIdx];
    if (!term || term.status === 'done' || term.status === 'failed' || term.status === 'cancelled') {
      // Inter-term wait in progress: we finished this term and are counting down on
      // its own results page before loading the next search. Re-establish the
      // countdown (survives reloads) instead of advancing instantly.
      if (!state.runNextImmediately && state.nextNavAt && Date.now() < state.nextNavAt) {
        if (!_pendingNextTimeout) schedulePending(() => advanceAndNavigate(true), state.nextNavAt - Date.now());
        try {
          renderQueueAndStats();
        } catch {}
        return;
      }
      return advanceAndNavigate(true);
    }

    if (looksLikeCaptcha()) return triggerCooldown('Captcha / security check detected');

    // Only an explicit start (Run automation / ▶ / add-and-run) may DRIVE the page
    // to a term. A plain page load must never redirect — otherwise a manual search
    // gets hijacked back to the current queue term on every navigation.
    const explicit = !!immediate || !!state.runNextImmediately;

    if (!isOnTermPage(state.currentIdx)) {
      if (!explicit) {
        // Pause the queue ONLY when we can POSITIVELY confirm THIS tab owns it. The owner
        // navigating off its own search page is the one legitimate auto-pause. In every other
        // case — another tab owns it, OR ownership / our tab-id isn't resolved yet — we STAND
        // DOWN without touching `running`. A freshly-opened 2nd tab on a non-term page (or one
        // whose getTabId hasn't resolved) must NEVER kill the owner's running queue.
        // (Regression this guards against: opening Pinterest in a new tab turned automation off
        // because the new tab fell through to pause whenever its tab-id/owner wasn't resolved —
        // the old guard only stood down when it could positively prove it was a DIFFERENT tab.)
        const iAmOwner = state.ownerTabId != null && _myTabId != null && state.ownerTabId === _myTabId;
        if (!iAmOwner) {
          // Before standing down, check whether the OWNER tab is still open. If it was CLOSED,
          // the queue would otherwise stall forever (this tab deferring to a dead owner). In
          // that case THIS tab takes over and resumes the queue. Only attempt this when there's
          // a real numeric owner that might have died AND we know our own tab id — a null/unknown
          // owner is NOT a dead owner, so we stand down (never take over → never hijack a fresh
          // tab). Owner alive (or liveness unknown) → stand down without touching `running`.
          const canCheckOwner = typeof state.ownerTabId === 'number' && _myTabId != null;
          const ownerAlive = canCheckOwner ? await pintwistIsTabOpen(state.ownerTabId) : true;
          if (ownerAlive || !state.running) {
            console.log(
              '[PinTwist Automation] tab ' +
                _myTabId +
                ' not driving (owner: ' +
                state.ownerTabId +
                ') — leaving the queue running, not pausing'
            );
            return;
          }
          // Owner tab is gone — take over so a closed owner can't stall the queue, and resume
          // by driving THIS tab to the current term (it re-stamps ownership on the term page).
          console.log(
            '[PinTwist Automation] owner tab ' +
              state.ownerTabId +
              ' is gone — tab ' +
              _myTabId +
              ' taking over and resuming the queue'
          );
          term.status = 'running';
          term.startedAt = Date.now();
          state.terms[state.currentIdx] = term;
          await saveState({ ownerTabId: _myTabId, lastNavAt: Date.now(), runNextImmediately: true });
          location.href = searchUrlFor(term.term);
          return;
        }
        // This tab IS the owner and the user navigated off its search page — pause so we stop
        // redirecting them; they can re-start from the toolbar when ready.
        if (_pendingNextTimeout) {
          clearTimeout(_pendingNextTimeout);
          _pendingNextTimeout = null;
        }
        await autoSetOff('Paused — you navigated off the search page');
        try {
          renderQueueAndStats();
        } catch {}
        return;
      }
      term.status = 'running';
      term.startedAt = Date.now();
      state.terms[state.currentIdx] = term;
      // Persist runNextImmediately so the new page knows whether to skip
      // the delay (only when user clicked ▶).
      await saveState({ lastNavAt: Date.now(), runNextImmediately: !!immediate });
      location.href = searchUrlFor(term.term);
      return;
    }

    // We're on the right URL. Decide: scan now or schedule with delay?
    if (state.runNextImmediately) {
      await saveState({ runNextImmediately: false });
    }
    if (!explicit) {
      // Page load with running queue → ALWAYS delay before scanning. User
      // wants to never see auto-scan immediately on page open.
      if (_pendingNextTimeout) return; // already scheduled
      schedulePending(() => runOnceForCurrentPage(true), jitterDelayMs());
      renderQueueAndStats();
      return;
    }

    // Don't start a second scan while one is already running on this page (audit H3) —
    // Pinterest's SPA re-fires the mount observer mid-scan and re-enters here.
    if (_scanInFlight) return;
    _scanInFlight = true;
    try {
      // Match the ▶/Run-now path: clear any stale abort flag left from the previous
      // term's teardown/navigation. Without this the scan-monitor loop below bails as
      // "cancelled" the instant it starts — the scheduled (countdown) path used to skip
      // this reset, which is why ▶ worked but the timer didn't.
      if (typeof State !== 'undefined') State.aborted = false;
      // Wait for the SORT button itself (it lives in the freshly-built #pintwist-initial-bar);
      // waiting only on the bar container could resolve before the button is wired.
      await waitFor(() => document.getElementById('pintwist-sort-pins-btn'), { timeoutMs: 30000 });
      const pagesInput = document.getElementById('pintwist-pages-input');
      const sortBtn = document.getElementById('pintwist-sort-pins-btn');
      if (!pagesInput || !sortBtn) throw new Error('toolbar inputs missing');
      pagesInput.value = String(state.pagesPerTerm);
      pagesInput.dispatchEvent(new Event('change', { bubbles: true }));
      sortBtn.click();

      let lastSize = -1,
        lastChange = Date.now();
      const start = Date.now();
      let cancelled = false;
      while (Date.now() - start < SCAN_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 1000));
        // User clicked Cancel scan? — bail without cooldown, without saving CSV.
        if (typeof State !== 'undefined' && State.aborted) {
          cancelled = true;
          break;
        }
        // Re-read queue state in case Pause/Clear was clicked from the panel.
        try {
          const live = (await chrome.storage.local.get(QKEY))[QKEY];
          if (!live || !live.running) {
            cancelled = true;
            break;
          }
        } catch {}
        const size =
          (window.State && window.State.sortedPinIDs && window.State.sortedPinIDs.size) ||
          (typeof State !== 'undefined' && State.sortedPinIDs && State.sortedPinIDs.size) ||
          0;
        if (size !== lastSize) {
          lastSize = size;
          lastChange = Date.now();
        }
        if (looksLikeCaptcha()) return triggerCooldown('Captcha during scan');
        if (lastSize > 0 && Date.now() - lastChange > 8000) break;
      }

      if (cancelled) {
        // Mark cancelled if not already marked, leave queue paused.
        if (state.terms[state.currentIdx] && state.terms[state.currentIdx].status !== 'cancelled') {
          state.terms[state.currentIdx].status = 'cancelled';
          state.terms[state.currentIdx].error = 'user cancelled';
        }
        await autoSetOff('Stopped — scan cancelled');
        return;
      }

      if (lastSize === 0) {
        // On a hidden/background tab Pinterest throttles infinite-scroll, so zero pins load
        // even when there's no rate limit at all. Don't punish the whole queue with a 1-hour
        // cooldown for that — just retry this term shortly; it succeeds once the tab is
        // foregrounded. Only a zero-result on a VISIBLE tab is treated as rate-limited. (audit MED-3)
        if (typeof document !== 'undefined' && document.hidden) {
          schedulePending(() => runOnceForCurrentPage(true), 15000);
          return;
        }
        return triggerCooldown('No pins loaded - likely rate-limited');
      }

      // Auto scans ACCUMULATE ONLY — no per-term file. Each term's pins go into the one
      // accumulated catalog (deduped by pin_id, keyword-tagged, timestamped); you export the
      // whole thing once via "Download CSV". The old per-term download raced the immediate
      // navigation to the next term (delayed, and sometimes dropped entirely) and double-stored
      // data that's already in the catalog.
      const { pinCount } = buildCsvForCurrentScan(term.term);
      saveScanToLocalCatalog(term.term, new Date().toISOString());

      term.status = 'done';
      term.pinCount = pinCount;
      term.finishedAt = Date.now();
      state.terms[state.currentIdx] = term;

      if (state.currentIdx + 1 < state.terms.length) {
        // Wait the inter-term interval ON THIS results page, THEN load + scan the
        // next term. (We used to navigate to the next search immediately and count
        // down on the already-loaded page — so the next search was "prepared" with
        // 10 min still on the clock. Bad UX.) currentIdx stays on the just-finished
        // (now done) term until we navigate, so a reload of this page re-establishes
        // the countdown instead of tripping the "user navigated away" pause.
        const wait = jitterDelayMs();
        console.log('[PinTwist Automation] Waiting ' + Math.round(wait / 1000) + 's on this page before next term');
        await saveState({ nextNavAt: Date.now() + wait });
        schedulePending(() => advanceAndNavigate(true), wait);
      } else {
        // Queue done — kill any stray scheduled scan/countdown so nothing lingers
        // after we turn automation off.
        clearPending();
        await autoSetOff('Queue complete', { currentIdx: state.currentIdx + 1, nextNavAt: 0 });
        // No blocking popup on queue completion (it interrupted the flow). The queue
        // pills already show each term's done/saved state; log for the record only.
        console.log(
          '[PinTwist Automation] Queue complete — ' +
            state.terms.filter((x) => x.status === 'done').length +
            ' searches saved.'
        );
      }
    } catch (err) {
      const errMsg = (err && err.message) || String(err || '');
      if (/context invalidated/i.test(errMsg) || !pintwistContextAlive()) {
        // Extension was reloaded/updated mid-scan — this tab's content script is now
        // orphaned and every chrome.* call throws "Extension context invalidated". Don't
        // mark the term "failed" or schedule a retry: the retry would just throw again
        // (and saveState below would too), spamming the console and falsely flagging a
        // healthy term. Stop quietly; refreshing the tab loads a fresh content script.
        // pintwistTeardownDeadContext also surfaces a visible
        // "extension reloaded · refresh to resume" note in the panel (pure DOM).
        clearPending();
        pintwistTeardownDeadContext();
        return;
      }
      console.error('[PinTwist Automation] term failed:', err);
      term.status = 'failed';
      term.error = errMsg;
      state.terms[state.currentIdx] = term;
      // Persist the failed status but DON'T bump currentIdx — advanceAndNavigate skips
      // failed terms itself, so bumping here too double-advances and skips a healthy term
      // (audit H4). schedulePending (not a bare setTimeout) so Stop/Clear can cancel it.
      await saveState({});
      schedulePending(() => advanceAndNavigate(true), 5000);
    } finally {
      _scanInFlight = false;
    }
  }

  // immediate=true: the inter-term wait already elapsed on the previous page, so
  // the next term's page should scan right away (no second countdown). Clears the
  // nextNavAt countdown deadline as we leave.
  async function advanceAndNavigate(immediate) {
    await loadState();
    if (!state.running) return;
    while (state.currentIdx < state.terms.length) {
      const t = state.terms[state.currentIdx];
      if (t && t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled') break;
      state.currentIdx += 1;
    }
    if (state.currentIdx >= state.terms.length) {
      await autoSetOff('Queue complete', { nextNavAt: 0 });
      return;
    }
    await saveState({ nextNavAt: 0, runNextImmediately: !!immediate, lastNavAt: Date.now() });
    const t = state.terms[state.currentIdx];
    location.href = searchUrlFor(t.term);
  }

  // Mount on whichever toolbar is currently visible — initial bar (before sort)
  // or resort bar (after sort completes). Both behave as positioning contexts.
  function getActiveBar() {
    return document.getElementById('pintwist-resort-bar') || document.getElementById('pintwist-initial-bar');
  }

  // Inject a Cancel button into the scan-progress popup (#pintwist-progress-panel).
  // The popup is what's visible during a scan ("Page X of 40"); the toolbar is
  // hidden. Setting State.aborted is all the existing scan engine needs — it
  // already shows "Cancelled" and removes the popup. If automation is running,
  // we also mark the current queue term as cancelled and pause the queue.
  function ensureProgressCancelButton() {
    const panel = document.getElementById('pintwist-progress-panel');
    if (!panel) return;
    if (panel.querySelector('#pintwist-progress-cancel')) return;
    const btn = document.createElement('button');
    btn.id = 'pintwist-progress-cancel';
    btn.type = 'button';
    btn.textContent = 'Cancel scan';
    btn.className = 'pintwist-progress-cancel';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (typeof State !== 'undefined') State.aborted = true;
      } catch {}
      btn.disabled = true;
      btn.textContent = 'Cancelling…';
      // If automation queue is running, mark current term cancelled + pause.
      try {
        await loadState();
        if (state && state.running) {
          if (state.terms[state.currentIdx] && state.terms[state.currentIdx].status === 'running') {
            state.terms[state.currentIdx].status = 'cancelled';
            state.terms[state.currentIdx].error = 'user cancelled';
          }
          await autoSetOff('Stopped — scan cancelled');
        }
      } catch (err) {
        console.warn('[PinTwist Automation] cancel save failed:', err);
      }
    });
    panel.appendChild(btn);
  }

  function ensurePanel() {
    const bar = getActiveBar();
    if (!bar) return;
    // Toggle button — appended as last child of the bar; CSS pushes it right
    // via margin-left:auto so it always sits at the far right of the toolbar.
    let toggle = document.getElementById('pintwist-auto-toggle');
    if (toggle && !bar.contains(toggle)) {
      // bar changed (initial -> resort or vice versa) — relocate
      toggle.remove();
      toggle = null;
    }
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = 'pintwist-auto-toggle';
      toggle.className = 'pintwist-auto-toggle';
      const pillPanel = bar.classList.contains('pintwist-is-pill') ? bar.querySelector('.pintwist-pill-panel') : null;
      const tutorialLink = bar.querySelector('.pintwist-tutorial-link');
      if (pillPanel) pillPanel.appendChild(toggle);
      else if (tutorialLink && tutorialLink.parentNode === bar) bar.insertBefore(toggle, tutorialLink);
      else bar.appendChild(toggle);
    }
    // Body dropdown — child of the bar, absolute-positioned right under it
    // so it visually appears as the toolbar "expanding downward".
    let body = document.getElementById('pintwist-auto-body');
    if (body && !bar.contains(body)) {
      body.remove();
      body = null;
      _bodyBuiltFor = null;
    }
    if (!body) {
      body = document.createElement('div');
      body.id = 'pintwist-auto-body';
      body.className = 'pintwist-auto-body';
      _bodyBuiltFor = null; // force a fresh scaffold on the new bar
    }
    const pillPanelForBody = bar.classList.contains('pintwist-is-pill')
      ? bar.querySelector('.pintwist-pill-panel')
      : null;
    const tutorialLinkForBody = bar.querySelector('.pintwist-tutorial-link');
    if (pillPanelForBody) pillPanelForBody.appendChild(body);
    else if (tutorialLinkForBody && tutorialLinkForBody.parentNode === bar) bar.insertBefore(body, tutorialLinkForBody);
    else if (toggle && toggle.parentNode === bar && toggle.nextSibling) bar.insertBefore(body, toggle.nextSibling);
    else bar.appendChild(body);
    renderPanel();
  }

  function fmtCountdown(ms) {
    if (ms <= 0) return '0s';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return m > 0 ? m + 'm ' + s + 's' : s + 's';
  }

  function escAuto(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Custom-spinner number field. Emits input + ▲▼ stacked buttons. Step,
  // min, max are stored as data-* so the click handler can clamp without
  // re-reading the input attributes (which strip step accuracy).
  function numField(id, min, max, step, value, extraClass) {
    const cls = 'pintwist-auto-num' + (extraClass ? ' ' + extraClass : '');
    const stepStr = String(step);
    // Defense-in-depth: every interpolated attribute value goes through escAuto,
    // like the neighboring textarea. In practice `value` is already a browser-
    // sanitized number-input value / clamped state and id/min/max/step come from
    // code, but escaping keeps this HTML sink safe regardless of caller.
    return (
      '<span class="pintwist-auto-num-wrap">' +
      '<input type="number" id="' +
      escAuto(id) +
      '" min="' +
      escAuto(min) +
      '" max="' +
      escAuto(max) +
      '" step="' +
      escAuto(stepStr) +
      '" value="' +
      escAuto(value) +
      '" class="' +
      cls +
      '" data-step="' +
      escAuto(stepStr) +
      '" data-min="' +
      escAuto(min) +
      '" data-max="' +
      escAuto(max) +
      '">' +
      '<span class="pintwist-auto-num-spin">' +
      '<button type="button" class="pintwist-auto-num-up" data-target="' +
      escAuto(id) +
      '" tabindex="-1" aria-label="Increase">&#9650;</button>' +
      '<button type="button" class="pintwist-auto-num-down" data-target="' +
      escAuto(id) +
      '" tabindex="-1" aria-label="Decrease">&#9660;</button>' +
      '</span>' +
      '</span>'
    );
  }

  // Render is split in two so the 1s tick doesn't blow away inputs while the
  // user is typing/pasting:
  //   renderToggle()        — cheap; runs every tick + on state change
  //   renderBodyScaffold()  — rebuilds form fields + queue ONLY when expanded
  //                           transitions or queue contents change
  //   renderQueueAndStats() — updates the queue rows + stats text in place
  //                           on every tick (does NOT touch inputs)
  let _bodyBuiltFor = null; // signature of last full body rebuild

  function renderToggle() {
    const toggle = document.getElementById('pintwist-auto-toggle');
    if (!toggle || !state) return;
    const cooldownLeft = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
    const inCooldown = cooldownLeft > 0;
    toggle.innerHTML =
      (state.panelExpanded ? '&#9660;' : '&#9654;') +
      ' &#129302; Automation' +
      (state.running ? ' <span class="pintwist-auto-dot"></span>' : '') +
      (inCooldown ? ' <span class="pintwist-auto-cooldown">' + fmtCountdown(cooldownLeft) + '</span>' : '');
    toggle.classList.toggle('pintwist-auto-toggle--open', !!state.panelExpanded);
    toggle.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await saveState({ panelExpanded: !state.panelExpanded });
    };
  }

  function bodySignature() {
    // Only the things that require a full rebuild. Form-control values are
    // intentionally NOT in the signature — the user owns them after open.
    return JSON.stringify({
      e: !!state.panelExpanded,
      n: state.terms.length,
      // include status of every term so the queue rebuilds when statuses change
      s: state.terms.map((t) => t.status + ':' + (t.pinCount || 0)).join(','),
    });
  }

  function renderBodyScaffold() {
    const body = document.getElementById('pintwist-auto-body');
    if (!body || !state) return;

    if (!state.panelExpanded) {
      body.style.display = 'none';
      body.innerHTML = '';
      _bodyBuiltFor = null;
      return;
    }
    body.style.display = 'block';

    const sig = bodySignature();
    if (sig === _bodyBuiltFor) return; // no rebuild needed
    _bodyBuiltFor = sig;

    // Preserve any in-flight user input across rebuilds (rare path).
    const prev = (() => {
      const ta = document.getElementById('pintwist-auto-terms');
      const pages = document.getElementById('pintwist-auto-pages');
      const interval = document.getElementById('pintwist-auto-interval');
      const pct = document.getElementById('pintwist-auto-randomize-pct');
      return {
        terms: ta && ta.value,
        pages: pages && pages.value,
        interval: interval && interval.value,
        pct: pct && pct.value,
      };
    })();

    const cooldownLeft = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
    const inCooldown = cooldownLeft > 0;


    body.innerHTML =
      // Search-term entry: textarea + Add button. Adding APPENDS to queue
      // (deduped) instead of replacing — terms accumulate as pills below.
      '<div class="pintwist-auto-row-fields">' +
      '<label class="pintwist-auto-label">Add search terms (comma or newline separated):</label>' +
      '<div class="pintwist-auto-add-row">' +
      '<textarea id="pintwist-auto-terms" class="pintwist-auto-textarea" rows="2" placeholder="boho wall art, vintage florals, cottagecore prints">' +
      escAuto(typeof prev.terms === 'string' ? prev.terms : '') +
      '</textarea>' +
      '<button id="pintwist-auto-add" type="button" class="pintwist-auto-btn pintwist-auto-btn--primary">+ Add to queue</button>' +
      '</div>' +
      '</div>' +
      // Single combined control row: settings + master toggle + actions +
      // countdown all on one line. Falls back to wrap on narrow viewports.
      // ▶ skips the countdown and runs the current term right now.
      // ✗ turns the toggle off (mirrors the pill buttons' semantics).
      '<div class="pintwist-auto-master-row">' +
      '<label class="pintwist-auto-inline-field">Pages ' +
      numField('pintwist-auto-pages', 1, 100, 1, prev.pages || state.pagesPerTerm) +
      '</label>' +
      '<label class="pintwist-auto-inline-field">Interval&nbsp;(min) ' +
      numField('pintwist-auto-interval', 0.25, 180, 0.25, prev.interval || state.intervalMin) +
      '</label>' +
      '<label class="pintwist-auto-checkbox"><input type="checkbox" id="pintwist-auto-randomize" ' +
      (state.randomize ? 'checked' : '') +
      '> Randomize &plusmn;' +
      numField('pintwist-auto-randomize-pct', 0, 95, 1, prev.pct || state.randomizePct, 'pintwist-auto-num--xs') +
      '%</label>' +
      '<span class="pintwist-auto-countdown" id="pintwist-auto-countdown"></span>' +
      '<span class="pintwist-auto-divider"></span>' +
      '<label class="pintwist-auto-switch">' +
      '<input type="checkbox" id="pintwist-auto-running"' +
      (state.running ? ' checked' : '') +
      // Unavailable until the queue has at least one term (or during a cooldown). An empty
      // queue means there's nothing to run, so starting automation makes no sense. Kept in
      // sync live by renderQueueAndStats() as terms are added/removed.
      (inCooldown || state.terms.length === 0 ? ' disabled' : '') +
      '>' +
      '<span class="pintwist-auto-switch-track"><span class="pintwist-auto-switch-thumb"></span></span>' +
      '<span class="pintwist-auto-switch-label">Run automation</span>' +
      '</label>' +
      '<div class="pintwist-auto-actions">' +
      '<button id="pintwist-auto-runnow" class="pintwist-auto-btn pintwist-auto-btn--primary" type="button" title="Run next term now (skip countdown)">Run now</button>' +
      '<button id="pintwist-auto-off" class="pintwist-auto-btn" type="button" title="Turn automation off">Stop</button>' +
      '<button id="pintwist-auto-clear" class="pintwist-auto-btn" type="button">Clear queue</button>' +
      '</div>' +
      '<span class="pintwist-auto-stats" id="pintwist-auto-stats"></span>' +
      // (Local Catalog button moved to the main bar so it's reachable without opening Automation.)
      '</div>' +
      // Queue rows LAST so the controls above always stay visible; a long queue scrolls in place.
      '<div class="pintwist-auto-queue-list" id="pintwist-auto-queue"></div>';

    wireBody(body);
    renderQueueAndStats();
  }

  function renderQueueAndStats() {
    if (!state || !state.panelExpanded) return;
    const queueEl = document.getElementById('pintwist-auto-queue');
    const statsEl = document.getElementById('pintwist-auto-stats');
    const cdEl = document.getElementById('pintwist-auto-countdown');
    if (!queueEl) return;

    // Queue rows: readable term/status text plus Run and Remove actions.
    const rows = state.terms
      .map((t, i) => {
        // "scanning" is shown ONLY when this term is actually scanning right now —
        // status 'running' (committed to/mid scan) or the scan progress panel is up.
        // During the inter-term countdown the next term is just pending, not scanning.
        const isScanning =
          i === state.currentIdx &&
          state.running &&
          (t.status === 'running' || !!document.getElementById('pintwist-progress-panel'));
        const cls =
          'pintwist-auto-queue-row pintwist-auto-queue-row--' +
          t.status +
          (isScanning ? ' pintwist-auto-queue-row--current' : '');
        const pinCount = t.pinCount || 0;
        const detail =
          t.status === 'done'
            ? pinCount + ' pins · CSV downloaded'
            : t.status === 'failed'
              ? 'failed'
              : t.status === 'cancelled'
                ? 'cancelled'
                : isScanning
                  ? 'scanning...'
                  : 'pending';
        // Visible status badge so it's obvious which terms have run (and that a CSV was saved).
        const badge =
          t.status === 'done'
            ? '<span class="pintwist-auto-queue-badge pintwist-auto-queue-badge--done">&#10003; ' +
              pinCount +
              ' <span class="pintwist-auto-queue-csv" title="A CSV was downloaded for this search">&#8675;CSV</span></span>'
            : t.status === 'failed'
              ? '<span class="pintwist-auto-queue-badge pintwist-auto-queue-badge--failed">&#9888; failed</span>'
              : t.status === 'cancelled'
                ? '<span class="pintwist-auto-queue-badge pintwist-auto-queue-badge--cancelled">cancelled</span>'
                : isScanning
                  ? '<span class="pintwist-auto-queue-badge pintwist-auto-queue-badge--current">scanning&hellip;</span>'
                  : '';
        return (
          '' +
          '<div class="' +
          cls +
          '" data-idx="' +
          i +
          '" data-term="' +
          escAuto(t.term) +
          '" title="' +
          escAuto(t.term + ' — ' + detail) +
          '">' +
          '<span class="pintwist-auto-queue-term">' +
          escAuto(t.term) +
          '</span>' +
          badge +
          '<button type="button" class="pintwist-auto-pill-play pintwist-auto-queue-run" data-idx="' +
          i +
          '" title="Run this term now" aria-label="Run now">&#9654;</button>' +
          '<button type="button" class="pintwist-auto-pill-x pintwist-auto-queue-remove" data-idx="' +
          i +
          '" title="Remove" aria-label="Remove">&#215;</button>' +
          '</div>'
        );
      })
      .join('');
    queueEl.innerHTML = rows || '<div class="pintwist-auto-empty">Queue is empty. Add search terms above.</div>';

    // Keep the "Run automation" toggle in sync with the queue: unavailable when the queue is
    // empty (nothing to run) or during a cooldown. Re-evaluated here so adding/removing terms
    // flips it live without rebuilding the whole panel.
    const runEl = document.getElementById('pintwist-auto-running');
    if (runEl) {
      const cooldownLeft = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
      const isEmpty = state.terms.length === 0;
      runEl.disabled = cooldownLeft > 0 || isEmpty;
      const switchLabel = runEl.closest('.pintwist-auto-switch');
      if (switchLabel) switchLabel.title = isEmpty ? 'Add at least one search term to the queue first' : '';
    }

    if (statsEl) {
      const doneCount = state.terms.filter((x) => x.status === 'done').length;
      const failedCount = state.terms.filter((x) => x.status === 'failed').length;
      statsEl.innerHTML =
        state.terms.length === 0
          ? ''
          : doneCount +
            '/' +
            state.terms.length +
            ' done' +
            (failedCount ? ' &middot; ' + failedCount + ' failed' : '');
    }

    // Live countdown — shows time until next scan, or scan-in-progress, or
    // cooldown remaining, or idle. Updates every 1s via the existing tick.
    if (cdEl) {
      const cooldownLeft = state.cooldownUntil ? state.cooldownUntil - Date.now() : 0;
      const inCooldown = cooldownLeft > 0;
      const isScanning = !!document.getElementById('pintwist-progress-panel');
      let txt;
      if (inCooldown)
        txt =
          '<span class="pintwist-auto-cd--cooldown">Cooldown: <strong>' +
          fmtCountdown(cooldownLeft) +
          '</strong></span>';
      else if (isScanning) txt = '<span class="pintwist-auto-cd--scanning">Scanning now…</span>';
      // Only show a countdown while automation is actually ON — guards against a
      // stray scheduled timer surviving past queue completion / toggle-off.
      // Prefer the persisted deadline (state.nextNavAt) over the in-memory timer
      // (_pendingNextDeadline) so a page refresh shows the real countdown immediately instead
      // of a "Starting…" gap until the local timer is re-armed.
      else if (state.running && Math.max(_pendingNextDeadline || 0, state.nextNavAt || 0) > Date.now())
        txt =
          'Next scan in <strong>' +
          fmtCountdown(Math.max(_pendingNextDeadline || 0, state.nextNavAt || 0) - Date.now()) +
          '</strong>';
      else if (state.running) txt = '<span class="pintwist-auto-cd--idle">Starting…</span>';
      // Idle: show WHY automation last stopped (set by autoSetOff / triggerCooldown) so a
      // self-pause is never a mystery; plain "Off" only when there's no recorded reason.
      else txt = '<span class="pintwist-auto-cd--off">' + (state.pauseReason ? escAuto(state.pauseReason) : 'Off') + '</span>';
      cdEl.innerHTML = txt;
    }
  }

  function renderPanel() {
    renderToggle();
    renderBodyScaffold();
  }

  // Read the current settings inputs (pages / interval / randomize) and
  // persist them. Called from the toggle + the "Add" button + ▶ pill click.
  async function persistSettingsFromInputs(wrap) {
    const $ = (id) => wrap.querySelector('#' + id);
    const pagesPerTerm = Math.max(1, Math.min(100, parseInt($('pintwist-auto-pages').value, 10) || 40));
    const intervalMin = Math.max(0.25, Math.min(180, parseFloat($('pintwist-auto-interval').value) || 1));
    const randomizePct = Math.max(0, Math.min(95, parseInt($('pintwist-auto-randomize-pct').value, 10) || 40));
    await saveState({ pagesPerTerm, intervalMin, randomizePct, randomize: !!$('pintwist-auto-randomize').checked });
  }

  function wireBody(wrap) {
    const $ = (id) => wrap.querySelector('#' + id);
    const addBtn = $('pintwist-auto-add');
    const runningSwitch = $('pintwist-auto-running');
    const clearBtn = $('pintwist-auto-clear');
    const catalogBtn = $('pintwist-auto-catalog');
    if (catalogBtn)
      catalogBtn.addEventListener('click', () => {
        try {
          chrome.runtime.sendMessage({ action: 'openCatalog' }, () => {
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          });
        } catch {
          /* non-fatal */
        }
      });
    const randomize = $('pintwist-auto-randomize');
    const queueEl = $('pintwist-auto-queue');

    // Add to queue: APPEND new terms (deduped against existing), don't replace.
    const doAdd = async () => {
      const ta = $('pintwist-auto-terms');
      const terms = parseTerms(ta.value);
      if (terms.length === 0) {
        alert('Paste at least one search term.');
        return;
      }
      const existing = new Set(state.terms.map((t) => t.term.trim().toLowerCase()));
      const toAdd = terms.filter((t) => !existing.has(t.trim().toLowerCase()));
      if (toAdd.length === 0) {
        ta.value = '';
        alert('All those terms are already in the queue.');
        return;
      }
      const newItems = toAdd.map((t) => ({ term: t, status: 'pending' }));
      ta.value = '';
      await persistSettingsFromInputs(wrap);
      // Keep the panel open after adding — adding terms should never collapse it.
      await saveState({ terms: state.terms.concat(newItems), panelExpanded: true });
    };
    if (addBtn) addBtn.addEventListener('click', doAdd);
    // Enter submits (Shift+Enter inserts newline, the standard convention).
    const ta = $('pintwist-auto-terms');
    if (ta)
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          doAdd();
        }
      });

    // Master ON/OFF toggle.
    //   ON  → save running=true, persist settings, schedule first scan after
    //         the configured interval (with jitter). The countdown is visible
    //         immediately so the user can see what's coming + has a window to
    //         hit ▶ (run now) or ✗ (off) before anything fires.
    //   OFF → save running=false, cancel any pending timeout. Does NOT abort
    //         an in-progress scan; use Cancel scan for that.
    if (runningSwitch)
      runningSwitch.addEventListener('change', async (e) => {
        const on = !!e.target.checked;
        // Defense in depth: the toggle is disabled when the queue is empty, but guard the
        // handler too so automation can never start with nothing queued.
        if (on && state.terms.length === 0) {
          e.target.checked = false;
          return;
        }
        if (on) {
          if (
            state.terms.filter((t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled')
              .length === 0
          ) {
            if (!confirm('Queue has no pending terms. Reset cancelled/failed terms and start over?')) {
              e.target.checked = false;
              return;
            }
            state.terms = state.terms.map((t) =>
              t.status === 'cancelled' || t.status === 'failed' ? { term: t.term, status: 'pending' } : t
            );
            state.currentIdx = state.terms.findIndex((x) => x.status !== 'done');
            if (state.currentIdx === -1) state.currentIdx = 0;
          }
          try {
            if (typeof State !== 'undefined') State.aborted = false;
          } catch {}
          await persistSettingsFromInputs(wrap);
          await saveState({ running: true, cooldownUntil: 0, nextNavAt: 0, pauseReason: '' });
          // Schedule first scan with a countdown (instead of firing immediately)
          // so the user sees what's about to happen + can ▶/✗ before it runs.
          schedulePending(() => runOnceForCurrentPage(true), jitterDelayMs());
          renderQueueAndStats();
        } else {
          clearPending();
          await autoSetOff('Stopped');
        }
      });

    // ▶ Run now: cancel any pending countdown, kick off immediately.
    const runNowBtn = $('pintwist-auto-runnow');
    if (runNowBtn)
      runNowBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearPending();
        try {
          if (typeof State !== 'undefined') State.aborted = false;
        } catch {}
        // Make sure we're running and persist settings before kicking off.
        if (
          state.terms.filter((t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled').length ===
          0
        ) {
          // Reset cancelled/failed so a Run now after everything's done still works.
          state.terms = state.terms.map((t) =>
            t.status === 'cancelled' || t.status === 'failed' ? { term: t.term, status: 'pending' } : t
          );
          state.currentIdx = state.terms.findIndex((x) => x.status !== 'done');
          if (state.currentIdx === -1) state.currentIdx = 0;
        }
        await persistSettingsFromInputs(wrap);
        await saveState({ running: true, cooldownUntil: 0, nextNavAt: 0, pauseReason: '' });
        runOnceForCurrentPage(true).catch(pintwistRunErr);
      });

    // ✗ Turn off: same effect as flipping the toggle to off.
    const offBtn = $('pintwist-auto-off');
    if (offBtn)
      offBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearPending();
        await autoSetOff('Stopped', { nextNavAt: 0 });
        // Reflect on the toggle UI (state-change re-render handles the rest).
        if (runningSwitch) runningSwitch.checked = false;
      });

    // Pill clicks (delegated): ▶ = run now, ✗ = remove
    if (queueEl)
      queueEl.addEventListener('click', async (e) => {
        const playBtn = e.target.closest('.pintwist-auto-pill-play');
        const xBtn = e.target.closest('.pintwist-auto-pill-x');
        if (playBtn) {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(playBtn.dataset.idx, 10);
          if (isNaN(idx) || !state.terms[idx]) return;
          // Reset this term's status if it was done/failed/cancelled, then jump
          // currentIdx to it and turn on running.
          if (state.terms[idx].status !== 'pending') {
            state.terms[idx] = { term: state.terms[idx].term, status: 'pending' };
          }
          clearPending();
          try {
            if (typeof State !== 'undefined') State.aborted = false;
          } catch {}
          await persistSettingsFromInputs(wrap);
          await saveState({ currentIdx: idx, running: true, cooldownUntil: 0, nextNavAt: 0, pauseReason: '' });
          runOnceForCurrentPage(true).catch(pintwistRunErr);
          return;
        }
        if (xBtn) {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(xBtn.dataset.idx, 10);
          if (isNaN(idx)) return;
          const newTerms = state.terms.slice(0, idx).concat(state.terms.slice(idx + 1));
          let newIdx = state.currentIdx;
          if (idx < state.currentIdx) newIdx -= 1;
          else if (idx === state.currentIdx) newIdx = Math.min(newIdx, newTerms.length - 1);
          await saveState({ terms: newTerms, currentIdx: Math.max(0, newIdx) });
          return;
        }
      });

    if (clearBtn)
      clearBtn.addEventListener('click', async () => {
        if ((state.running || state.terms.length > 0) && !confirm('Clear the entire queue?')) return;
        try {
          if (typeof State !== 'undefined') State.aborted = true;
        } catch {}
        clearPending();
        await saveState({ terms: [], currentIdx: 0, running: false, nextNavAt: 0, pauseReason: '' });
      });

    if (randomize)
      randomize.addEventListener('change', async (e) => {
        await saveState({ randomize: e.target.checked });
        rescheduleIfPending();
      });

    // Live-reschedule the pending countdown when interval / randomize-pct changes,
    // so the on-screen "Next scan in X" reflects the new value immediately.
    const intervalInput = $('pintwist-auto-interval');
    const pctInput = $('pintwist-auto-randomize-pct');
    const onSettingChange = async () => {
      await persistSettingsFromInputs(wrap);
      rescheduleIfPending();
    };
    if (intervalInput) {
      intervalInput.addEventListener('change', onSettingChange);
      intervalInput.addEventListener('input', onSettingChange);
    }
    if (pctInput) {
      pctInput.addEventListener('change', onSettingChange);
      pctInput.addEventListener('input', onSettingChange);
    }

    // Custom number-spinner clicks (delegated). Honors min/max/step from the
    // input's data-* attributes, fires "input" + "change" so any listeners
    // wired to the input (like settings-persist) trigger normally.
    wrap.addEventListener('click', (e) => {
      const upBtn = e.target.closest('.pintwist-auto-num-up');
      const downBtn = e.target.closest('.pintwist-auto-num-down');
      const btn = upBtn || downBtn;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const input = wrap.querySelector('#' + btn.dataset.target);
      if (!input) return;
      const step = parseFloat(input.dataset.step) || 1;
      const min = parseFloat(input.dataset.min);
      const max = parseFloat(input.dataset.max);
      const cur = parseFloat(input.value) || 0;
      let next = upBtn ? cur + step : cur - step;
      if (!isNaN(min) && next < min) next = min;
      if (!isNaN(max) && next > max) next = max;
      // Round-trip through step grid to avoid float drift (e.g. 0.25 + 0.25 etc.)
      const decimals = (String(step).split('.')[1] || '').length;
      input.value = decimals ? next.toFixed(decimals) : String(Math.round(next));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  // 1s tick: only refresh the toggle (cooldown countdown) and queue/stats.
  // Never re-render the form fields here — that destroys focus and pasted text.
  const __pintwistAutoTick = setInterval(() => {
    if (typeof pintwistContextAlive === 'function' && !pintwistContextAlive()) {
      clearInterval(__pintwistAutoTick);
      return;
    }
    if (!state) return;
    renderToggle();
    if (state.panelExpanded) renderQueueAndStats();
  }, 1000);

  async function bootstrap() {
    await loadState();
    const tryMount = () => {
      const bar = getActiveBar();
      if (bar && !bar.querySelector('#pintwist-auto-toggle')) {
        ensurePanel();
        renderPanel();
        runOnceForCurrentPage().catch(pintwistRunErr);
      }
      // Also inject a Cancel button into the scan-progress popup whenever it
      // appears. This is visible during the actual scan when the toolbar is
      // hidden. Works for both manual sorts and automation runs.
      ensureProgressCancelButton();
      return !!bar;
    };
    tryMount();
    // Permanent observer: re-attach across SPA navigations + sort_all rebuilds.
    // Debounced: Pinterest's infinite-scroll feed fires childList/subtree
    // mutations constantly, so coalesce bursts into one idempotent tryMount
    // (~150ms) instead of running it on every mutation.
    let mountScheduled = false;
    const obs = new MutationObserver(() => {
      if (mountScheduled) return;
      mountScheduled = true;
      setTimeout(() => {
        mountScheduled = false;
        tryMount();
      }, 150);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(bootstrap, 2500);
  } else {
    window.addEventListener('load', () => setTimeout(bootstrap, 2500));
  }

  window.__pintwistAutomationMount = async function () {
    try {
      await loadState();
      ensurePanel();
      renderPanel();
      ensureProgressCancelButton();
    } catch {}
  };
})();

/* Final unified glass UI pass: keep initial and sorted rails visually identical. */
(function pintwistUnifiedGlassUi() {
  const SORT_OPTIONS = [
    ['saves', 'Saves'],
    ['share', 'Shares'],
    ['reaction', 'Reactions'],
    ['repin', 'Repins'],
    ['comment', 'Comments'],
    ['date', 'Last activity'],
  ];

  function pintwistGlassSortGridHTML(activeMetric, id) {
    return (
      '<div class="pintwist-sort-grid" id="' +
      id +
      '" role="group" aria-label="Sort pins">' +
      SORT_OPTIONS.map(
        ([value, label]) =>
          '<button class="pintwist-sort-choice' +
          (value === activeMetric ? ' is-active' : '') +
          '" type="button" data-value="' +
          value +
          '" aria-pressed="' +
          (value === activeMetric ? 'true' : 'false') +
          '">' +
          label +
          '</button>'
      ).join('') +
      '</div>'
    );
  }

  function pintwistPillSortSelectHTML(activeMetric) {
    return (
      '<select class="pintwist-pill-sort" id="pintwist-pill-sort" aria-label="Sort by">' +
      SORT_OPTIONS.map(
        ([value, label]) =>
          '<option value="' + value + '"' + (value === activeMetric ? ' selected' : '') + '>' + label + '</option>'
      ).join('') +
      '</select>'
    );
  }

  // One-row pill markup. Reuses the SAME control ids as the rail bar so all the
  // existing wiring (sort grid, pages, search, overlays, settings) works unchanged.
  // The sort grid is present-but-hidden (the dropdown drives it); secondary controls
  // live in a panel revealed by the ⋯ button.
  function pintwistPillInnerHTML(selected) {
    const v = currentVersion();
    return (
      '' +
      pintwistLogoHTML(v) +
      pintwistPillSortSelectHTML(selected) +
      pintwistGlassSortGridHTML(selected, 'pintwist-initial-sort-grid') +
      '<input type="hidden" id="pintwist-initial-sort-option" value="' +
      escapeAttr(selected) +
      '">' +
      '<div class="pintwist-pages-row">' +
      '<input type="number" id="pintwist-pages-input" class="pintwist-pages-input" value="4" min="1" max="50">' +
      '<button id="pintwist-sort-pins-btn" class="pintwist-sort-btn" type="button">Sort pins</button>' +
      '</div>' +
      '<div class="pintwist-search-wrapper"><input type="text" id="pintwist-search-input-initial" placeholder="Search" value=""><button id="pintwist-search-btn-initial" type="button">Go</button></div>' +
      '<label class="pintwist-checkbox-wrapper"><input id="pintwist-show-overlays" type="checkbox" checked> <span>Overlays</span></label>' +
      // #pintwist-catalog-count carries margin-left:auto — everything from here on is
      // right-aligned. Keep the Tutorial link (and the automation toggle, which is
      // inserted right before it) AFTER this point so they sit on the right.
      '<span id="pintwist-catalog-count" class="pintwist-catalog-count" title="Saved pins (manual scans)">0 saved</span>' +
      '<button id="pintwist-catalog-export" class="pintwist-catalog-export" type="button" title="Download all saved pins as CSV" aria-label="Download all saved pins as CSV">&#8675; CSV</button>' +
      '<button id="pintwist-bar-catalog" class="pintwist-bar-catalog" type="button" title="Open the local catalog">Local Catalog</button>' +
      // Settings (download folder / ask-each-time). Was dropped when the pill was
      // simplified; restored here. Wiring lives at the pill setup (settings-link-initial).
      '<button id="pintwist-settings-link-initial" class="pintwist-settings-link" type="button" title="Settings" aria-label="Settings">⚙</button>' +
      '<div id="pintwist-settings-panel" class="pintwist-settings-panel" hidden>' +
      '<div class="pintwist-settings-row"><label for="pintwist-settings-folder">Download folder</label><input type="text" id="pintwist-settings-folder" placeholder="PinTwist" autocomplete="off"></div>' +
      '<div class="pintwist-settings-hint">Images &amp; CSV save to this folder under your browser&#39;s Downloads.</div>' +
      '<button type="button" id="pintwist-settings-done" class="pintwist-settings-done" style="margin-top:8px;width:100%;height:34px;border:none;border-radius:8px;background:var(--pintwist-primary,#F0002D);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">Done</button>' +
      '</div>' +
      '<span id="pintwist-pill-version" class="pintwist-pill-version">v' +
      escapeAttr(v) +
      '</span>' +
      // Far-right cluster: the automation toggle is inserted (by ensurePanel) just
      // before this Tutorial link, so both end up on the right of the bar.
      '<a class="pintwist-tutorial-link" href="https://youtube.com/@iScaleLabs" target="_blank" rel="noreferrer">Tutorial</a>'
    );
  }

  function pintwistLogoHTML(version) {
    let src = '';
    try {
      src = chrome.runtime.getURL('images/logo-wordmark.png');
    } catch {}
    const logo = src
      ? '<span class="pintwist-logo-wordmark pintwist-logo-wordmark--themed" style="--pintwist-logo-url:url(&quot;' +
        escapeAttr(src) +
        '&quot;)" role="img" aria-label="PinTwist"></span>'
      : '<strong class="pintwist-text-logo">PinTwist</strong>';
    return (
      '<div class="pintwist-logo-container">' +
      logo +
      '<span class="pintwist-version-label">v' +
      escapeAttr(version || '') +
      '</span></div>'
    );
  }

  function currentVersion() {
    try {
      return chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '';
    } catch {
      return '';
    }
  }

  function setSortGridActive(grid, metric) {
    if (!grid) return;
    grid.querySelectorAll('.pintwist-sort-choice').forEach((button) => {
      const active = button.dataset.value === metric;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applyThemeMode() {
    // Dark theme removed — PinTwist is light everywhere, regardless of any stored value.
    const root = document.documentElement;
    root.classList.add('pintwist-theme-light');
    root.classList.remove('pintwist-theme-dark');
    root.dataset.pintwistThemeMode = 'light';
    document.querySelectorAll('#pintwist-initial-bar,#pintwist-resort-bar').forEach((bar) => {
      bar.setAttribute('data-theme-mode', 'light');
      bar.classList.add('pintwist-unified-glass');
    });
  }

  function hydrateThemeMode() {
    try {
      chrome.storage.sync.get(['pintwist_theme_mode'], (result) => {
        applyThemeMode(result.pintwist_theme_mode);
      });
    } catch {
      applyThemeMode('dark');
    }
  }

  function normalizeLayoutMode(_mode) {
    // Rail layout was removed — the bar is ALWAYS built as pill (sort_all hardcodes
    // isPill=true). So always normalize to 'pill'. Returning 'rail' for any non-'pill'
    // stored value (incl. an unset/null `pintwist_layout_mode`, which is the default!)
    // made applyLayoutMode see a permanent mismatch vs the always-pill bar
    // (renderedMode 'pill' !== requested 'rail') and re-render via sort_all forever:
    // sort_all -> hydrateLayoutMode -> chrome.storage.sync.get (async) -> applyLayoutMode
    // -> sort_all. Each sort_all hides+remounts the shadow host, so the host churned
    // ~32x/sec (async-storage-throttled) = the visible flicker. (flicker fix)
    return 'pill';
  }

  function applyLayoutMode(mode) {
    const normalized = normalizeLayoutMode(mode);
    const root = document.documentElement;
    window.__pintwistLayout = normalized;
    root.classList.toggle('pintwist-layout-pill', normalized === 'pill');
    root.classList.toggle('pintwist-layout-rail', normalized !== 'pill');
    root.dataset.pintwistLayoutMode = normalized;
    // Re-render ONLY when the bar's actual mode differs from the requested one.
    // CRITICAL (caused a ~195/sec flicker loop): sort_all -> applyThemeColor
    // -> hydrateLayoutMode -> applyLayoutMode. An unconditional re-render here re-enters
    // forever. Comparing the rendered mode (the bar's pintwist-is-pill class) to the
    // requested mode makes the re-entrant call a no-op, so the loop can't close.
    const barEl = document.getElementById('pintwist-initial-bar');
    const renderedMode = barEl ? (barEl.classList.contains('pintwist-is-pill') ? 'pill' : 'rail') : null;
    if (barEl && renderedMode !== normalized && typeof window.sort_all === 'function') {
      try {
        removeContentOffset();
      } catch {}
      window.sort_all();
    } else if (!barEl && normalized !== 'pill' && document.getElementById('pintwist-resort-bar')) {
      try {
        applyContentOffset();
      } catch {}
    }
  }

  function hydrateLayoutMode() {
    try {
      chrome.storage.sync.get(['pintwist_layout_mode'], (result) => {
        applyLayoutMode(result.pintwist_layout_mode);
      });
    } catch {
      applyLayoutMode('rail');
    }
  }

  function injectGlassRailStyle() {
    if (document.getElementById('pintwist-glass-rail-style')) return;
    const style = document.createElement('style');
    style.id = 'pintwist-glass-rail-style';
    style.textContent = `
      :root{
        --pt-rail-bg:rgba(13,13,20,.96);
        --pt-panel:rgba(255,255,255,.075);
        --pt-panel-strong:rgba(255,255,255,.105);
        --pt-field:rgba(255,255,255,.08);
        --pt-field-strong:rgba(255,255,255,.12);
        --pt-line:rgba(255,255,255,.14);
        --pt-line-strong:rgba(255,255,255,.22);
        --pt-text:#f8fafc;
        --pt-muted:rgba(248,250,252,.72);
        --pt-faint:rgba(248,250,252,.48);
        --pt-green:var(--pintwist-primary,#4ade80);
        --pt-blue:#60a5fa;
        --pt-red:#f87171;
        --pt-glow-green:color-mix(in srgb, var(--pt-green) 28%, transparent);
        --pt-glow-blue:rgba(96,165,250,.26);
        --pt-secondary-bg:rgba(96,165,250,.14);
        --pt-secondary-bg-hover:rgba(96,165,250,.24);
        --pt-secondary-border:rgba(96,165,250,.42);
        --pt-secondary-text:#dbeafe;
        --pt-font-body:'DM Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        --pt-font-heading:'Syne','DM Sans',system-ui,sans-serif;
      }
      ${pintwistLightThemeTokenCss(':root.pintwist-theme-light')}
      #pintwist-initial-bar.pintwist-unified-glass,
      html.pintwist-docked #pintwist-resort-bar{
        color:var(--pt-text)!important;
        max-width:340px!important;
        font-family:var(--pt-font-body)!important;
        background:var(--pt-rail-bg)!important;
        border-right:1px solid var(--pt-line-strong)!important;
        box-shadow:10px 0 32px rgba(0,0,0,.38), inset 1px 0 0 rgba(255,255,255,.08)!important;
        backdrop-filter:blur(22px) saturate(150%)!important;
        -webkit-backdrop-filter:blur(22px) saturate(150%)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass::before,
      html.pintwist-docked #pintwist-resort-bar::before{
        content:""!important;position:absolute!important;inset:0!important;pointer-events:none!important;
        background:
          radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--pt-green) 16%, transparent), transparent 32%),
          radial-gradient(circle at 100% 20%, rgba(96,165,250,.14), transparent 30%)!important;
        opacity:1!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass > *,
      html.pintwist-docked #pintwist-resort-bar > *{position:relative!important;z-index:1!important}
      #pintwist-initial-bar .pintwist-logo-container,
      html.pintwist-docked #pintwist-resort-bar .pintwist-logo-container{justify-content:flex-start!important;border-bottom:1px solid var(--pt-line)!important}
      #pintwist-initial-bar .pintwist-logo-wordmark,
      html.pintwist-docked #pintwist-resort-bar .pintwist-logo-wordmark{display:block!important;width:auto!important;height:34px!important;max-width:132px!important;object-fit:contain!important;flex:0 0 auto!important}
      #pintwist-initial-bar .pintwist-logo-wordmark--themed,
      html.pintwist-docked #pintwist-resort-bar .pintwist-logo-wordmark--themed{width:112px!important;background:var(--pintwist-primary,#F0002D)!important;-webkit-mask-image:var(--pintwist-logo-url)!important;mask-image:var(--pintwist-logo-url)!important;-webkit-mask-repeat:no-repeat!important;mask-repeat:no-repeat!important;-webkit-mask-position:left center!important;mask-position:left center!important;-webkit-mask-size:contain!important;mask-size:contain!important}
      #pintwist-initial-bar .pintwist-text-logo,
      html.pintwist-docked #pintwist-resort-bar .pintwist-text-logo{color:var(--pintwist-primary,#F0002D)!important;font-family:var(--pt-font-heading)!important;font-size:22px!important;font-weight:900!important;line-height:1!important;letter-spacing:0!important;text-shadow:none!important}
      #pintwist-initial-bar .pintwist-version-label,
      html.pintwist-docked #pintwist-resort-bar .pintwist-version-label{color:var(--pt-muted)!important}
      #pintwist-initial-bar .pintwist-section-title,
      html.pintwist-docked #pintwist-resort-bar .pintwist-section-title,
      #pintwist-initial-bar .pintwist-pages-label,
      #pintwist-initial-bar .pintwist-sort-label,
      html.pintwist-docked #pintwist-resort-bar .pintwist-rail-label,
      html.pintwist-docked #pintwist-resort-bar label{color:var(--pt-muted)!important;font-size:11px!important;font-weight:800!important;text-transform:uppercase!important;letter-spacing:.12em!important}
      #pintwist-initial-bar .resort-info,
      html.pintwist-docked #pintwist-resort-bar .resort-info,
      #pintwist-initial-bar .pintwist-tutorial-link,
      html.pintwist-docked #pintwist-resort-bar .pintwist-tutorial-link,
      #pintwist-initial-bar #pintwist-settings-panel,
      html.pintwist-docked #pintwist-resort-bar #pintwist-settings-panel,
      #pintwist-auto-body,
      html.pintwist-docked #pintwist-resort-bar > #pintwist-filter-bar{
        background:var(--pt-panel)!important;border:1px solid var(--pt-line)!important;color:var(--pt-text)!important;border-radius:8px!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08), 0 10px 26px rgba(0,0,0,.18)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;
      }
      #pintwist-initial-bar input,
      #pintwist-initial-bar select,
      #pintwist-initial-bar textarea,
      html.pintwist-docked #pintwist-resort-bar input,
      html.pintwist-docked #pintwist-resort-bar select,
      html.pintwist-docked #pintwist-resort-bar textarea{
        min-height:34px!important;height:34px!important;background:var(--pt-field)!important;border:1px solid var(--pt-line)!important;color:var(--pt-text)!important;border-radius:8px!important;font-family:var(--pt-font-body)!important;font-size:13px!important;font-weight:700!important;transition:border-color .2s ease, box-shadow .2s ease, background .2s ease!important;
      }
      #pintwist-initial-bar input:focus,
      #pintwist-initial-bar select:focus,
      #pintwist-initial-bar textarea:focus,
      html.pintwist-docked #pintwist-resort-bar input:focus,
      html.pintwist-docked #pintwist-resort-bar select:focus,
      html.pintwist-docked #pintwist-resort-bar textarea:focus{
        border-color:var(--pt-green)!important;box-shadow:0 0 0 3px var(--pt-glow-green), inset 0 1px 0 rgba(255,255,255,.08)!important;outline:0!important;background:var(--pt-field-strong)!important;
      }
      #pintwist-initial-bar input::placeholder,
      #pintwist-initial-bar textarea::placeholder,
      html.pintwist-docked #pintwist-resort-bar input::placeholder,
      html.pintwist-docked #pintwist-resort-bar textarea::placeholder{color:var(--pt-faint)!important}
      #pintwist-initial-bar button,
      #pintwist-initial-bar .pintwist-auto-btn,
      html.pintwist-docked #pintwist-resort-bar button,
      html.pintwist-docked #pintwist-resort-bar .pintwist-auto-btn{
        min-height:34px!important;height:34px!important;width:100%!important;border-radius:8px!important;border:1px solid var(--pt-line-strong)!important;background:var(--pt-field)!important;color:var(--pt-text)!important;font-family:var(--pt-font-body)!important;font-size:13px!important;font-weight:800!important;text-transform:none!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)!important;transition:background .2s ease,border-color .2s ease,box-shadow .2s ease,transform .2s ease!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-sort-choice,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-sort-choice{
        min-height:34px!important;height:34px!important;background:var(--pt-field)!important;color:var(--pt-text)!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;font-size:13px!important;font-weight:850!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-sort-grid,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-sort-grid{
        display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important;width:100%!important;max-width:100%!important;
      }
      #pintwist-initial-bar .pintwist-sort-choice.is-active,
      #pintwist-initial-bar .pintwist-sort-choice[aria-pressed="true"],
      html.pintwist-docked #pintwist-resort-bar .pintwist-sort-choice.is-active,
      html.pintwist-docked #pintwist-resort-bar .pintwist-sort-choice[aria-pressed="true"],
      #pintwist-initial-bar .pintwist-sort-btn,
      #pintwist-initial-bar #pintwist-search-btn-initial,
      html.pintwist-docked #pintwist-resort-bar #pintwist-search-btn,
      html.pintwist-docked #pintwist-resort-bar #pintwist-filter-toggle,
      html.pintwist-docked #pintwist-resort-bar #pintwist-download-csv-btn,
      #pintwist-initial-bar #pintwist-settings-link-initial,
      html.pintwist-docked #pintwist-resort-bar #pintwist-settings-link-resort,
      #pintwist-auto-toggle{
        background:rgba(96,165,250,.18)!important;border-color:rgba(96,165,250,.42)!important;color:#dbeafe!important;box-shadow:0 0 18px var(--pt-glow-blue), inset 0 1px 0 rgba(255,255,255,.1)!important;
      }
      #pintwist-initial-bar .pintwist-sort-choice.is-active,
      #pintwist-initial-bar .pintwist-sort-choice[aria-pressed="true"],
      html.pintwist-docked #pintwist-resort-bar .pintwist-sort-choice.is-active,
      html.pintwist-docked #pintwist-resort-bar .pintwist-sort-choice[aria-pressed="true"],
      #pintwist-initial-bar .pintwist-sort-btn,
      #pintwist-initial-bar #pintwist-search-btn-initial,
      html.pintwist-docked #pintwist-resort-bar #pintwist-search-btn{
        background:var(--pt-green)!important;border-color:color-mix(in srgb, var(--pt-green) 55%, rgba(255,255,255,.2))!important;color:#06120c!important;box-shadow:0 0 20px var(--pt-glow-green), inset 0 1px 0 rgba(255,255,255,.28)!important;
      }
      #pintwist-initial-bar .pintwist-search-wrapper,
      #pintwist-initial-bar .pintwist-search-row,
      html.pintwist-docked #pintwist-resort-bar .pintwist-search-row{display:grid!important;grid-template-columns:minmax(0,1fr) 52px!important;width:100%!important}
      #pintwist-initial-bar #pintwist-search-input-initial,
      html.pintwist-docked #pintwist-resort-bar #pintwist-search-input{border-right:0!important;border-radius:8px 0 0 8px!important;width:100%!important}
      #pintwist-initial-bar #pintwist-search-btn-initial,
      html.pintwist-docked #pintwist-resort-bar #pintwist-search-btn{border-radius:0 8px 8px 0!important;width:52px!important}
      #pintwist-initial-bar .pintwist-pages-input,
      #pintwist-initial-bar #pintwist-pages-input,
      html.pintwist-docked #pintwist-resort-bar .pintwist-pages-input{
        background:var(--pt-field-strong)!important;color:var(--pt-text)!important;border:1px solid var(--pt-line-strong)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)!important;
      }
      #pintwist-initial-bar .pintwist-pages-row,
      html.pintwist-docked #pintwist-resort-bar .pintwist-pages-row{
        display:grid!important;grid-template-columns:72px minmax(0,1fr)!important;gap:8px!important;width:100%!important;align-items:center!important;
      }
      #pintwist-initial-bar .pintwist-pages-row .pintwist-pages-input,
      #pintwist-initial-bar .pintwist-pages-row .pintwist-sort-btn,
      html.pintwist-docked #pintwist-resort-bar .pintwist-pages-row .pintwist-sort-btn{width:100%!important}
      /* ===== Pill layout (clean rebuild) =====
         Bar-level layout (position/size/row/border) is set INLINE on the element in
         the render + applyThemeColor — never via a gated class block, so nothing can
         silently override it. These rules only style the CHILDREN of the one-row pill. */
      #pintwist-initial-bar.pintwist-is-pill .pintwist-sort-grid,
      #pintwist-initial-bar.pintwist-is-pill .pintwist-section-title,
      #pintwist-initial-bar.pintwist-is-pill .pintwist-logo-container .pintwist-version-label{display:none!important}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-logo-container{display:flex!important;align-items:center!important;flex:0 0 auto!important;width:auto!important;max-width:150px!important;margin:0 2px 0 0!important;padding:0!important;border:0!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-pill-sort{display:inline-block!important;flex:0 0 auto!important;width:auto!important;height:34px!important;border-radius:9px!important;padding:0 10px!important;font-weight:800!important;background:var(--pt-field-strong)!important;color:var(--pt-text)!important;border:1px solid var(--pt-line-strong)!important;cursor:pointer!important}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pages-row{display:flex!important;flex:0 0 auto!important;width:auto!important;gap:6px!important;align-items:center!important;margin:0!important;grid-template-columns:none!important}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pages-row .pintwist-pages-input{flex:0 0 50px!important;width:50px!important;height:34px!important}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pages-row .pintwist-sort-btn{flex:0 0 auto!important;width:auto!important;height:34px!important;white-space:nowrap!important;padding:0 14px!important}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-search-wrapper{display:flex!important;flex:0 1 200px!important;width:200px!important;max-width:200px!important;height:34px!important;margin:0!important}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-search-wrapper #pintwist-search-input-initial{flex:1 1 auto!important;min-width:0!important;height:34px!important;padding:0 10px!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-search-input-initial::placeholder{color:#9a9a9a!important;opacity:1!important;font-weight:500!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-pill-version{display:inline-flex!important;align-items:center!important;flex:0 0 auto!important;width:auto!important;max-width:max-content!important;margin-left:8px!important;font-size:12px!important;font-weight:700!important;color:#8a8a8a!important;white-space:nowrap!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-catalog-count{flex:0 0 auto!important;width:auto!important;max-width:max-content!important;margin-left:auto!important;display:inline-flex!important;align-items:center!important;height:34px!important;font-size:12px!important;font-weight:700!important;white-space:nowrap!important;color:#5c6270!important;background:transparent!important;border:0!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-catalog-export{flex:0 0 auto!important;width:auto!important;max-width:max-content!important;display:inline-flex!important;align-items:center!important;gap:5px!important;height:34px!important;padding:0 12px!important;border-radius:8px!important;font-size:12px!important;font-weight:700!important;cursor:pointer!important;white-space:nowrap!important;background:var(--pintwist-primary,#F0002D)!important;border:1px solid var(--pintwist-primary,#F0002D)!important;color:#fff!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-bar-catalog{flex:0 0 auto!important;width:auto!important;max-width:max-content!important;display:inline-flex!important;align-items:center!important;height:34px!important;padding:0 12px!important;border-radius:8px!important;font-size:12px!important;font-weight:700!important;cursor:pointer!important;white-space:nowrap!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;color:var(--pt-text)!important}
      /* Settings ⚙: small auto-width icon button — override the glass .pintwist-settings-link{width:100%} rule (meant for the stacked panel buttons) so it doesn't stretch across the whole bar. */
      #pintwist-initial-bar.pintwist-is-pill #pintwist-settings-link-initial{flex:0 0 auto!important;width:auto!important;min-width:0!important;max-width:max-content!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;height:34px!important;min-height:34px!important;padding:0 10px!important;border-radius:8px!important;font-size:15px!important;line-height:1!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;color:var(--pt-text)!important;cursor:pointer!important;text-decoration:none!important}
      /* Settings panel = compact dropdown anchored under the bar's right edge (near the gear), not a full-width strip. */
      #pintwist-initial-bar.pintwist-is-pill #pintwist-settings-panel{position:absolute!important;top:calc(100% + 6px)!important;right:8px!important;left:auto!important;width:300px!important;max-width:calc(100vw - 24px)!important;display:flex!important;flex-direction:column!important;gap:8px!important;padding:12px!important;z-index:2147483647!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-settings-panel[hidden]{display:none!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-settings-panel .pintwist-settings-row{display:flex!important;flex-direction:column!important;gap:4px!important;width:100%!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-settings-panel input[type="text"]{width:100%!important}
      /* single-pin page: push the page content down so the fixed bar doesn't hide the top of the pin */
      html.pintwist-layout-pill.pintwist-pin-detail body{padding-top:104px!important}
      /* feed/search: pad the pin grid so the fixed pill toolbar doesn't cover the top row of pins */
      html.pintwist-layout-pill:not(.pintwist-pin-detail) div[data-test-id="masonry-container"]{padding-top:8px!important}
      #pintwist-initial-bar.pintwist-is-pill #pintwist-pill-more{display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 auto!important;width:38px!important;height:34px!important;border-radius:9px!important;font-size:18px!important;font-weight:900!important;cursor:pointer!important;background:var(--pt-field-strong)!important;color:var(--pt-text)!important;border:1px solid var(--pt-line-strong)!important}
      /* on-bar controls (no more ⋯ panel): overlays, download folder, ask, tutorial, automation */
      #pintwist-initial-bar.pintwist-is-pill .pintwist-checkbox-wrapper,
      #pintwist-initial-bar.pintwist-is-pill .pintwist-settings-check{display:inline-flex!important;align-items:center!important;gap:6px!important;flex:0 0 auto!important;margin:0!important;font-size:12px!important;font-weight:600!important;color:#333!important;white-space:nowrap!important}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-folder-field{flex:0 0 110px!important;width:110px!important;height:34px!important;padding:0 10px!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;background:var(--pt-field-strong)!important;color:var(--pt-text)!important;font-size:12px!important;font-weight:600!important}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-tutorial-link{flex:0 0 auto!important;width:auto!important;max-width:none!important;font-size:12px!important;font-weight:600!important;color:var(--pintwist-primary,#F0002D)!important;text-decoration:none!important;white-space:nowrap!important}
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill #pintwist-auto-toggle{flex:0 0 auto!important;width:auto!important;max-width:none!important;min-height:34px!important;height:34px!important;padding:0 12px!important;font-size:12px!important;font-weight:600!important;white-space:nowrap!important;border-radius:8px!important;background:var(--pintwist-primary,#F0002D)!important;border:1px solid var(--pintwist-primary,#F0002D)!important;color:#fff!important;box-shadow:none!important}
      /* automation panel drops DOWN as an overlay; it must not be a flex item in the row */
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill #pintwist-auto-body{position:absolute!important;top:calc(100% + 3px)!important;left:8px!important;right:8px!important;width:auto!important;max-width:none!important;max-height:60vh!important;overflow:auto!important;margin:0!important;padding:12px!important;background:#fff!important;color:#1a1a1a!important;border:1px solid var(--pt-line-strong)!important;border-radius:12px!important;box-shadow:0 12px 32px rgba(0,0,0,.22)!important;z-index:60!important}
      /* secondary controls live in a dropdown panel below the bar, shown only when the ⋯ button is toggled */
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pill-panel{display:none!important;position:absolute!important;top:calc(100% + 8px)!important;right:8px!important;flex-direction:column!important;gap:10px!important;min-width:260px!important;max-height:70vh!important;overflow-y:auto!important;padding:14px!important;border-radius:14px!important;background:#ffffff!important;color:#1a1a1a!important;border:1px solid var(--pt-line-strong)!important;box-shadow:0 12px 32px rgba(0,0,0,.22)!important;z-index:60!important}
      #pintwist-initial-bar.pintwist-is-pill.pintwist-pill-expanded .pintwist-pill-panel{display:flex!important}
      /* panel contents stay readable on the solid white panel */
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pill-panel,
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pill-panel *,
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pill-panel .pintwist-checkbox-wrapper{color:#1a1a1a!important}
      /* HARD CAP: <label>/<a> children were stretching to full width and shoving the rest
         off-screen. max-content caps the width no matter the flex/basis. Double class +
         child combinator + last-in-source = wins over the rail's glass rules. */
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill > .pintwist-checkbox-wrapper,
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill > .pintwist-settings-check,
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill > #pintwist-catalog-count,
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill > #pintwist-catalog-export,
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill > .pintwist-tutorial-link{flex:0 0 auto!important;width:auto!important;max-width:max-content!important}
      /* automation panel stays hidden until its toggle is open (kills the empty white bar) */
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill #pintwist-auto-body{display:none!important}
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill #pintwist-auto-toggle.pintwist-auto-toggle--open ~ #pintwist-auto-body{display:block!important}
      /* never show the automation panel when it has no content (the empty translucent strip) */
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill #pintwist-auto-body:empty{display:none!important}
      #pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill #pintwist-auto-toggle.pintwist-auto-toggle--open ~ #pintwist-auto-body:empty{display:none!important}
      /* automation controls one row + queue pills — SHARED generator (also used by the
         results stylesheet) so the two contexts can't drift. See pintwistAutoLayoutCss. */
      ${pintwistAutoLayoutCss('#pintwist-initial-bar.pintwist-unified-glass.pintwist-is-pill ')}
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pill-panel button,
      #pintwist-initial-bar.pintwist-is-pill .pintwist-pill-panel .pintwist-tutorial-link{color:#1a1a1a!important}
      #pintwist-initial-bar .pintwist-checkbox-wrapper,
      html.pintwist-docked #pintwist-resort-bar .pintwist-checkbox-wrapper{color:#fff!important;font-weight:700!important}
      html.pintwist-docked #pintwist-resort-bar #pintwist-filter-bar .filter-content{display:flex!important;flex-direction:column!important;gap:8px!important;width:100%!important;max-width:100%!important}
      html.pintwist-docked #pintwist-resort-bar #pintwist-filter-bar .filter-group{display:grid!important;grid-template-columns:minmax(0,78px) minmax(0,1fr) 10px minmax(0,1fr)!important;align-items:center!important;gap:6px!important;width:100%!important;max-width:100%!important}
      html.pintwist-docked #pintwist-resort-bar #pintwist-filter-bar .filter-group label{color:var(--pt-muted)!important;font-size:11px!important;letter-spacing:.08em!important}
      html.pintwist-docked #pintwist-resort-bar #pintwist-filter-bar .filter-input{
        width:100%!important;min-width:0!important;height:34px!important;min-height:34px!important;padding:0 8px!important;background:var(--pt-field-strong)!important;color:var(--pt-text)!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;font-size:12px!important;font-weight:750!important;
      }
      html.pintwist-docked #pintwist-resort-bar #pintwist-reset-all-filters,
      html.pintwist-docked #pintwist-resort-bar .date-preset-chip{
        height:34px!important;min-height:34px!important;background:rgba(96,165,250,.14)!important;border-color:rgba(96,165,250,.38)!important;color:#dbeafe!important;font-size:12px!important;
      }
      /* SYNC MARKER: the post-scan results sheet (installShadowResultsSurface, ~:6157)
         re-declares panel/settings appearance for the shadow root. Until the two
         stylesheets are merged (a planned future cleanup) any change here must be
         mirrored there, and vice-versa. Panel/settings bg = --pt-panel-strong in both. */
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-settings-panel,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-settings-panel,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass > #pintwist-filter-bar{
        background:var(--pt-panel-strong)!important;color:var(--pt-text)!important;border-color:var(--pt-line)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body *,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body *,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-settings-panel *,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-settings-panel *,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar *{
        color:var(--pt-text)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body input,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body textarea,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-settings-panel input,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body input,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body textarea,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-settings-panel input,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar input{
        background:var(--pt-field-strong)!important;color:var(--pt-text)!important;border-color:var(--pt-line-strong)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body input[type="number"],
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body input[type="number"]{
        min-height:34px!important;height:34px!important;background:transparent!important;color:var(--pt-text)!important;border:0!important;border-radius:0!important;padding:0 8px!important;font-size:13px!important;font-weight:850!important;text-align:center!important;box-shadow:none!important;outline:0!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-num-wrap,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-num-wrap{
        display:grid!important;grid-template-columns:minmax(0,1fr) 26px!important;align-items:stretch!important;width:92px!important;height:34px!important;min-height:34px!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;overflow:hidden!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-num--xs,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-num--xs{
        width:auto!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-num-spin,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-num-spin{
        display:grid!important;grid-template-rows:1fr 1fr!important;width:26px!important;height:100%!important;background:rgba(255,255,255,.07)!important;border-left:1px solid var(--pt-line)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-num-up,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-num-down,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-num-up,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-num-down{
        min-height:0!important;height:18px!important;width:26px!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;color:var(--pt-muted)!important;font-size:9px!important;line-height:17px!important;box-shadow:none!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-num-up,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-num-up{
        border-bottom:1px solid var(--pt-line)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body textarea::placeholder,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body input::placeholder,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body textarea::placeholder,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body input::placeholder{
        color:var(--pt-faint)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-btn--primary,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-btn--primary{
        background:var(--pt-green)!important;border-color:color-mix(in srgb, var(--pt-green) 55%, rgba(255,255,255,.2))!important;color:#06120c!important;box-shadow:0 0 20px var(--pt-glow-green), inset 0 1px 0 rgba(255,255,255,.28)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-add,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-add{
        background:var(--pt-green)!important;border-color:color-mix(in srgb, var(--pt-green) 55%, rgba(255,255,255,.2))!important;color:#06120c!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-off,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-off{
        background:rgba(248,113,113,.16)!important;border-color:rgba(248,113,113,.45)!important;color:#fecaca!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-clear,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-clear{
        background:transparent!important;border-color:rgba(96,165,250,.45)!important;color:#bfdbfe!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-resume-cd,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-resume-cd{
        background:rgba(96,165,250,.14)!important;border-color:rgba(96,165,250,.42)!important;color:#dbeafe!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-pill,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-empty,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-pill,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-empty{
        background:var(--pt-field)!important;border:1px solid var(--pt-line)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-queue,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-queue{
        display:flex!important;flex-direction:column!important;gap:6px!important;max-height:none!important;overflow:visible!important;margin:6px 0!important;padding:0!important;background:transparent!important;border:0!important;width:100%!important;max-width:100%!important;box-sizing:border-box!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-row,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-row{
        display:grid!important;grid-template-columns:minmax(0,1fr) 138px!important;gap:8px!important;align-items:center!important;width:100%!important;max-width:100%!important;min-width:0!important;min-height:54px!important;padding:8px!important;background:var(--pt-field)!important;border:1px solid var(--pt-line)!important;border-radius:8px!important;box-shadow:none!important;box-sizing:border-box!important;overflow:hidden!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-row--current,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-row--current{
        background:rgba(126,203,131,.16)!important;border-color:rgba(126,203,131,.48)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-main,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-main{
        display:flex!important;flex-direction:column!important;gap:2px!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-term,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-term{
        display:block!important;color:var(--pt-text)!important;font-size:13px!important;font-weight:850!important;line-height:1.15!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-status,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-status{
        display:block!important;color:var(--pt-muted)!important;font-size:11px!important;font-weight:750!important;line-height:1.15!important;text-transform:capitalize!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-actions,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-actions{
        display:grid!important;grid-template-columns:1fr 1fr!important;gap:6px!important;width:138px!important;max-width:138px!important;min-width:0!important;box-sizing:border-box!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-run,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-remove,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-run,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-remove{
        min-height:34px!important;height:34px!important;width:100%!important;min-width:0!important;padding:0 6px!important;font-size:12px!important;line-height:1!important;border-radius:8px!important;text-align:center!important;box-sizing:border-box!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-run,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-run{
        background:var(--pt-green)!important;border-color:color-mix(in srgb, var(--pt-green) 55%, rgba(255,255,255,.2))!important;color:#06120c!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-queue-remove,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-queue-remove{
        background:transparent!important;border-color:rgba(96,165,250,.38)!important;color:#bfdbfe!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-master-row,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-master-row{
        display:grid!important;grid-template-columns:1fr!important;gap:10px!important;margin-top:10px!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;position:static!important;z-index:auto!important;bottom:auto!important;top:auto!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body{
        display:flex!important;flex-direction:column!important;gap:12px!important;max-height:none!important;overflow:visible!important;padding:12px!important;isolation:isolate!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-body > *,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-body > *{
        flex:0 0 auto!important;position:static!important;z-index:auto!important;box-sizing:border-box!important;max-width:100%!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-row-fields,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-row-fields{
        order:1!important;
        margin-bottom:6px!important; /* breathing room beneath the "+ Add to queue" button */
      }
      /* Controls + catalog ABOVE the queue so they're always visible — a long queue
         pushed them below the panel fold ("the controls disappeared"). Queue is last. */
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-master-row,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-master-row{
        order:2!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-catalog-btn,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-catalog-btn{
        order:3!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-queue,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-queue{
        order:4!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-row-fields,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-add-row,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-row-fields,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-add-row{
        display:flex!important;flex-direction:column!important;gap:8px!important;background:transparent!important;border:0!important;padding:0!important;box-shadow:none!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-label,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-label{
        color:var(--pt-text)!important;font-size:13px!important;font-weight:850!important;line-height:1.25!important;text-transform:none!important;letter-spacing:0!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-textarea,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-textarea{
        min-height:72px!important;width:100%!important;padding:10px!important;line-height:1.3!important;resize:vertical!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;color:var(--pt-text)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-inline-field,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-inline-field{
        display:grid!important;grid-template-columns:minmax(0,1fr) 92px!important;align-items:center!important;gap:10px!important;width:100%!important;min-height:34px!important;background:transparent!important;border:0!important;padding:0!important;color:var(--pt-text)!important;font-size:13px!important;font-weight:750!important;text-transform:none!important;letter-spacing:0!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-checkbox,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-checkbox{
        display:grid!important;grid-template-columns:22px minmax(0,1fr) 92px 18px!important;align-items:center!important;gap:8px!important;width:100%!important;min-height:34px!important;background:transparent!important;border:0!important;padding:0!important;color:var(--pt-text)!important;font-size:13px!important;font-weight:750!important;text-transform:none!important;letter-spacing:0!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-checkbox > input[type="checkbox"],
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-checkbox > input[type="checkbox"]{
        width:16px!important;height:16px!important;min-height:16px!important;margin:0!important;accent-color:var(--pt-green)!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;border-radius:4px!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-switch,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-switch{
        display:grid!important;grid-template-columns:44px minmax(0,1fr)!important;align-items:center!important;gap:10px!important;width:100%!important;min-height:34px!important;background:transparent!important;border:0!important;padding:0!important;color:var(--pt-text)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-switch > input[type="checkbox"],
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-switch > input[type="checkbox"]{
        position:absolute!important;opacity:0!important;pointer-events:none!important;width:1px!important;height:1px!important;min-height:0!important;margin:0!important;padding:0!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-switch-track,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-switch-track{
        position:relative!important;grid-column:1!important;grid-row:1!important;width:44px!important;height:24px!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;border-radius:999px!important;box-shadow:none!important;overflow:hidden!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-switch-thumb,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-switch-thumb{
        position:absolute!important;width:18px!important;height:18px!important;top:2px!important;left:2px!important;background:#fff!important;border-radius:999px!important;transform:translateX(0)!important;transition:transform .2s ease!important;box-shadow:0 1px 2px rgba(0,0,0,.25)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-switch input:checked + .pintwist-auto-switch-track,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-switch input:checked + .pintwist-auto-switch-track{
        background:var(--pt-green)!important;border-color:var(--pt-green)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-switch input:checked + .pintwist-auto-switch-track .pintwist-auto-switch-thumb,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-switch input:checked + .pintwist-auto-switch-track .pintwist-auto-switch-thumb{
        left:2px!important;transform:translateX(20px)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-switch-label,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-switch-label{
        grid-column:2!important;grid-row:1!important;color:var(--pt-text)!important;font-size:13px!important;font-weight:750!important;line-height:1.2!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-actions,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-actions{
        display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;width:100%!important;background:transparent!important;border:0!important;padding:0!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-countdown,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-stats,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-countdown,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-stats{
        display:flex!important;align-items:center!important;justify-content:center!important;min-height:34px!important;width:100%!important;background:rgba(255,255,255,.07)!important;border:1px solid var(--pt-line)!important;border-radius:8px!important;color:var(--pt-muted)!important;font-size:12px!important;font-weight:750!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-auto-divider,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-auto-divider{
        display:none!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass button,
      #pintwist-initial-bar.pintwist-unified-glass input,
      #pintwist-initial-bar.pintwist-unified-glass textarea,
      #pintwist-initial-bar.pintwist-unified-glass select,
      #pintwist-initial-bar.pintwist-unified-glass a,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass button,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass input,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass textarea,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass select,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass a{
        box-sizing:border-box!important;font-family:inherit!important;letter-spacing:0!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass button,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-tutorial-link,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-settings-link,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass button,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-tutorial-link,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-settings-link{
        min-height:34px!important;height:34px!important;width:100%!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:0 10px!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;background:var(--pt-panel)!important;color:var(--pt-text)!important;font-size:13px!important;font-weight:850!important;line-height:1!important;text-decoration:none!important;text-align:center!important;text-transform:none!important;box-shadow:none!important;cursor:pointer!important;transition:background .2s ease,border-color .2s ease,color .2s ease,filter .2s ease!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass button:hover:not(:disabled),
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-tutorial-link:hover,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-settings-link:hover,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass button:hover:not(:disabled),
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-tutorial-link:hover,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-settings-link:hover{
        border-color:rgba(96,165,250,.58)!important;background:var(--pt-panel-strong)!important;color:var(--pt-text)!important;filter:brightness(1.06)!important;transform:none!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass button:disabled,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass button:disabled{
        opacity:1!important;background:rgba(255,255,255,.055)!important;border-color:rgba(255,255,255,.11)!important;color:rgba(248,250,252,.45)!important;cursor:not-allowed!important;box-shadow:none!important;filter:none!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass input:not([type="checkbox"]):not([type="hidden"]),
      #pintwist-initial-bar.pintwist-unified-glass textarea,
      #pintwist-initial-bar.pintwist-unified-glass select,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass input:not([type="checkbox"]):not([type="hidden"]),
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass textarea,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass select{
        min-height:34px!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;color:var(--pt-text)!important;font-size:13px!important;font-weight:750!important;line-height:1.2!important;outline:0!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass input:focus,
      #pintwist-initial-bar.pintwist-unified-glass textarea:focus,
      #pintwist-initial-bar.pintwist-unified-glass select:focus,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass input:focus,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass textarea:focus,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass select:focus{
        border-color:var(--pt-blue)!important;box-shadow:0 0 0 2px rgba(96,165,250,.24), inset 0 1px 0 rgba(255,255,255,.08)!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar{
        background:rgba(255,255,255,.055)!important;border-color:var(--pt-line)!important;color:var(--pt-text)!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .filter-group label,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .filter-dash,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .filter-group label,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .filter-dash{
        color:var(--pt-muted)!important;font-size:12px!important;font-weight:850!important;letter-spacing:0!important;text-transform:uppercase!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .filter-input,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .filter-input{
        width:100%!important;min-width:0!important;height:34px!important;padding:0 10px!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;color:var(--pt-text)!important;font-size:13px!important;font-weight:800!important;line-height:34px!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip{
        min-height:34px!important;height:34px!important;padding:0 8px!important;background:rgba(96,165,250,.14)!important;border:1px solid rgba(96,165,250,.36)!important;border-radius:8px!important;color:#dbeafe!important;font-size:12px!important;font-weight:900!important;opacity:1!important;text-shadow:none!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip:hover:not(:disabled),
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip:hover:not(:disabled){
        background:rgba(96,165,250,.24)!important;border-color:rgba(96,165,250,.62)!important;color:#eff6ff!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip.active,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip.active{
        background:var(--pt-green)!important;border-color:var(--pt-green)!important;color:#06120c!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-reset-all-filters,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-reset-all-filters{
        background:transparent!important;border-color:rgba(96,165,250,.45)!important;color:#bfdbfe!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .filter-pill,
      #pintwist-initial-bar.pintwist-unified-glass .filter-pill{
        background:rgba(96,165,250,.14)!important;border:1px solid rgba(96,165,250,.36)!important;color:#dbeafe!important;border-radius:999px!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .filter-pill-remove,
      #pintwist-initial-bar.pintwist-unified-glass .filter-pill-remove{
        width:22px!important;height:22px!important;min-height:22px!important;border-radius:999px!important;color:#dbeafe!important;background:transparent!important;border:0!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-sort-choice.is-active,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-sort-choice[aria-pressed="true"],
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-sort-choice.is-active,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-sort-choice[aria-pressed="true"],
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-sort-btn,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-search-btn-initial,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-search-btn{
        background:var(--pt-green)!important;border-color:color-mix(in srgb, var(--pt-green) 55%, rgba(255,255,255,.2))!important;color:#06120c!important;box-shadow:0 0 20px var(--pt-glow-green), inset 0 1px 0 rgba(255,255,255,.28)!important;
      }
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-settings-link-initial,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-toggle,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-download-csv-btn,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-settings-link-resort,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-reset-all-filters,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .date-preset-chip{
        background:color-mix(in srgb, var(--pt-green) 14%, transparent)!important;border-color:color-mix(in srgb, var(--pt-green) 42%, transparent)!important;color:var(--pt-text)!important;box-shadow:0 0 14px color-mix(in srgb, var(--pt-green) 14%, transparent), inset 0 1px 0 rgba(255,255,255,.08)!important;
      }
      :root{
        --pt-secondary-bg:rgba(96,165,250,.14);
        --pt-secondary-bg-hover:rgba(96,165,250,.24);
        --pt-secondary-border:rgba(96,165,250,.42);
        --pt-secondary-text:#dbeafe;
        --pt-disabled-bg:rgba(255,255,255,.055);
        --pt-disabled-border:rgba(255,255,255,.11);
        --pt-disabled-text:rgba(248,250,252,.50);
        --pt-danger-bg:rgba(248,113,113,.16);
        --pt-danger-border:rgba(248,113,113,.45);
        --pt-danger-text:#fecaca;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-settings-panel,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-settings-panel{
        background:var(--pt-panel-strong)!important;border-color:var(--pt-line-strong)!important;color:var(--pt-text)!important;
      }
      :root.pintwist-theme-light body{
        background:#f8fafc!important;color:var(--pt-text)!important;
      }
      :root.pintwist-theme-light #pintwist-sorted-container{
        background:#f8fafc!important;
      }
      :root.pintwist-theme-light .pintwist-result-card{
        background:#ffffff!important;border-color:var(--pt-line)!important;color:var(--pt-text)!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass button:disabled,
      #pintwist-initial-bar.pintwist-unified-glass button:disabled,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .date-preset-chip:disabled,
      #pintwist-initial-bar.pintwist-unified-glass .date-preset-chip:disabled{
        opacity:1!important;background:var(--pt-disabled-bg)!important;border-color:var(--pt-disabled-border)!important;color:var(--pt-disabled-text)!important;box-shadow:none!important;filter:none!important;cursor:not-allowed!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .filter-group label,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .filter-dash,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .filter-group label,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .filter-dash,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .pintwist-checkbox-wrapper,
      #pintwist-initial-bar.pintwist-unified-glass .pintwist-checkbox-wrapper{
        color:var(--pt-muted)!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .filter-input,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .filter-input,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar input[type="date"],
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar input[type="date"]{
        background:var(--pt-field-strong)!important;border-color:var(--pt-line-strong)!important;color:var(--pt-text)!important;-webkit-text-fill-color:var(--pt-text)!important;color-scheme:dark!important;
      }
      :root.pintwist-theme-light.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .filter-input,
      :root.pintwist-theme-light #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .filter-input,
      :root.pintwist-theme-light.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar input[type="date"],
      :root.pintwist-theme-light #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar input[type="date"]{
        color-scheme:light!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-reset-all-filters,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-reset-all-filters,
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass .filter-pill,
      #pintwist-initial-bar.pintwist-unified-glass .filter-pill{
        background:var(--pt-secondary-bg)!important;border-color:var(--pt-secondary-border)!important;color:var(--pt-secondary-text)!important;text-shadow:none!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip:hover:not(:disabled),
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-filter-bar .date-preset-chip:hover:not(:disabled),
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-reset-all-filters:hover:not(:disabled),
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-reset-all-filters:hover:not(:disabled){
        background:var(--pt-secondary-bg-hover)!important;border-color:var(--pt-secondary-border)!important;color:var(--pt-secondary-text)!important;
      }
      html.pintwist-docked #pintwist-resort-bar.pintwist-unified-glass #pintwist-auto-off,
      #pintwist-initial-bar.pintwist-unified-glass #pintwist-auto-off{
        background:var(--pt-danger-bg)!important;border-color:var(--pt-danger-border)!important;color:var(--pt-danger-text)!important;
      }
    `;
    document.head.appendChild(style);
  }

  let initialSortStarting = false;

  async function runInitialSortFromRail(metric, bar) {
    if (initialSortStarting) return;
    initialSortStarting = true;
    // The scanned/sorted view relies on the docked content-offset, which the pill class
    // suppresses. Drop pill mode the moment a sort starts so the scan modal behaves
    // exactly as before. (Pill is re-applied when the initial bar next renders.)
    document.documentElement.classList.remove('pintwist-layout-pill');
    document.documentElement.classList.add('pintwist-layout-rail');
    const selected =
      metric || document.getElementById('pintwist-initial-sort-option')?.value || State.selectedMetric || 'saves';
    const hidden = document.getElementById('pintwist-initial-sort-option');
    if (hidden) hidden.value = selected;
    State.selectedMetric = selected;
    setSortGridActive(document.getElementById('pintwist-initial-sort-grid'), selected);
    const pagesInput = document.getElementById('pintwist-pages-input');
    const pages = parseInt(pagesInput?.value, 10) || 4;
    State.pagesToLoad = pages;
    const rail = bar || document.getElementById('pintwist-initial-bar');
    rail?.querySelectorAll('button,input').forEach((control) => {
      control.disabled = true;
    });
    rail?.remove();
    try {
      await startSortingProcess(pages, selected);
    } catch (error) {
      initialSortStarting = false;
      throw error;
    }
  }

  function bindInitialSortGrid(grid, bar) {
    if (!grid) return;
    const selected = State.selectedMetric || 'saves';
    setSortGridActive(grid, selected);
    grid.querySelectorAll('.pintwist-sort-choice').forEach((button) => {
      button.addEventListener('click', async () => {
        const selected = button.dataset.value || 'saves';
        State.selectedMetric = selected;
        const hidden = document.getElementById('pintwist-initial-sort-option');
        if (hidden) hidden.value = selected;
        setSortGridActive(grid, selected);
        await runInitialSortFromRail(selected, bar);
      });
    });
  }

  const priorApplyThemeColor = typeof applyThemeColor === 'function' ? applyThemeColor : null;
  applyThemeColor = function (color) {
    if (priorApplyThemeColor) priorApplyThemeColor(color);
    injectGlassRailStyle();
    const railBorder = 'rgba(255,255,255,.22)';
    document.querySelectorAll('#pintwist-initial-bar,#pintwist-resort-bar').forEach((bar) => {
      bar.classList.add('pintwist-unified-glass');
      bar.style.setProperty('border-right-color', railBorder, 'important');
      bar.style.setProperty('border-color', railBorder, 'important');
    });
    hydrateThemeMode();
    hydrateLayoutMode();
  };

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.action === 'updateThemeMode') applyThemeMode(message.data);
      if (message?.action === 'updateLayoutMode') applyLayoutMode(message.data);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.pintwist_theme_mode) applyThemeMode(changes.pintwist_theme_mode.newValue);
      if (area === 'sync' && changes.pintwist_layout_mode) applyLayoutMode(changes.pintwist_layout_mode.newValue);
      // The catalog is shared across all tabs of this profile (storage.local). When ANY tab
      // adds/exports pins, refresh this tab's "N saved" readout so the count stays in sync.
      if (area === 'local' && changes[PINTWIST_CATALOG_KEY]) {
        try {
          pintwistRefreshCatalogCount();
        } catch {}
      }
    });
  } catch {}

  window.sort_all = async function () {
    // These shadow helpers live in the perf-hotfix IIFE (different scope), so call
    // them via the window bridge rather than as bare identifiers (which would throw).
    window.__pintwistHideShadowResults && window.__pintwistHideShadowResults();
    document.getElementById('sort-panel')?.remove();
    document.getElementById('pintwist-initial-bar')?.remove();
    document.getElementById('pintwist-sorted-container')?.remove();
    State.aborted = false;
    initialSortStarting = false;
    applyContentOffset();
    const themePrefs = await new Promise((resolve) => {
      chrome.storage.sync.get(['pintwist_theme_color', 'pintwist_theme_mode', 'pintwist_layout_mode'], (result) =>
        resolve(result || {})
      );
    });
    const themeColor = themePrefs.pintwist_theme_color || '#F48FB1';
    // Side panel removed — the top bar is the ONLY layout. Always pill.
    const isPill = true;
    document.documentElement.classList.toggle('pintwist-layout-pill', isPill);
    document.documentElement.classList.toggle('pintwist-layout-rail', !isPill);
    // On a single-pin page the bar would hide the top of the pin; push the page content
    // down there. On the feed/search the bar overlays the masonry (intended), so no push.
    try {
      document.documentElement.classList.toggle('pintwist-pin-detail', /^\/pin\//.test(location.pathname));
    } catch {}
    if (isPill) {
      try {
        removeContentOffset();
      } catch {}
    }
    const bar = document.createElement('div');
    bar.id = 'pintwist-initial-bar';
    bar.className = isPill ? 'pintwist-unified-glass pintwist-is-pill' : 'pintwist-unified-glass';
    const _headerHeight = getPinterestHeaderHeight();
    const sidebarWidth = getPinterestSidebarWidth();
    const isTrends = window.location.hostname.includes('trends.pinterest');
    const selected = State.selectedMetric || 'saves';
    // PILL is the only layout (rail removed). One-row horizontal toolbar pinned under
    // Pinterest's search bar, right of the left nav. ALL bar-level layout is inline so
    // nothing (gated CSS, applyContentOffset) can silently override it; the themed border
    // is stamped by applyThemeColor below.
    const pillLeft = isTrends ? Math.round(window.innerWidth * 0.2) : sidebarWidth + 17;
    bar.style.cssText =
      'position:fixed!important;top:79px!important;left:' +
      pillLeft +
      'px!important;right:8px!important;width:auto!important;max-width:none!important;z-index:50!important;height:56px!important;min-height:56px!important;max-height:56px!important;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;gap:8px!important;padding:0 14px!important;border-radius:14px!important;box-sizing:border-box!important;overflow:visible!important;background:#f6f7f9!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;pointer-events:auto!important;';
    bar.innerHTML = pintwistPillInnerHTML(selected);
    // Inject the glass sheet into document.head FIRST (it carries the Pinterest-page
    // layout rules — body/masonry padding — and is the source we mirror into the shadow),
    // then mount the pill INTO the shared shadow root so it's isolated from Pinterest CSS.
    injectGlassRailStyle();
    // ensurePintwistPillShadow lives in the perf-hotfix IIFE; reach it via the window
    // bridge, falling back to document.body so the bar always mounts.
    const pintwistPillRoot =
      (window.__pintwistEnsurePillShadow && window.__pintwistEnsurePillShadow()) || document.body;
    pintwistPillRoot.appendChild(bar);
    applyThemeMode(themePrefs.pintwist_theme_mode);
    bindInitialSortGrid(document.getElementById('pintwist-initial-sort-grid'), bar);
    const search = document.getElementById('pintwist-search-input-initial');
    const searchBtn = document.getElementById('pintwist-search-btn-initial');
    const runSearch = () => {
      const term = search.value.trim();
      if (term) window.location.href = 'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(term);
    };
    searchBtn.addEventListener('click', runSearch);
    search.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') runSearch();
    });
    const overlays = document.getElementById('pintwist-show-overlays');
    chrome.storage.sync.get(['pintwist_show_overlays'], (result) => {
      const enabled = result.pintwist_show_overlays !== false;
      overlays.checked = enabled;
      toggleOverlays(enabled);
    });
    overlays.addEventListener('change', () => {
      chrome.storage.sync.set({ pintwist_show_overlays: overlays.checked });
      toggleOverlays(overlays.checked);
    });
    document.getElementById('pintwist-sort-pins-btn').addEventListener('click', async () => {
      const metric = document.getElementById('pintwist-initial-sort-option').value || 'saves';
      await runInitialSortFromRail(metric, bar);
    });
    const pillSort = document.getElementById('pintwist-pill-sort');
    if (pillSort)
      pillSort.addEventListener('change', () => {
        const v = pillSort.value || 'saves';
        State.selectedMetric = v;
        const hidden = document.getElementById('pintwist-initial-sort-option');
        if (hidden) hidden.value = v;
        setSortGridActive(document.getElementById('pintwist-initial-sort-grid'), v);
      });
    const pillMore = document.getElementById('pintwist-pill-more');
    if (pillMore)
      pillMore.addEventListener('click', () => {
        const b = document.getElementById('pintwist-initial-bar');
        const expanded = b ? b.classList.toggle('pintwist-pill-expanded') : false;
        pillMore.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      });
    // Settings button removed in the pill: the download-folder field now lives directly
    // on the bar. Guarded so the missing button never throws.
    document.getElementById('pintwist-settings-link-initial')?.addEventListener('click', (event) => {
      event.preventDefault();
      pintwistToggleSettingsPanel();
    });
    pintwistWireSettingsPanel();
    const catExport = document.getElementById('pintwist-catalog-export');
    if (catExport)
      catExport.addEventListener('click', async (e) => {
        // Require a genuine user click — this exports + clears the catalog. A page script
        // could synthesize a click on this shadow-root button; isTrusted blocks those.
        if (!e.isTrusted) return;
        catExport.disabled = true;
        const original = catExport.innerHTML;
        catExport.textContent = 'Exporting…';
        // Manual export consumes the catalog: download, then reset the count to 0.
        const res = await pintwistDownloadAccumulatedCatalogCsv(undefined, { reset: true });
        catExport.textContent =
          res && res.ok ? 'Saved ✓ (cleared)' : res && res.error === 'no_catalog_rows' ? 'Nothing yet' : 'Failed';
        setTimeout(() => {
          catExport.disabled = false;
          catExport.innerHTML = original;
        }, 1500);
      });
    const barCatalog = document.getElementById('pintwist-bar-catalog');
    if (barCatalog)
      barCatalog.addEventListener('click', () => {
        try {
          chrome.runtime.sendMessage({ action: 'openCatalog' }, () => {
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          });
        } catch {
          /* non-fatal */
        }
      });
    pintwistRefreshCatalogCount();
    applyThemeColor(themeColor);
    applyContentOffset();
  };
})();

// Live-DOM helpers: ALWAYS re-query so stale references from prior filter-bar
// rebuilds never silently no-op. The filter bar is rebuilt on every sort_all,
// which detaches the previous chips/inputs; closures over them go stale.
function __pintwistDateMin() {
  return document.getElementById('filter-date-min');
}
function __pintwistDateMax() {
  return document.getElementById('filter-date-max');
}
function __pintwistDateChips() {
  return document.querySelectorAll('.date-preset-chip');
}
function __pintwistDateErr() {
  return document.querySelector('.filter-date-error');
}
function __pintwistDateClearActive() {
  __pintwistDateChips().forEach((c) => c.classList.remove('active'));
}
function __pintwistDateSetActive(days) {
  __pintwistDateChips().forEach((c) => c.classList.toggle('active', Number(c.dataset.days) === days));
}
function __pintwistDateValidate() {
  const a = __pintwistDateMin(),
    b = __pintwistDateMax();
  if (!a || !b) return true;
  const av = a.value,
    bv = b.value;
  const bad = !!(av && bv && av > bv);
  const er = __pintwistDateErr();
  if (er) er.hidden = !bad;
  a.classList.toggle('is-invalid', bad);
  b.classList.toggle('is-invalid', bad);
  return !bad;
}
function __pintwistDateClearError() {
  const er = __pintwistDateErr();
  if (er) er.hidden = true;
  const a = __pintwistDateMin();
  if (a) a.classList.remove('is-invalid');
  const b = __pintwistDateMax();
  if (b) b.classList.remove('is-invalid');
}

function setupDateFilterEnhancements() {
  const minEl = __pintwistDateMin(),
    maxEl = __pintwistDateMax();
  if (!minEl || !maxEl) return;
  const fmt = (d) => d.toISOString().split('T')[0];

  // Chip clicks — per-instance bind on the CURRENT chips
  __pintwistDateChips().forEach((c) =>
    c.addEventListener('click', () => {
      const days = Number(c.dataset.days);
      const to = new Date();
      const from = new Date();
      from.setDate(to.getDate() - (days - 1));
      __pintwistDateMin().value = fmt(from);
      __pintwistDateMax().value = fmt(to);
      __pintwistDateSetActive(days);
      __pintwistDateValidate();
      if (typeof resizeAllFilterInputs === 'function') resizeAllFilterInputs();
      if (typeof applyFilters === 'function') applyFilters();
    })
  );

  // Manual edits: clear active chip + re-validate
  [minEl, maxEl].forEach((el) =>
    el.addEventListener('input', () => {
      __pintwistDateClearActive();
      __pintwistDateValidate();
    })
  );

  // NOTE: a delegated listener on the date pills container does NOT work because
  // the per-pill X handler calls e.stopPropagation() before the event bubbles up.
  // Cover that code path by wrapping resetMetricFilter below.

  // Wrap applyFilters once (block on invalid).
  // NOTE: content scripts run in an isolated world. Top-level `function applyFilters(){}`
  // lives on the isolated globalThis, NOT on `window` (which is the page's window).
  // So we MUST reassign the lexical binding here — `window.applyFilters` is undefined.
  // Reassigning a function-declaration name from inside another function in the same
  // script mutates the shared binding, so later lexical calls (e.g. the debounced
  // input listener and chip clicks) resolve to the wrapped version on the next call.
  if (typeof applyFilters === 'function' && !globalThis.__pintwistDateGuard) {
    const orig = applyFilters;
    applyFilters = function () {
      if (!__pintwistDateValidate()) return;
      return orig.apply(this, arguments);
    };
    globalThis.__pintwistDateGuard = true;
  }
  // Wrap resetFilters once (X ALL → clear chip + error) — same isolated-world reasoning.
  if (typeof resetFilters === 'function' && !globalThis.__pintwistResetGuard) {
    const origR = resetFilters;
    resetFilters = function () {
      const r = origR.apply(this, arguments);
      __pintwistDateClearActive();
      __pintwistDateClearError();
      return r;
    };
    globalThis.__pintwistResetGuard = true;
  }
  // Wrap resetMetricFilter once (per-pill X for the date metric → clear chip + error).
  // The pill X handler calls e.stopPropagation() so event delegation can't catch it;
  // wrapping the function itself is the only reliable interception point.
  if (typeof resetMetricFilter === 'function' && !globalThis.__pintwistResetMetricGuard) {
    const origM = resetMetricFilter;
    resetMetricFilter = function (metric) {
      const r = origM.apply(this, arguments);
      if (metric === 'date') {
        __pintwistDateClearActive();
        __pintwistDateClearError();
      }
      return r;
    };
    globalThis.__pintwistResetMetricGuard = true;
  }
}

// ===== Inline Settings panel (replaces the Options tab from the sidebar) =====
// Storage keys mirror what background.js reads when downloading.
const PINTWIST_FOLDER_KEY = 'pintwist_download_folder';
let __pintwistSettingsSaveT = null;
function pintwistToggleSettingsPanel() {
  const panel = document.getElementById('pintwist-settings-panel');
  if (!panel) return;
  const opening = panel.hidden;
  panel.hidden = !opening;
  if (opening) pintwistLoadSettingsValues();
}
function pintwistLoadSettingsValues() {
  try {
    chrome.storage.sync.get(
      { [PINTWIST_FOLDER_KEY]: 'PinTwist', [PINTWIST_AUTOEXPORT_KEY]: true, [PINTWIST_AUTOEXPORT_N_KEY]: PINTWIST_CATALOG_MAX_ROWS },
      (r) => {
        const f = document.getElementById('pintwist-settings-folder');
        if (f) f.value = typeof r[PINTWIST_FOLDER_KEY] === 'string' ? r[PINTWIST_FOLDER_KEY] : 'PinTwist';
        const cb = document.getElementById('pintwist-settings-autoexport');
        if (cb) cb.checked = r[PINTWIST_AUTOEXPORT_KEY] !== false;
        const sel = document.getElementById('pintwist-settings-autoexport-n');
        if (sel) {
          const want = String(Number(r[PINTWIST_AUTOEXPORT_N_KEY]) || PINTWIST_CATALOG_MAX_ROWS);
          // If the stored threshold isn't one of the preset options, surface it as a
          // custom option instead of letting the <select> silently snap to the first entry.
          if (!Array.from(sel.options).some((o) => o.value === want)) {
            const opt = document.createElement('option');
            opt.value = want;
            opt.textContent = (Number(want) || 0).toLocaleString() + ' pins';
            sel.appendChild(opt);
          }
          sel.value = want;
        }
      }
    );
  } catch {
    /* non-fatal */
  }
}
function pintwistSaveAutoexportPrefs() {
  const cb = document.getElementById('pintwist-settings-autoexport');
  const sel = document.getElementById('pintwist-settings-autoexport-n');
  try {
    const patch = {};
    if (cb) patch[PINTWIST_AUTOEXPORT_KEY] = !!cb.checked;
    if (sel) patch[PINTWIST_AUTOEXPORT_N_KEY] = Number(sel.value) || PINTWIST_CATALOG_MAX_ROWS;
    chrome.storage.sync.set(patch);
  } catch {
    /* non-fatal */
  }
}
function pintwistSaveSettingsNow() {
  const f = document.getElementById('pintwist-settings-folder');
  const folder = (f && typeof f.value === 'string' ? f.value.trim() : '') || 'PinTwist';
  try {
    chrome.storage.sync.set({ [PINTWIST_FOLDER_KEY]: folder });
  } catch {
    /* non-fatal */
  }
}
function pintwistSaveSettings() {
  clearTimeout(__pintwistSettingsSaveT);
  __pintwistSettingsSaveT = setTimeout(pintwistSaveSettingsNow, 350);
}
function pintwistCloseSettingsPanel() {
  pintwistSaveSettingsNow();
  const panel = document.getElementById('pintwist-settings-panel');
  if (panel) panel.hidden = true;
}
function pintwistWireSettingsPanel() {
  const f = document.getElementById('pintwist-settings-folder');
  const done = document.getElementById('pintwist-settings-done');
  const panel = document.getElementById('pintwist-settings-panel');
  // Inject the auto-export controls once per panel (so every panel variant gets them
  // without editing each HTML block). Placed above the hint/Done.
  if (panel && !panel.querySelector('#pintwist-settings-autoexport')) {
    // Compact-row styling (high specificity to beat the panel's stacked rules). In the
    // post-scan results view the settings panel lives in a shadow root, so a light-DOM
    // <style> in document.head can't reach it — mirror the same style into that root too.
    // (We use Element.querySelector on head / the shadow root, which is native; the
    // document.getElementById/querySelector globals are monkey-patched in results view.)
    const autoexportRowCss =
      '#pintwist-settings-panel .pintwist-settings-autoexport-row{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:flex-start!important;gap:8px!important;width:100%!important;margin:0!important;text-align:left!important;white-space:nowrap!important}' +
      '#pintwist-settings-panel .pintwist-settings-autoexport-row input[type="checkbox"]{flex:0 0 auto!important;width:16px!important;height:16px!important;min-height:0!important;margin:0!important}' +
      '#pintwist-settings-panel .pintwist-settings-autoexport-row span{flex:0 0 auto!important}' +
      '#pintwist-settings-panel .pintwist-settings-autoexport-row select{flex:0 1 auto!important;width:auto!important;min-width:0!important;height:30px!important;min-height:0!important;padding:0 6px!important}';
    const ensureAutoexportStyle = (rootEl) => {
      if (!rootEl || rootEl.querySelector('#pintwist-autoexport-row-style')) return;
      const st = document.createElement('style');
      st.id = 'pintwist-autoexport-row-style';
      st.textContent = autoexportRowCss;
      rootEl.appendChild(st);
    };
    ensureAutoexportStyle(document.head);
    const panelRoot = panel.getRootNode && panel.getRootNode();
    if (panelRoot && panelRoot.nodeType === 11) ensureAutoexportStyle(panelRoot);
    const row = document.createElement('label');
    row.className = 'pintwist-settings-autoexport-row';
    row.innerHTML =
      '<input type="checkbox" id="pintwist-settings-autoexport"> <span>Auto-download CSV after</span> ' +
      '<select id="pintwist-settings-autoexport-n" aria-label="Auto-download threshold">' +
      '<option value="1000">1,000 pins</option>' +
      '<option value="2500">2,500 pins</option>' +
      '<option value="5000">5,000 pins</option>' +
      '<option value="10000">10,000 pins</option>' +
      '<option value="25000">25,000 pins</option>' +
      '</select>';
    const hint = panel.querySelector('.pintwist-settings-hint');
    if (hint) panel.insertBefore(row, hint);
    else if (done) panel.insertBefore(row, done);
    else panel.appendChild(row);
  }
  const autoCb = document.getElementById('pintwist-settings-autoexport');
  const autoSel = document.getElementById('pintwist-settings-autoexport-n');
  if (autoCb && !autoCb.dataset.pintwistWired) {
    autoCb.addEventListener('change', pintwistSaveAutoexportPrefs);
    autoCb.dataset.pintwistWired = '1';
  }
  if (autoSel && !autoSel.dataset.pintwistWired) {
    autoSel.addEventListener('change', pintwistSaveAutoexportPrefs);
    autoSel.dataset.pintwistWired = '1';
  }
  if (f && !f.dataset.pintwistWired) {
    f.addEventListener('input', pintwistSaveSettings);
    // Pressing Enter in the folder field accepts + closes, same as the Done button.
    f.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        pintwistCloseSettingsPanel();
      }
    });
    f.dataset.pintwistWired = '1';
  }
  if (done && !done.dataset.pintwistWired) {
    done.addEventListener('click', pintwistCloseSettingsPanel);
    done.dataset.pintwistWired = '1';
  }
}

// ===== Performance Hotfix =====
// The original live flow processed every Pinterest card as soon as the feed
// changed, sent one runtime message per pin, and cloned Pinterest's full card
// DOM before building the sorted view. On large feeds that caused high memory
// use and slow button response. These overrides keep the same public controls
// but use bulk messages, visible-only live overlays, and compact PinTwist result cards.
// ============================================================================
// PERFORMANCE HOTFIX — decorator/override layer
// ----------------------------------------------------------------------------
// This IIFE REPLACES (not chains) a set of top-level functions defined earlier in
// the file with faster/Shadow-DOM implementations. The LAST assignment wins at
// runtime, so the base bodies above are effectively dead — but their `function`
// DECLARATIONS must stay: the file is 'use strict', and these overrides are plain
// assignments to those bindings (`finishSort = function () {…}`), which throw if the
// binding doesn't exist. So "dead base body, kept declaration" is intentional.
//
// Functions overridden here (base above → override below; all REPLACE, none chain):
//   finishSort, processExisting, processPinsBulk, initObserver, startSortingProcess,
//   setupResortBar, toggleOverlays, clearState, setCache/saveCache/loadCache,
//   extractMetrics, fetchBulk, applyFilters/resetFilters.
// A few helpers that live ONLY in this IIFE are reached from other scopes via
// `window.__pintwist*` bridges (hidePintwistShadowResults, ensurePintwistPillShadow)
// and `window.sort_all` — bare calls would throw across IIFE boundaries.
// ============================================================================
(function pintwistPerformanceHotfix() {
  if (globalThis.__pintwistPerformanceHotfixApplied) return;
  globalThis.__pintwistPerformanceHotfixApplied = true;

  const PIN_SELECTOR = '[data-test-pin-id]';
  const BULK_MESSAGE_SIZE = 25;
  const LIVE_BATCH_LIMIT = 24;
  const LIVE_OVERLAY_LIMIT = 90;
  const LIVE_VIEWPORT_MARGIN = 900;
  const SCAN_SCROLL_DELAY_MS = 1400;
  const SCAN_MAX_WAIT_MS = 5500;
  const MAX_METRICS_CACHE = 1200;
  const KEEP_METRICS_CACHE = 900;
  const MAX_TRACKED_IDS = 2400;
  const KEEP_TRACKED_IDS = 1600;
  const MAX_SORTED_PIN_IDS = 10000;
  const KEEP_SORTED_PIN_IDS = 8000;
  const originalFetchBulk = typeof fetchBulk === 'function' ? fetchBulk : null;
  const originalToggleOverlays = typeof toggleOverlays === 'function' ? toggleOverlays : null;
  const originalClearState = typeof clearState === 'function' ? clearState : null;
  const originalExtractMetrics = typeof extractMetrics === 'function' ? extractMetrics : null;
  const originalSetCache = typeof setCache === 'function' ? setCache : null;
  const originalSaveCache = typeof saveCache === 'function' ? saveCache : null;
  const originalLoadCache = typeof loadCache === 'function' ? loadCache : null;
  let liveObserverRetry = null;

  function trimMapToLimit(map, max, keep) {
    if (!map || map.size <= max) return;
    const entries = Array.from(map.entries());
    entries.sort((a, b) => ((a[1] && a[1].timestamp) || 0) - ((b[1] && b[1].timestamp) || 0));
    map.clear();
    entries.slice(-keep).forEach(([key, value]) => map.set(key, value));
  }

  function trimSetToLimit(set, max, keep) {
    if (!set || set.size <= max) return;
    const entries = Array.from(set);
    set.clear();
    entries.slice(-keep).forEach((value) => set.add(value));
  }

  function enforceMemoryCaps() {
    trimMapToLimit(State.metricsCache, MAX_METRICS_CACHE, KEEP_METRICS_CACHE);
    trimSetToLimit(State.loadedIDs, MAX_TRACKED_IDS, KEEP_TRACKED_IDS);
    trimSetToLimit(State.processingIDs, MAX_TRACKED_IDS, KEEP_TRACKED_IDS);
    trimSetToLimit(State.sortedPinIDs, MAX_SORTED_PIN_IDS, KEEP_SORTED_PIN_IDS);
  }

  if (originalSetCache) {
    setCache = function (pinID, metrics) {
      const result = originalSetCache(pinID, metrics);
      enforceMemoryCaps();
      return result;
    };
  }

  if (originalSaveCache) {
    saveCache = async function () {
      enforceMemoryCaps();
      return originalSaveCache();
    };
  }

  if (originalLoadCache) {
    loadCache = async function () {
      const result = await originalLoadCache();
      enforceMemoryCaps();
      return result;
    };
  }

  function compactPinimgUrl(url) {
    // Only ever emit https *.pinimg.com URLs — a non-pinimg host here would be loaded as
    // a result-card thumbnail (img.src) straight from untrusted API metadata. (audit/codex low)
    if (!isPinimgUrl(url)) return '';
    return String(url)
      .replace('/originals/', '/474x/')
      .replace(/\/(?:1200x|736x|564x|236x)\//, '/474x/');
  }

  function preferredDisplayImage(data, fallbackUrl) {
    const images = data && data.images;
    const direct =
      images &&
      ((images['474x'] && images['474x'].url) ||
        (images['564x'] && images['564x'].url) ||
        (images['236x'] && images['236x'].url) ||
        (images['736x'] && images['736x'].url) ||
        (images['1200x'] && images['1200x'].url) ||
        (images.orig && images.orig.url));
    return compactPinimgUrl(direct || fallbackUrl);
  }

  function displayImageUrl(metrics) {
    return (metrics && (metrics.displayImageUrl || compactPinimgUrl(metrics.imageUrl))) || '';
  }

  if (originalExtractMetrics) {
    extractMetrics = function (data, pinID) {
      const metrics = originalExtractMetrics(data, pinID);
      if (metrics) metrics.displayImageUrl = preferredDisplayImage(data, metrics.imageUrl);
      return metrics;
    };
  }

  function uniquePinIDs(pinIDs) {
    const out = [];
    const seen = new Set();
    (pinIDs || []).forEach((id) => {
      const clean = id == null ? '' : String(id).trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push(clean);
    });
    return out;
  }

  function getPinID(el) {
    return el && el.getAttribute ? el.getAttribute('data-test-pin-id') : null;
  }

  function isNearViewport(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom >= -LIVE_VIEWPORT_MARGIN && rect.top <= window.innerHeight + LIVE_VIEWPORT_MARGIN;
  }

  function isSortedView() {
    return !!document.getElementById('pintwist-sorted-container');
  }

  function metricValue(metrics, metric) {
    if (!metrics) return 0;
    if (metric === 'date') return metrics.createdAt ? new Date(metrics.createdAt).getTime() || 0 : 0;
    const key = METRIC_MAP[metric] || 'saves';
    return Number(metrics[key]) || 0;
  }

  function metricLabel(metrics, metric) {
    if (!metrics) return 'Saves: 0';
    if (metric === 'date') return metrics.createdAt ? getDaysAgo(metrics.createdAt) : 'Unknown';
    const label =
      metric === 'share'
        ? 'Shares'
        : metric === 'reaction'
          ? 'Reactions'
          : metric === 'repin'
            ? 'Repins'
            : metric === 'comment'
              ? 'Comments'
              : 'Saves';
    return label + ': ' + formatNumber(metricValue(metrics, metric));
  }

  function sortedPinIDs() {
    // Read the raw cache first: getCached() evicts entries past CACHE_TTL as a
    // side-effect, which would drop already-captured pins from the sorted grid /
    // CSV on long scans or cross-session pins crossing the 1h TTL. For sorting and
    // display we keep the (possibly stale) metrics rather than lose the pin.
    return Array.from(State.sortedPinIDs || [])
      .filter((id) => !!(State.metricsCache.get(id) || getCached(id)))
      .sort((a, b) => {
        const metricsB = State.metricsCache.get(b) || getCached(b);
        const metricsA = State.metricsCache.get(a) || getCached(a);
        return metricValue(metricsB, State.selectedMetric) - metricValue(metricsA, State.selectedMetric);
      });
  }

  function pruneLiveOverlays() {
    if (isSortedView()) return;
    const overlays = Array.from(document.querySelectorAll(PIN_SELECTOR + ' > .pintwist-metrics-overlay'));
    if (overlays.length <= LIVE_OVERLAY_LIMIT) return;
    overlays
      .map((overlay) => {
        const rect = overlay.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        return { overlay, distance: Math.abs(center - window.innerHeight / 2) };
      })
      .sort((a, b) => b.distance - a.distance)
      .slice(0, overlays.length - LIVE_OVERLAY_LIMIT)
      .forEach(({ overlay }) => overlay.remove());
  }

  async function getOverlaysEnabled() {
    try {
      const result = await chrome.storage.sync.get(['pintwist_show_overlays']);
      return result.pintwist_show_overlays !== false;
    } catch {
      return true;
    }
  }

  function markObserved(pinID, metrics) {
    if (!State.observedPinIDs) State.observedPinIDs = new Set();
    if (State.observedPinIDs.has(pinID)) return;
    State.observedPinIDs.add(pinID);
    if (State.observedPinIDs.size > 3000) {
      State.observedPinIDs = new Set(Array.from(State.observedPinIDs).slice(-1500));
    }
    pintwistQueueCatalogRows([pintwistCatalogRow(pinID, metrics)]);
    pintwistScheduleCountRefresh();
  }

  async function fetchBulkWithRuntimeBulk(pinIDs) {
    const unique = uniquePinIDs(pinIDs);
    const results = new Map();
    const uncached = [];
    unique.forEach((id) => {
      const cached = getCached(id);
      if (cached) results.set(id, cached);
      else uncached.push(id);
    });
    if (!uncached.length) return results;

    for (let i = 0; i < uncached.length; i += BULK_MESSAGE_SIZE) {
      const chunk = uncached.slice(i, i + BULK_MESSAGE_SIZE);
      let handled = new Set();
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'fetchBulkPins',
          pinIDs: chunk,
          config: getFreshConfig(),
          csrfToken: getCsrfToken(),
        });
        if (response && response.success && response.results) {
          Object.entries(response.results).forEach(([pinID, data]) => {
            if (!data) return;
            const metrics = extractMetrics(data, pinID);
            setCache(pinID, metrics);
            results.set(pinID, metrics);
            handled.add(pinID);
          });
        }
      } catch {
        // Fall through to the old single-pin path for this small chunk.
      }

      const missing = chunk.filter((id) => !handled.has(id) && !results.has(id));
      if (missing.length && originalFetchBulk) {
        const fallback = await originalFetchBulk(missing);
        fallback.forEach((metrics, pinID) => results.set(pinID, metrics));
      }

      if (i + BULK_MESSAGE_SIZE < uncached.length) await sleep(80);
    }
    return results;
  }

  fetchBulk = fetchBulkWithRuntimeBulk;

  processPinsBulk = async function (elements) {
    if (isSortedView()) return;
    if (!(await getOverlaysEnabled())) return;
    const candidates = [];
    const seen = new Set();
    (elements || []).forEach((el) => {
      if (!el || !el.querySelector || el.querySelector('[data-pintwist="overlay"]')) return;
      if (!isNearViewport(el)) return;
      const pinID = getPinID(el);
      if (!pinID || seen.has(pinID) || State.processingIDs.has(pinID)) return;
      if (candidates.length >= LIVE_BATCH_LIMIT) return;
      seen.add(pinID);
      State.processingIDs.add(pinID);
      candidates.push({ pinID, element: el });
    });
    if (!candidates.length) return;
    const batch = candidates;
    let metricsByID;
    try {
      metricsByID = await fetchBulk(batch.map((item) => item.pinID));
    } catch (err) {
      // Never leave pins locked if the fetch fails (common during fast-scroll bursts) —
      // otherwise they're skipped forever and overlays stop appearing.
      batch.forEach(({ pinID }) => State.processingIDs.delete(pinID));
      throw err;
    }
    requestAnimationFrame(() => {
      batch.forEach(({ pinID, element }) => {
        try {
          if (!document.contains(element) || element.querySelector('[data-pintwist="overlay"]')) return;
          const metrics = metricsByID.get(pinID);
          if (!metrics) return;
          element.insertAdjacentHTML('beforeend', createOverlayHTML(metrics));
          markObserved(pinID, metrics);
          const btn = element.querySelector('.pintwist-download-btn');
          if (btn && !btn.dataset.pintwistWired) {
            btn.dataset.pintwistWired = '1';
            btn.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              downloadImage(pinID, btn.dataset.imageUrl || '', btn);
            });
          }
        } finally {
          State.processingIDs.delete(pinID);
        }
      });
      pruneLiveOverlays();
    });
  };

  processExisting = function () {
    if (isSortedView()) return;
    getOverlaysEnabled().then((enabled) => {
      if (!enabled) return;
      const pins = Array.from(document.querySelectorAll(PIN_SELECTOR))
        .filter(isNearViewport)
        .slice(0, LIVE_BATCH_LIMIT);
      processPinsBulk(pins).catch(_pbErr);
    });
  };

  initObserver = function () {
    if (State.observer) State.observer.disconnect();
    if (liveObserverRetry) clearTimeout(liveObserverRetry);
    const container = document.querySelector('[data-test-id="masonry-container"]');
    if (!container) {
      liveObserverRetry = setTimeout(initObserver, 2000);
      return;
    }
    const pending = new Set();
    let scheduled = false;
    const flush = () => {
      scheduled = false;
      // Drop pins that scrolled out / detached, but KEEP near-viewport pins beyond this
      // batch so they aren't lost — re-schedule another flush to process the remainder.
      Array.from(pending).forEach((p) => {
        if (!document.contains(p) || !isNearViewport(p)) pending.delete(p);
      });
      const batch = Array.from(pending).slice(0, LIVE_BATCH_LIMIT);
      batch.forEach((p) => pending.delete(p));
      if (batch.length) processPinsBulk(batch).catch(_pbErr);
      if (pending.size && !scheduled) {
        scheduled = true;
        setTimeout(flush, 300);
      }
    };
    State.observer = new MutationObserver((mutations) => {
      if (isSortedView()) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          const el = node;
          if (el.closest && el.closest('[data-pintwist]')) continue;
          if (el.hasAttribute && el.hasAttribute('data-test-pin-id')) pending.add(el);
          if (el.querySelectorAll) el.querySelectorAll(PIN_SELECTOR).forEach((pin) => pending.add(pin));
        }
      }
      if (pending.size && !scheduled) {
        scheduled = true;
        setTimeout(flush, 450);
      }
    });
    State.observer.observe(container, { childList: true, subtree: true });
    // When scrolling stops, re-scan near-viewport pins so any that were skipped during a
    // fast-scroll burst get their overlays — without needing to nudge-scroll.
    if (!State.liveScrollBound) {
      State.liveScrollBound = true;
      let scrollSettleTimer = null;
      window.addEventListener(
        'scroll',
        () => {
          clearTimeout(scrollSettleTimer);
          scrollSettleTimer = setTimeout(() => {
            try {
              processExisting();
            } catch {}
          }, 250);
        },
        { passive: true }
      );
    }
  };

  if (originalToggleOverlays) {
    toggleOverlays = function (show) {
      originalToggleOverlays(show);
      if (!show && !isSortedView()) {
        document.querySelectorAll(PIN_SELECTOR + ' > .pintwist-metrics-overlay').forEach((node) => node.remove());
      }
      if (show) processExisting();
    };
  }

  clearState = function () {
    if (originalClearState) originalClearState();
    if (liveObserverRetry) {
      clearTimeout(liveObserverRetry);
      liveObserverRetry = null;
    }
    if (State.observedPinIDs) State.observedPinIDs.clear();
  };

  function getCurrentFeedIDs() {
    return uniquePinIDs(Array.from(document.querySelectorAll(PIN_SELECTOR)).map(getPinID));
  }

  async function waitForFeedChange(previousKnown) {
    const start = Date.now();
    while (Date.now() - start < SCAN_MAX_WAIT_MS) {
      await sleep(300);
      const ids = getCurrentFeedIDs();
      if (ids.some((id) => !previousKnown.has(id))) return true;
    }
    return false;
  }

  function makeProgressPanel(theme) {
    let logoUrl = '';
    try {
      logoUrl = chrome.runtime.getURL('images/logo-wordmark.png');
    } catch {}
    // One-time scoped style: the logo is the themed wordmark with a shimmer/glimmer
    // sweep while scanning (the gradient sweeps under the wordmark mask).
    if (!document.getElementById('pintwist-progress-logo-style')) {
      const st = document.createElement('style');
      st.id = 'pintwist-progress-logo-style';
      st.textContent =
        '@keyframes pintwist-logo-glimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}' +
        '#pintwist-progress-panel .pintwist-progress-logo{display:block;margin:0 auto 14px;width:150px;height:34px;' +
        '-webkit-mask-image:var(--pintwist-logo-url);mask-image:var(--pintwist-logo-url);' +
        '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;' +
        '-webkit-mask-size:contain;mask-size:contain;' +
        'background:var(--pintwist-primary,#F48FB1);}' +
        // The glimmer sweep lives on the progress bar, not the logo.
        '#pintwist-progress-panel #pintwist-progress-bar{position:relative!important;overflow:hidden!important;background:linear-gradient(90deg, var(--pintwist-primary,#F48FB1) 0%, color-mix(in srgb, var(--pintwist-primary,#F48FB1) 45%, #ffffff) 50%, var(--pintwist-primary,#F48FB1) 100%)!important;background-size:200% 100%!important;animation:pintwist-logo-glimmer 1.4s linear infinite!important;}' +
        // A soft glimmer sweep across the bar, at reduced opacity so it reads as a subtle sheen.
        '@keyframes pintwist-progress-sheen{0%{transform:translateX(-130%)}100%{transform:translateX(320%)}}' +
        '#pintwist-progress-panel #pintwist-progress-bar::after{content:"";position:absolute;top:0;bottom:0;left:0;width:45%;background:linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.85) 50%, transparent 100%);opacity:0.4;animation:pintwist-progress-sheen 1.4s ease-in-out infinite;pointer-events:none;}';
      document.head.appendChild(st);
    }
    const panel = document.createElement('div');
    panel.id = 'pintwist-progress-panel';
    panel.innerHTML =
      '<div class="pintwist-progress-card">' +
      (logoUrl
        ? '<span class="pintwist-progress-logo" style="--pintwist-logo-url:url(&quot;' +
          escapeAttr(logoUrl) +
          '&quot;)" role="img" aria-label="PinTwist"></span>'
        : '<div class="pintwist-progress-title">PinTwist scan</div>') +
      '<div class="pintwist-progress-status" id="pintwist-progress-status">Preparing...</div>' +
      '<div class="pintwist-progress-track"><div id="pintwist-progress-bar"></div></div>' +
      '<div class="pintwist-progress-meta"><span>Page <strong id="pintwist-progress-current">0</strong> &middot; <strong id="pintwist-progress-pct">0</strong>%</span><span><strong id="pintwist-progress-total">0</strong> pins captured</span></div>' +
      '<button id="pintwist-progress-cancel" type="button">Cancel scan</button>' +
      '</div>';
    panel.style.setProperty('--pintwist-primary', theme || '#F48FB1');
    return panel;
  }

  startSortingProcess = async function (pagesToLoad, metric) {
    const theme = await new Promise((resolve) => {
      try {
        chrome.storage.sync.get(['pintwist_theme_color'], (r) => resolve(r.pintwist_theme_color || '#F48FB1'));
      } catch {
        resolve('#F48FB1');
      }
    });
    removeContentOffset();
    const panel = makeProgressPanel(theme);
    document.body.appendChild(panel);

    const bar = panel.querySelector('#pintwist-progress-bar');
    const current = panel.querySelector('#pintwist-progress-current');
    const pct = panel.querySelector('#pintwist-progress-pct');
    const status = panel.querySelector('#pintwist-progress-status');
    const total = panel.querySelector('#pintwist-progress-total');
    const cancel = panel.querySelector('#pintwist-progress-cancel');

    State.selectedMetric = metric || 'saves';
    State.sortedPinIDs.clear();
    State.insertedNodes = [];
    State.count = 0;
    State.aborted = false;
    if (State.observer) {
      State.observer.disconnect();
      State.observer = null;
    }

    cancel.addEventListener('click', () => {
      State.aborted = true;
      cancel.disabled = true;
      cancel.textContent = 'Cancelling...';
    });

    const totalPages = Math.max(1, Math.min(100, parseInt(pagesToLoad, 10) || 4));
    let emptyRounds = 0;
    try {
      for (let page = 1; page <= totalPages; page++) {
        if (State.aborted) {
          status.textContent = 'Cancelled';
          setTimeout(() => panel.remove(), 1200);
          return;
        }

        const progress = Math.round((page / totalPages) * 100);
        current.textContent = String(page);
        pct.textContent = String(progress);
        bar.style.width = progress + '%';

        const ids = getCurrentFeedIDs().filter((id) => !State.sortedPinIDs.has(id));
        if (ids.length) {
          emptyRounds = 0;
          status.textContent = 'Fetching ' + ids.length + ' pins...';
          const results = await fetchBulk(ids);
          results.forEach((metrics, pinID) => {
            State.sortedPinIDs.add(pinID);
            markObserved(pinID, metrics);
          });
          State.count = State.sortedPinIDs.size;
          if (total) total.textContent = String(State.count);
          status.textContent = 'Scanning…';
        } else {
          emptyRounds += 1;
          status.textContent = 'No new pins found';
          if (emptyRounds >= 2) break;
        }

        if (page < totalPages) {
          const before = new Set(State.sortedPinIDs);
          window.scrollTo(0, document.body.scrollHeight);
          await Promise.race([waitForFeedChange(before), sleep(SCAN_SCROLL_DELAY_MS)]);
          await sleep(SCAN_SCROLL_DELAY_MS);
        }
      }

      status.textContent = 'Building clean results...';
      await sleep(250);
      panel.remove();
      finishSort();
    } catch (err) {
      panel.remove();
      const errMsg = (err && err.message) || String(err || '');
      // Context-invalidated = the extension was reloaded mid-scan (expected on update);
      // the tab is dead until refresh. Don't pop an alert for it — tear down (which also
      // surfaces a visible "extension reloaded · refresh to resume" note) and stop quietly.
      if (/context invalidated/i.test(errMsg) || !pintwistContextAlive()) {
        pintwistTeardownDeadContext();
        return;
      }
      console.error('PinTwist: scan failed', err);
      alert('PinTwist scan failed: ' + errMsg);
    }
  };

  function performanceHotfixVersion() {
    try {
      return chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '';
    } catch {
      return '';
    }
  }

  function performanceHotfixLogoHTML(version) {
    let src = '';
    try {
      src = chrome.runtime.getURL('images/logo-wordmark.png');
    } catch {}
    const logo = src
      ? '<span class="pintwist-logo-wordmark pintwist-logo-wordmark--themed" style="--pintwist-logo-url:url(&quot;' +
        escapeAttr(src) +
        '&quot;)" role="img" aria-label="PinTwist"></span>'
      : '<strong class="pintwist-text-logo">PinTwist</strong>';
    return (
      '<div class="pintwist-logo-container">' +
      logo +
      '<span class="pintwist-version-label">v' +
      escapeAttr(version || '') +
      '</span></div>'
    );
  }

  function createResortBarHTML(count) {
    const version = performanceHotfixVersion();
    const options = [
      ['saves', 'Saves'],
      ['share', 'Shares'],
      ['reaction', 'Reactions'],
      ['repin', 'Repins'],
      ['comment', 'Comments'],
      ['date', 'Last activity'],
    ];
    const sortButtons = options
      .map(
        ([value, label]) =>
          '<button class="pintwist-sort-choice' +
          (value === State.selectedMetric ? ' is-active' : '') +
          '" type="button" data-value="' +
          value +
          '" aria-pressed="' +
          (value === State.selectedMetric ? 'true' : 'false') +
          '">' +
          label +
          '</button>'
      )
      .join('');
    return (
      '' +
      '<div id="pintwist-resort-bar">' +
      performanceHotfixLogoHTML(version) +
      '<div class="resort-info" id="pintwist-match-count">' +
      count +
      ' pins sorted</div>' +
      '<label class="pintwist-rail-label">Re-sort by:</label>' +
      '<div class="pintwist-sort-grid" role="group" aria-label="Re-sort pins">' +
      sortButtons +
      '</div>' +
      '<select id="pintwist-resort-select" class="pintwist-pill-sort">' +
      options
        .map(
          ([value, label]) =>
            '<option value="' +
            value +
            '"' +
            (value === State.selectedMetric ? ' selected' : '') +
            '>' +
            label +
            '</option>'
        )
        .join('') +
      '</select>' +
      '<div class="pintwist-search-row"><input id="pintwist-search-input" type="text" placeholder="Search Pinterest"><button id="pintwist-search-btn" type="button">Go</button></div>' +
      '<label class="pintwist-checkbox-wrapper"><input id="pintwist-show-badges" type="checkbox" checked> <span>Show Badges</span></label>' +
      '<button id="pintwist-filter-toggle" type="button">Show filters</button>' +
      // Accumulated Local Catalog total (all scans) — sits right next to the CSV button it
      // resets, so the count and the action that clears it are together. Kept separate from
      // #pintwist-match-count so applyFilters() rewriting that count never clobbers it.
      '<div class="resort-info pintwist-catalog-total" title="Total pins saved across all your scans (your Local Catalog)" style="opacity:.8">' +
      '· <span id="pintwist-catalog-count">0 saved</span> total</div>' +
      '<button id="pintwist-download-csv-btn" type="button" aria-label="Download all saved pins as CSV and reset the total to zero" title="Download all saved pins (CSV) — resets the saved total to 0">&#8675; CSV</button>' +
      '<button id="pintwist-bar-catalog" class="pintwist-bar-catalog" type="button" title="Open the local catalog">Local Catalog</button>' +
      '<button id="pintwist-settings-link-resort" type="button" aria-label="Settings" title="Settings">⚙</button>' +
      '<div id="pintwist-settings-panel" class="pintwist-settings-panel" hidden>' +
      '<label for="pintwist-settings-folder">Download folder</label>' +
      '<input id="pintwist-settings-folder" type="text" value="PinTwist">' +
      '<button type="button" id="pintwist-settings-done" class="pintwist-settings-done" style="margin-top:8px;width:100%;height:34px;border:none;border-radius:8px;background:var(--pintwist-primary,#F0002D);color:#fff;font-weight:700;font-size:13px;cursor:pointer;">Done</button>' +
      '</div>' +
      '<a class="pintwist-tutorial-link" href="https://youtube.com/@iScaleLabs" target="_blank" rel="noreferrer">Tutorial</a>' +
      '</div>'
    );
  }

  setupResortBar = function () {
    const sortButtons = Array.from(document.querySelectorAll('#pintwist-resort-bar .pintwist-sort-choice'));
    const select = document.getElementById('pintwist-resort-select');
    const setActiveSort = (metric) => {
      State.selectedMetric = metric || 'saves';
      if (select) select.value = State.selectedMetric;
      sortButtons.forEach((button) => {
        const active = button.dataset.value === State.selectedMetric;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    // Re-sort dropdown (the visible control; the button grid is hidden via CSS).
    if (select) {
      setActiveSort(State.selectedMetric);
      select.addEventListener('change', () => {
        const metric = select.value || 'saves';
        setActiveSort(metric);
        resortPins(metric);
      });
    }
    if (sortButtons.length) {
      setActiveSort(State.selectedMetric);
      sortButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const metric = button.dataset.value || 'saves';
          setActiveSort(metric);
          resortPins(metric);
        });
      });
    } else {
      const btn = document.getElementById('resort-dropdown-btn');
      const menu = document.getElementById('resort-dropdown-menu');
      const text = btn?.querySelector('.dropdown-text');
      if (btn && menu) {
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          menu.classList.toggle('show');
        });
        menu.querySelectorAll('.dropdown-item').forEach((item) => {
          item.addEventListener('click', (event) => {
            const metric = event.target.dataset.value || 'saves';
            State.selectedMetric = metric;
            if (select) select.value = metric;
            if (text) text.textContent = event.target.textContent;
            menu.classList.remove('show');
            resortPins(metric);
          });
        });
        document.addEventListener('click', (event) => {
          if (!btn.contains(event.target)) menu.classList.remove('show');
        });
      }
    }

    const badgeToggle = document.getElementById('pintwist-show-badges');
    if (badgeToggle) {
      chrome.storage.sync.get(['pintwist_show_badges'], (result) => {
        const enabled = result.pintwist_show_badges !== false;
        badgeToggle.checked = enabled;
        toggleBadges(enabled);
      });
      badgeToggle.addEventListener('change', () => {
        const enabled = badgeToggle.checked;
        chrome.storage.sync.set({ pintwist_show_badges: enabled });
        toggleBadges(enabled);
      });
    }

    chrome.storage.sync.get(['pintwist_theme_color'], (result) => {
      applyThemeColor(result.pintwist_theme_color || '#F48FB1');
    });

    const dlBtn = document.getElementById('pintwist-download-csv-btn');
    if (dlBtn) {
      dlBtn.addEventListener('click', (e) => {
        // Require a real user click (exports + clears the catalog). Synthetic clicks
        // dispatched by a page script have isTrusted === false and are ignored.
        if (!e.isTrusted) return;
        pintwistDownloadAndResetCatalog(dlBtn);
      });
    }

    const barCatalog = document.getElementById('pintwist-bar-catalog');
    if (barCatalog) {
      barCatalog.addEventListener('click', () => {
        try {
          chrome.runtime.sendMessage({ action: 'openCatalog' }, () => {
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          });
        } catch {
          /* non-fatal */
        }
      });
    }

    const settingsLink = document.getElementById('pintwist-settings-link-resort');
    if (settingsLink) {
      settingsLink.addEventListener('click', (event) => {
        event.preventDefault();
        pintwistToggleSettingsPanel();
      });
    }
    pintwistWireSettingsPanel();
  };

  function createFilterBarHTML() {
    const ranges = State.filterRanges;
    const group = (metric, label, min, max, type, minLabel, maxLabel) =>
      '<div class="filter-group-wrapper filter-' +
      metric +
      '">' +
      '<div class="filter-group">' +
      '<label>' +
      label +
      ':</label>' +
      '<input aria-label="' +
      escapeAttr(minLabel || label + ' minimum') +
      '" type="' +
      (type || 'text') +
      '" id="filter-' +
      metric +
      '-min" class="filter-input" data-metric="' +
      metric +
      '" data-bound="min" value="' +
      escapeAttr(min) +
      '">' +
      '<span class="filter-dash">-</span>' +
      '<input aria-label="' +
      escapeAttr(maxLabel || label + ' maximum') +
      '" type="' +
      (type || 'text') +
      '" id="filter-' +
      metric +
      '-max" class="filter-input" data-metric="' +
      metric +
      '" data-bound="max" value="' +
      escapeAttr(max) +
      '">' +
      '<div class="filter-pills-container" data-metric="' +
      metric +
      '"></div>' +
      '</div>' +
      '</div>';
    const dateMin = new Date(ranges.date.min).toISOString().split('T')[0];
    const dateMax = new Date(ranges.date.max).toISOString().split('T')[0];
    return (
      '' +
      '<div id="pintwist-filter-bar" class="pintwist-filter-bar" aria-label="Pin filters">' +
      '<div class="filter-content">' +
      '<button id="pintwist-reset-all-filters" type="button" title="Reset all filters">Reset</button>' +
      group('saves', 'Saves', ranges.saves.min, ranges.saves.max) +
      group('comments', 'Comments', ranges.comments.min, ranges.comments.max) +
      group('repins', 'Repins', ranges.repins.min, ranges.repins.max) +
      group('reactions', 'Reactions', ranges.reactions.min, ranges.reactions.max) +
      group('shares', 'Shares', ranges.shares.min, ranges.shares.max) +
      group('date', 'Date', dateMin, dateMax, 'date', 'Date from', 'Date to') +
      '<div class="filter-date-presets">' +
      '<button type="button" class="date-preset-chip" data-days="7">7d</button>' +
      '<button type="button" class="date-preset-chip" data-days="30">30d</button>' +
      '<button type="button" class="date-preset-chip" data-days="90">90d</button>' +
      '<button type="button" class="date-preset-chip" data-days="365">365d</button>' +
      '</div>' +
      '<span class="filter-date-error" hidden>From date is after To date</span>' +
      '</div>' +
      '</div>'
    );
  }

  function createResultCard(pinID, metrics) {
    const card = document.createElement('div');
    card.className = 'pinterest--block pinbox pintwist-result-card';
    card.style.cssText =
      'position:relative;display:flex;flex-direction:column;align-items:stretch;width:100%;min-height:380px;background:#ffffff;border:1px solid #e6e6e6;border-radius:8px;overflow:hidden;box-sizing:border-box;opacity:1;visibility:visible;';
    card.dataset.pinId = pinID;
    card.setAttribute('rel', String(metricValue(metrics, State.selectedMetric)));

    const link = document.createElement('a');
    link.href = 'https://www.pinterest.com/pin/' + pinID + '/';
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.className = 'pintwist-card-image-link';
    link.style.cssText = 'display:block;width:100%;min-height:320px;text-decoration:none;background:#f5f5f5;';

    const thumbUrl = displayImageUrl(metrics);
    if (thumbUrl) {
      const img = document.createElement('img');
      img.src = thumbUrl;
      img.alt = metrics.title || metrics.altText || 'Pin thumbnail';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.cssText =
        'display:block;width:100%;height:320px;object-fit:cover;background:#f5f5f5;border:0;opacity:1;visibility:visible;';
      link.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'pintwist-placeholder-thumb';
      placeholder.style.cssText =
        'display:flex;align-items:center;justify-content:center;width:100%;height:320px;background:#f5f5f5;color:#555;font-weight:700;';
      placeholder.textContent = 'Pin ' + pinID.slice(-6);
      link.appendChild(placeholder);
    }
    card.appendChild(link);

    const badge = document.createElement('a');
    badge.href = 'https://www.pinterest.com/pin/' + pinID + '/';
    badge.target = '_blank';
    badge.rel = 'noreferrer';
    badge.className = 'pintwist-legacy-badge';
    badge.dataset.pinId = pinID;
    badge.textContent = metricLabel(metrics, State.selectedMetric);
    card.appendChild(badge);
    card.insertAdjacentHTML('beforeend', createOverlayHTML(metrics));
    return card;
  }

  function releasePinterestResources() {
    try {
      window.stop();
    } catch {}
    try {
      if (State.observer) {
        State.observer.disconnect();
        State.observer = null;
      }
      if (State.urlCheckInterval) {
        clearInterval(State.urlCheckInterval);
        State.urlCheckInterval = null;
      }
      if (State.timeout) {
        clearTimeout(State.timeout);
        State.timeout = null;
      }
      if (liveObserverRetry) {
        clearTimeout(liveObserverRetry);
        liveObserverRetry = null;
      }
      State.processingIDs.clear();
      State.inFlightRequests.clear();
      State.insertedNodes = [];
      document.querySelectorAll('img, video, source, iframe').forEach((node) => {
        try {
          node.removeAttribute('src');
          node.removeAttribute('srcset');
          if (node.tagName === 'VIDEO' && node.load) node.load();
        } catch {}
      });
    } catch {}
  }

  let pintwistShadowRoot = null;
  let pintwistDocumentLookupRestore = null;
  // Handles for the results-grid resize re-measure, so each new results view replaces (not
  // stacks) them and Back-to-live can tear them down — otherwise every re-scan leaks a
  // window 'resize' listener + a ResizeObserver holding detached DOM (audit M1).
  let _pintwistPadResizeHandler = null;
  let _pintwistPadResizeObserver = null;
  function pintwistClearPadResize() {
    if (_pintwistPadResizeHandler) {
      try {
        window.removeEventListener('resize', _pintwistPadResizeHandler);
      } catch {}
      _pintwistPadResizeHandler = null;
    }
    if (_pintwistPadResizeObserver) {
      try {
        _pintwistPadResizeObserver.disconnect();
      } catch {}
      _pintwistPadResizeObserver = null;
    }
  }

  function ensurePintwistShadowRoot() {
    let host = document.getElementById('pintwist-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'pintwist-host';
      document.documentElement.appendChild(host);
    }
    host.style.cssText =
      'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483646!important;background:#fff!important;overflow:auto!important;display:block!important;contain:layout style paint!important;';
    // Lock the page behind the results overlay: otherwise the mouse wheel scrolls
    // THIS fixed overlay while the page's own (now-covered) scrollbar sits still,
    // which reads as a frozen scrollbar. With the page locked, the overlay's own
    // scrollbar is the only one and it tracks the wheel. Restored in hidePintwistShadowResults.
    document.documentElement.style.setProperty('overflow', 'hidden', 'important');
    if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
    pintwistShadowRoot = host.shadowRoot;
    while (pintwistShadowRoot.firstChild) pintwistShadowRoot.firstChild.remove();
    return pintwistShadowRoot;
  }

  function pintwistSelectorBelongsToShadow(selector) {
    const text = String(selector || '');
    // `date-preset-chip` is the only shadow-UI class that doesn't carry a
    // pintwist/filter-/resort- prefix; without it here, document.querySelectorAll(
    // '.date-preset-chip') falls through to the (empty) light DOM and the 7d/30d
    // preset buttons never get their click handlers bound (their click->applyFilters
    // is never wired). (date-filter bug)
    return /pintwist|resort-|filter-|pinbox|pinterest--block|date-preset-chip/.test(text);
  }

  // Why monkey-patch document.getElementById/querySelector(All): the post-scan results
  // render inside a Shadow DOM (`root`), but a lot of existing code (filter bar, resort
  // bar, pin lookups) calls document.getElementById('pintwist-…') / querySelector against
  // the light DOM. Rather than rewrite every call site, we transparently redirect ONLY
  // PinTwist-owned selectors (pintwist*/resort-/filter-/date-preset-chip/pinbox/
  // pinterest--block) into the shadow root; everything else falls through to the native
  // lookup unchanged. It is fully reversible via pintwistDocumentLookupRestore(), which
  // hidePintwistShadowResults() calls when the overlay closes — so the page's own
  // document.* behavior is never left patched once results are dismissed.
  function installPintwistDocumentLookup(root) {
    if (pintwistDocumentLookupRestore) pintwistDocumentLookupRestore();
    const originalGetElementById = document.getElementById.bind(document);
    const originalQuerySelector = document.querySelector.bind(document);
    const originalQuerySelectorAll = document.querySelectorAll.bind(document);
    document.getElementById = function (id) {
      const text = String(id || '');
      if (/^(pintwist|resort-|filter-|page-)/.test(text)) {
        const match = root.getElementById(text);
        if (match) return match;
      }
      return originalGetElementById(id);
    };
    document.querySelector = function (selector) {
      if (pintwistSelectorBelongsToShadow(selector)) {
        const match = root.querySelector(selector);
        if (match) return match;
      }
      return originalQuerySelector(selector);
    };
    document.querySelectorAll = function (selector) {
      if (pintwistSelectorBelongsToShadow(selector)) {
        const matches = root.querySelectorAll(selector);
        if (matches.length) return matches;
      }
      return originalQuerySelectorAll(selector);
    };
    pintwistDocumentLookupRestore = function () {
      document.getElementById = originalGetElementById;
      document.querySelector = originalQuerySelector;
      document.querySelectorAll = originalQuerySelectorAll;
      pintwistDocumentLookupRestore = null;
    };
  }

  function hidePintwistShadowResults() {
    if (pintwistDocumentLookupRestore) pintwistDocumentLookupRestore();
    pintwistClearPadResize(); // drop the results-grid resize listener + observer (audit M1)
    const host = document.getElementById('pintwist-host');
    if (host) host.remove();
    pintwistShadowRoot = null;
    // Release the page-scroll lock set when the results overlay was shown.
    document.documentElement.style.removeProperty('overflow');
  }
  window.__pintwistHideShadowResults = hidePintwistShadowResults;
  window.__pintwistEnsurePillShadow = ensurePintwistPillShadow;

  // --- Pre-scan pill in the shadow root (transparent passthrough overlay) -------
  // The pill renders into the SAME #pintwist-host shadow root as the post-scan
  // results, so both share one isolated UI surface — Pinterest's CSS can't leak in.
  // Pre-scan the host is a transparent, click-through overlay: only the pill itself
  // captures pointer events, so the Pinterest feed underneath stays fully usable.
  function pintwistPillShadowCss() {
    const head = document.getElementById('pintwist-glass-rail-style');
    const glass = head ? head.textContent : '';
    // The head sheet styles the pill via its #pintwist-initial-bar rules (those match
    // inside the shadow). Its html.*/body/masonry rules simply no-op here — they target
    // Pinterest's own DOM and keep working from document.head. Tokens come from :host.
    return (
      pintwistLightThemeTokenCss(':host') +
      ':host{display:block!important;color:var(--pt-text)!important;font-family:var(--pt-font-body)!important}' +
      '#pintwist-initial-bar{pointer-events:auto!important}' +
      glass
    );
  }

  function ensurePintwistPillShadow() {
    let host = document.getElementById('pintwist-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'pintwist-host';
      document.documentElement.appendChild(host);
    }
    // Passthrough overlay: covers the viewport but lets clicks fall through to
    // Pinterest; the pill re-enables pointer events via the rule above.
    host.style.cssText =
      // Pre-scan pill: low z-index (like the old pill) so Pinterest's own dropdowns
      // (e.g. the top-right profile menu) render OVER the bar, not behind it. Still
      // above the feed. (The post-scan results host keeps the max z-index — it's a
      // full-page cover.)
      'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:50!important;background:transparent!important;pointer-events:none!important;overflow:visible!important;';
    if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
    const root = host.shadowRoot;
    while (root.firstChild) root.firstChild.remove();
    const style = document.createElement('style');
    style.id = 'pintwist-pill-shadow-style';
    style.textContent = pintwistPillShadowCss();
    root.appendChild(style);
    pintwistShadowRoot = root;
    installPintwistDocumentLookup(root);
    return root;
  }

  function installShadowResultsSurface() {
    const root = ensurePintwistShadowRoot();
    const resultsStyle = `
      /* Same design tokens (colors + fonts) as the pre-scan pill's glass stylesheet, so the
         results bar renders with the identical palette and typeface. Light-theme values baked in
         (the results page is always the light surface). */
      ${pintwistLightThemeTokenCss(':host')}
      :host{box-sizing:border-box!important;background:#fff!important;color:var(--pt-text)!important;font-family:var(--pt-font-body)!important;overflow:auto!important}
      #pintwist-resort-bar,#pintwist-resort-bar *{font-family:var(--pt-font-body)!important}
      *{box-sizing:border-box!important}
      #pintwist-resort-bar{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:auto!important;width:auto!important;z-index:2147483646!important;display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;gap:10px!important;padding:10px 16px!important;background:#fff!important;border-bottom:1px solid var(--pt-line-strong)!important;box-shadow:0 2px 12px rgba(0,0,0,.08)!important;overflow:visible!important}
      #pintwist-resort-bar>*{width:auto!important;max-width:none!important;min-width:0!important}
      .pintwist-logo-container{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:4px!important;min-height:34px!important;margin:0!important;border:0!important;flex:0 0 auto!important}
      /* the logo is a masked PNG wordmark; the results surface lacks the glass styling, so define it here or it renders 0x0 */
      #pintwist-resort-bar .pintwist-logo-wordmark{display:block!important;height:34px!important;width:118px!important}
      #pintwist-resort-bar .pintwist-logo-wordmark--themed{background:var(--pintwist-primary,#F0002D)!important;-webkit-mask-image:var(--pintwist-logo-url)!important;mask-image:var(--pintwist-logo-url)!important;-webkit-mask-repeat:no-repeat!important;mask-repeat:no-repeat!important;-webkit-mask-position:left center!important;mask-position:left center!important;-webkit-mask-size:contain!important;mask-size:contain!important}
      .pintwist-text-logo{color:var(--pintwist-primary,#F0002D)!important;font-size:26px!important;font-weight:900!important}
      .pintwist-version-label{color:var(--pt-muted)!important;font-size:12px!important;font-weight:700!important}
      .resort-info,.pintwist-tutorial-link{display:flex!important;align-items:center!important;justify-content:center!important;min-height:34px!important;border:1px solid var(--pt-line)!important;border-radius:8px!important;background:var(--pt-field)!important;color:var(--pt-text)!important;font-size:14px!important;font-weight:700!important;text-decoration:none!important;text-align:center!important}
      .pintwist-rail-label,#pintwist-resort-bar label{font-size:13px!important;font-weight:700!important;color:var(--pt-muted)!important;line-height:1.25!important}
      .pintwist-sort-grid{display:none!important}
      #pintwist-resort-bar .pintwist-rail-label{display:none!important}
      #pintwist-resort-select{display:inline-block!important;width:auto!important;height:34px!important;padding:0 12px!important;border:1px solid var(--pt-line-strong)!important;border-radius:9px!important;background:var(--pt-field)!important;color:var(--pt-text)!important;font-size:14px!important;font-weight:800!important;cursor:pointer!important}
      .pintwist-sort-choice{display:flex!important;align-items:center!important;justify-content:center!important;min-height:34px!important;padding:0 8px!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;background:var(--pt-field)!important;color:var(--pt-text)!important;font-size:13px!important;font-weight:800!important;cursor:pointer!important;white-space:nowrap!important}
      .pintwist-sort-choice:hover{border-color:var(--pintwist-primary,#F0002D)!important;background:#fff!important}
      .pintwist-sort-choice.is-active{border-color:var(--pintwist-primary,#F0002D)!important;background:var(--pintwist-primary,#F0002D)!important;color:#fff!important}
      .custom-dropdown-btn,#pintwist-filter-toggle,#pintwist-download-csv-btn,#pintwist-settings-link-resort,#pintwist-search-btn,#pintwist-auto-toggle,.pintwist-auto-btn{min-height:34px!important;border:1px solid var(--pintwist-primary,#F0002D)!important;border-radius:8px!important;background:var(--pintwist-primary,#F0002D)!important;color:#fff!important;font-weight:800!important;font-size:14px!important;cursor:pointer!important}
      /* slim, sleek secondary controls in the top bar */
      #pintwist-filter-toggle{min-height:34px!important;height:34px!important;padding:0 14px!important;font-size:12px!important;font-weight:600!important;border-radius:8px!important;text-transform:none!important}
      /* Settings ⚙ flush-right, immediately left of Automation (it carries the auto-margin now). */
      #pintwist-resort-bar #pintwist-settings-link-resort{order:98!important;margin-left:auto!important;min-height:34px!important;height:34px!important;width:32px!important;padding:0!important;font-size:15px!important;font-weight:600!important;border-radius:8px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;line-height:1!important}
      #pintwist-download-csv-btn{min-height:34px!important;height:34px!important;width:auto!important;padding:0 12px!important;gap:5px!important;font-size:12px!important;font-weight:700!important;letter-spacing:.3px!important;border-radius:8px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;line-height:1!important;white-space:nowrap!important}
      #pintwist-bar-catalog{min-height:34px!important;height:34px!important;width:auto!important;padding:0 12px!important;font-size:12px!important;font-weight:700!important;border-radius:8px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;line-height:1!important;white-space:nowrap!important;background:var(--pt-field-strong)!important;border:1px solid var(--pt-line-strong)!important;color:var(--pt-text)!important;cursor:pointer!important}
      /* Automation button: force solid (the glass stylesheet fades it to light blue), slim, and flush-right (just left of Tutorial) */
      #pintwist-resort-bar #pintwist-auto-toggle{order:99!important;min-height:34px!important;height:34px!important;margin-left:8px!important;padding:0 14px!important;font-size:12px!important;font-weight:600!important;border-radius:8px!important;background:var(--pintwist-primary,#F0002D)!important;border:1px solid var(--pintwist-primary,#F0002D)!important;color:#fff!important;box-shadow:none!important;text-transform:none!important}
      .custom-dropdown-menu{display:none!important}
      .custom-dropdown-menu.show{display:block!important;position:static!important;width:100%!important;background:#fff!important;border:1px solid var(--pt-line)!important;border-radius:8px!important;box-shadow:none!important;z-index:auto!important;overflow:hidden!important}
      .dropdown-item{padding:10px 12px!important;color:var(--pt-text)!important;font-weight:700!important;cursor:pointer!important}
      .dropdown-item:hover{background:var(--pintwist-primary,#F0002D)!important;color:#fff!important}
      .pintwist-search-row{display:grid!important;grid-template-columns:minmax(0,1fr) 54px!important;width:240px!important}
      #pintwist-search-input{min-width:0!important;height:34px!important;padding:0 12px!important;border:1px solid var(--pt-line)!important;border-right:0!important;border-radius:8px 0 0 8px!important;font-size:14px!important}
      #pintwist-search-btn{border-radius:0 8px 8px 0!important}
      .pintwist-checkbox-wrapper{display:flex!important;align-items:center!important;gap:8px!important;min-height:34px!important;color:var(--pt-text)!important}
      .pintwist-checkbox-wrapper input{width:18px!important;height:18px!important;accent-color:var(--pintwist-primary,#F0002D)!important}
      #pintwist-filter-bar{display:none!important}
      /* Filter panel sits BELOW the full toolbar (high order) so CSV / Settings / Automation
         stay on row 1 instead of being shoved down by this full-width block. */
      #pintwist-resort-bar>#pintwist-filter-bar{order:120!important}
      #pintwist-resort-bar>#pintwist-filter-bar.pintwist-filter-expanded{display:block!important;position:static!important;left:auto!important;right:auto!important;top:auto!important;z-index:auto!important;width:100%!important;overflow:visible!important;background:#fafafa!important;border:1px solid var(--pt-line)!important;border-radius:8px!important;padding:10px!important}
      /* Compact 2-row layout (was a grid that gave Reset and the presets each their own row):
         row 1 = the six metric/date groups + Reset (pushed flush-right); row 2 = the date presets. */
      #pintwist-filter-bar .filter-content{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:8px 6px!important;width:100%!important}
      #pintwist-filter-bar .filter-group-wrapper{flex:0 0 auto!important;width:auto!important;max-width:none!important;min-width:0!important}
      /* Visible divider between each metric/date section (only between groups, not before presets/reset). */
      #pintwist-filter-bar .filter-group-wrapper + .filter-group-wrapper{border-left:1px solid #b4b9c2!important;padding-left:7px!important}
      #pintwist-filter-bar .filter-group{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;gap:6px!important;width:auto!important;grid-template-columns:none!important}
      #pintwist-filter-bar .filter-group label{color:var(--pt-muted)!important;font-size:12px!important;font-weight:800!important;white-space:nowrap!important}
      #pintwist-filter-bar .filter-input{width:46px!important;min-width:0!important;height:34px!important;padding:0 6px!important;border:1px solid var(--pt-line-strong)!important;border-radius:6px!important;background:#fff!important;color:var(--pt-text)!important;font-size:12px!important;font-weight:700!important;flex:0 0 auto!important}
      #pintwist-filter-bar input[type="date"].filter-input{width:auto!important}
      #pintwist-filter-bar .filter-dash{color:#777!important;font-weight:800!important;flex:0 0 auto!important}
      /* Reset "x" sits INLINE after the inputs (was flex:0 0 100%, which dropped it to a
         second row and shifted the whole bar when a value was entered). */
      #pintwist-filter-bar .filter-pills-container{flex:0 0 auto!important;display:flex!important;align-items:center!important;margin-left:2px!important}
      #pintwist-filter-bar .filter-pills-container:empty{display:none!important}
      /* Presets = small inline chips right after the Date filter; Reset = compact, flush-right. */
      #pintwist-filter-bar .filter-date-presets{order:1!important;flex:0 0 auto!important;display:flex!important;flex-wrap:nowrap!important;gap:6px!important;margin:0!important}
      #pintwist-filter-bar .date-preset-chip{min-height:34px!important;height:34px!important;padding:0 10px!important;border:1px solid var(--pt-line-strong)!important;border-radius:6px!important;background:#fff!important;color:var(--pt-muted)!important;font-size:12px!important;font-weight:700!important;cursor:pointer!important;white-space:nowrap!important}
      #pintwist-filter-bar #pintwist-reset-all-filters{order:9!important;margin-left:auto!important;min-height:24px!important;height:24px!important;border:1px solid var(--pt-line-strong)!important;border-radius:5px!important;background:#fff!important;color:var(--pt-muted)!important;font-size:10px!important;font-weight:700!important;letter-spacing:0!important;text-transform:none!important;cursor:pointer!important;padding:0 7px!important;white-space:nowrap!important}
      #pintwist-filter-bar .filter-date-error{order:10!important;flex:0 0 100%!important}
      #pintwist-sorted-container{margin-left:0!important;width:100%!important;display:grid!important;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))!important;gap:18px!important;align-items:start!important;min-height:100vh!important;padding:18px!important;background:#fff!important;overflow:visible!important}
      .pintwist-result-card{position:relative!important;display:flex!important;flex-direction:column!important;min-height:380px!important;background:#fff!important;border:1px solid #e6e6e6!important;border-radius:8px!important;overflow:hidden!important;contain:layout paint style!important;opacity:1!important;visibility:visible!important}
      .pintwist-card-image-link,.pintwist-card-image-link img{display:block!important;width:100%!important;opacity:1!important;visibility:visible!important}
      .pintwist-card-image-link{min-height:320px!important;background:#f5f5f5!important;text-decoration:none!important}
      .pintwist-card-image-link img{height:320px!important;object-fit:cover!important;background:#f5f5f5!important}
      .pintwist-placeholder-thumb{display:flex!important;align-items:center!important;justify-content:center!important;height:320px!important;background:#f5f5f5!important;color:#555!important;font-weight:800!important}
      .pintwist-legacy-badge{position:absolute!important;top:10px!important;right:10px!important;z-index:3!important;padding:4px 9px!important;border-radius:999px!important;background:#242424!important;color:#fff!important;text-decoration:none!important;font-size:12px!important;font-weight:800!important;line-height:1.2!important;box-shadow:0 6px 16px rgba(0,0,0,.22)!important}
      .pintwist-metrics-overlay{position:relative!important;width:100%!important;background:var(--pt-panel-strong,#fff)!important;border-top:1px solid var(--pt-line-strong,rgba(15,23,42,.14))!important;padding:6px!important}
      .pintwist-metrics-column{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:5px!important}
      .pintwist-metric-item{display:flex!important;align-items:center!important;justify-content:center!important;gap:4px!important;min-height:34px!important;border:1px solid var(--pt-secondary-border,rgba(96,165,250,.42))!important;border-radius:6px!important;background:var(--pt-secondary-bg,rgba(96,165,250,.14))!important;color:var(--pt-secondary-text,var(--pt-text,#0f172a))!important;font-size:12px!important;font-weight:800!important}
      .pintwist-metric-item:hover{background:var(--pt-secondary-bg-hover,var(--pt-secondary-bg,rgba(96,165,250,.24)))!important}
      .pintwist-metric-icon{width:14px!important;height:14px!important;color:var(--pintwist-primary,#F0002D)!important}
      .pintwist-metric-icon svg{width:100%!important;height:100%!important;fill:currentColor!important}
      .pintwist-metric-value{color:var(--pt-secondary-text,var(--pt-text,#0f172a))!important}
      .pintwist-download-btn{display:flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;width:100%!important;height:34px!important;min-height:34px!important;margin-top:6px!important;padding:0 10px!important;border:1px solid color-mix(in srgb, var(--pt-green,var(--pintwist-primary,#F0002D)) 55%, rgba(255,255,255,.2))!important;border-radius:6px!important;background:var(--pt-green,var(--pintwist-primary,#F0002D))!important;color:#06120c!important;font-size:13px!important;font-weight:900!important;line-height:1!important;cursor:pointer!important}
      .pintwist-download-icon{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:16px!important;height:16px!important;flex:0 0 auto!important}
      .pintwist-download-icon svg{width:100%!important;height:100%!important;fill:currentColor!important}
      .pintwist-download-text{line-height:1!important}
      /* Panel grows to fit (like the pre-scan pill); the QUEUE has its own bounded scroll
         (generator) so controls stay visible. Previously max-height:520+overflow:auto clipped
         the queue below the fold post-scan, which read as "the queued searches disappeared". */
      /* order:120 = AFTER the Settings(98)/Automation(99) toolbar buttons, so the panel drops
         to its own row below the bar and those buttons stay up top. */
      #pintwist-auto-body{order:120!important;width:100%!important;max-height:none!important;overflow:visible!important;padding:10px!important;border:1px solid var(--pt-line)!important;border-radius:8px!important;background:#fff!important}
      #pintwist-auto-toggle{order:99!important}
      .pintwist-tutorial-link{order:99!important}
      /* Only the entry fields stack; the control row + actions are laid out by the shared generator. */
      .pintwist-auto-row-fields,.pintwist-auto-add-row{display:flex!important;flex-direction:column!important;gap:8px!important}
      .pintwist-auto-textarea{width:100%!important;min-height:76px!important}
      .pintwist-empty-results{grid-column:1/-1!important;padding:20px!important;background:var(--pt-field)!important;border:1px solid var(--pt-line)!important;border-radius:8px!important;font-weight:800!important}
      /* ===== Automation panel: SHARED generator (identical to the pre-scan pill) =====
         Scope to #pintwist-resort-bar (the post-scan bar that contains this auto-body) so the
         generator's rules carry the same specificity they have on the pre-scan pill. With an
         empty scope they lost to other results rules and the "Add search terms" block rendered
         inline on the left of the controls instead of full-width on its own row. */
      ${pintwistAutoLayoutCss('#pintwist-resort-bar ')}
      /* The shared generator above forces #pintwist-auto-body to display:flex. On the pre-scan
         pill the glass stylesheet gates it (hidden until the toggle is open, hidden when empty);
         the results surface had no such gate, so the empty body rendered as a stray full-width
         bar under the toolbar AND pushed Tutorial (order:99) onto a second row over the pins.
         Mirror the pill's gate here. These win over the generator by higher specificity. */
      /* Show the panel whenever it has content (renderBodyScaffold fills it when expanded and
         empties it when collapsed) — no dependency on the toggle's --open class, which was the
         fragile bit that made the post-scan panel render unstyled / queue-less. */
      #pintwist-resort-bar #pintwist-auto-body{display:none!important}
      #pintwist-resort-bar #pintwist-auto-body:not(:empty){display:flex!important}
      /* Entry fields must span the panel width (they were rendering centered/narrow). */
      #pintwist-resort-bar #pintwist-auto-body .pintwist-auto-row-fields{flex:0 0 100%!important;width:100%!important;align-items:stretch!important}
      #pintwist-resort-bar #pintwist-auto-body .pintwist-auto-add-row{width:100%!important;align-items:stretch!important}
      #pintwist-resort-bar #pintwist-auto-body .pintwist-auto-textarea{width:100%!important;max-width:none!important}
      /* "+ Add to queue" spans the full panel width (like the pre-scan pill). */
      #pintwist-resort-bar #pintwist-auto-body #pintwist-auto-add{width:100%!important;flex:0 0 auto!important;align-self:stretch!important}
      /* Settings panel = compact dropdown anchored under the bar's right edge (by the gear),
         instead of floating mid-bar. Mirrors the pre-scan pill. */
      /* Settings-panel background uses --pt-panel-strong to match the pre-scan glass
         sheet (js/content.js ~:4162). Both resolve to #fff in light theme today; kept
         identical so the two stylesheets can't silently drift before they're merged. */
      /* Anchor to a fixed offset just under the toolbar's first row (gear sits there) rather
         than top:100% — the resort bar's automation panel renders inline and grows the bar's
         height, so top:100% dropped the settings popup all the way below the open auto-panel.
         First row = 10px top padding + 34px control ≈ 44px, +6px gap. */
      #pintwist-resort-bar #pintwist-settings-panel{position:absolute!important;top:50px!important;right:8px!important;left:auto!important;width:300px!important;max-width:calc(100vw - 24px)!important;display:flex!important;flex-direction:column!important;gap:8px!important;padding:12px!important;background:var(--pt-panel-strong)!important;border:1px solid var(--pt-line-strong)!important;border-radius:8px!important;box-shadow:0 12px 28px rgba(0,0,0,.18)!important;z-index:2147483647!important}
      #pintwist-resort-bar #pintwist-settings-panel[hidden]{display:none!important}
      #pintwist-resort-bar #pintwist-settings-panel .pintwist-settings-row{display:flex!important;flex-direction:column!important;gap:4px!important;width:100%!important}
      #pintwist-resort-bar #pintwist-settings-panel input[type="text"]{width:100%!important}
      /* Tutorial link isn't needed on the dense post-scan toolbar; hiding it keeps the bar to one
         row. It remains on the pre-scan pill. */
      #pintwist-resort-bar .pintwist-tutorial-link{display:none!important}
      /* Automation buttons match the pre-scan pill: no UPPERCASE. The shared generator owns
         Stop/Clear queue colors; this results block only keeps the catalog action outlined. */
      #pintwist-resort-bar .pintwist-auto-btn,#pintwist-resort-bar .pintwist-auto-catalog-btn{text-transform:none!important;letter-spacing:0!important}
      #pintwist-resort-bar .pintwist-auto-catalog-btn{background:var(--pt-panel)!important;border:1px solid var(--pt-line-strong)!important;color:var(--pt-text)!important}
    `;
    const style = document.createElement('style');
    style.id = 'pintwist-results-surface-style';
    style.textContent = resultsStyle;
    root.appendChild(style);
    installPintwistDocumentLookup(root);
    return root;
  }

  finishSort = function () {
    const ids = sortedPinIDs();
    const cardData = ids
      .map((pinID) => [pinID, State.metricsCache.get(pinID) || getCached(pinID)])
      .filter((entry) => !!entry[1]);
    releasePinterestResources();
    removeContentOffset();
    const resultsRoot = installShadowResultsSurface();
    const container = document.createElement('div');
    container.id = 'pintwist-sorted-container';
    container.className = 'pinterest--container pintwist-results-grid';
    container.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:18px;align-items:start;min-height:100vh;background:#ffffff;box-sizing:border-box;overflow:visible;';
    const fragment = document.createDocumentFragment();
    cardData.forEach(([pinID, metrics]) => {
      fragment.appendChild(createResultCard(pinID, metrics));
    });
    container.appendChild(fragment);
    container.dataset.pintwistCardCount = String(container.children.length);
    if (!container.children.length) {
      const empty = document.createElement('div');
      empty.className = 'pintwist-empty-results';
      empty.textContent = ids.length
        ? 'PinTwist captured pins, but no cached card data was available. Refresh Pinterest and run the scan again.'
        : 'No pins were captured. Refresh Pinterest and run the scan again.';
      container.appendChild(empty);
    }
    const cards = Array.from(container.querySelectorAll('.pinterest--block'));
    if (cards.length) {
      calculateFilterRanges(cards);
    } else {
      const today = new Date();
      const yearAgo = new Date();
      yearAgo.setFullYear(today.getFullYear() - 1);
      State.filterRanges = {
        saves: { min: 0, max: 0 },
        comments: { min: 0, max: 0 },
        repins: { min: 0, max: 0 },
        reactions: { min: 0, max: 0 },
        shares: { min: 0, max: 0 },
        date: {
          min: new Date(yearAgo.toISOString().split('T')[0]).getTime(),
          max: new Date(today.toISOString().split('T')[0]).getTime(),
        },
      };
      State.activeFilters = JSON.parse(JSON.stringify(State.filterRanges));
    }

    const shell = document.createElement('div');
    shell.innerHTML = createResortBarHTML(ids.length) + createFilterBarHTML();
    const shellBar = shell.querySelector('#pintwist-resort-bar');
    const shellFilter = shell.querySelector('#pintwist-filter-bar');
    const shellFilterToggle = shellBar && shellBar.querySelector('#pintwist-filter-toggle');
    if (shellBar && shellFilter && shellFilterToggle && shellFilterToggle.parentNode === shellBar) {
      // insertBefore requires the reference node to be a DIRECT child of shellBar;
      // querySelector can match a nested toggle, whose nextSibling isn't a child here.
      shellBar.insertBefore(shellFilter, shellFilterToggle.nextSibling);
    } else if (shellBar && shellFilter) {
      shellBar.appendChild(shellFilter);
    }
    while (shell.firstChild) resultsRoot.appendChild(shell.firstChild);
    resultsRoot.appendChild(container);

    State.insertedNodes = [];
    applyContentOffset();
    // The resort bar is position:fixed (so it stays visible on scroll). Pad the results
    // grid by the bar's height so the first rows aren't hidden under it (re-measured on resize).
    const padForFixedBar = () => {
      const rb = document.getElementById('pintwist-resort-bar');
      const c = document.getElementById('pintwist-sorted-container');
      // The grid carries `padding:18px !important`, so the dynamic top offset must ALSO be
      // !important or it's ignored and the fixed bar overlaps the first row of pins.
      if (rb && c) c.style.setProperty('padding-top', rb.offsetHeight + 14 + 'px', 'important');
    };
    requestAnimationFrame(padForFixedBar);
    // Replace any prior view's handlers first so they don't accumulate across re-scans (M1).
    pintwistClearPadResize();
    try {
      _pintwistPadResizeHandler = padForFixedBar;
      window.addEventListener('resize', padForFixedBar);
    } catch {}
    // Re-measure whenever the bar's own height changes (filter panel / automation panel
    // expanding or collapsing), so the grid offset always matches the live bar height.
    try {
      const barEl = document.getElementById('pintwist-resort-bar');
      if (barEl && typeof ResizeObserver !== 'undefined') {
        _pintwistPadResizeObserver = new ResizeObserver(padForFixedBar);
        _pintwistPadResizeObserver.observe(barEl);
      }
    } catch {}
    reattachListeners();
    setupResortBar();
    pintwistRefreshCatalogCount(); // fill the accumulated "N saved total" chip on the resort bar
    setupSearchBar();
    setupFilterBar();
    applyThemeColor(
      getComputedStyle(document.documentElement).getPropertyValue('--pintwist-primary').trim() || '#F48FB1'
    );
    window.scrollTo(0, 0);
    saveCache();
  };

  window.addEventListener('pagehide', () => {
    try {
      if (State.observer) State.observer.disconnect();
      State.processingIDs.clear();
      State.insertedNodes = [];
      saveCache();
    } catch {}
  });
})();
