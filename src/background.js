// ===== PINTWIST FREE - LOCAL-ONLY BACKGROUND SERVICE WORKER =====

const DOWNLOAD_FOLDER_KEY = 'pintwist_download_folder';
const DOWNLOAD_ASK_EACH_TIME_KEY = 'pintwist_download_ask_each_time';
const DEFAULT_DOWNLOAD_FOLDER = 'PinTwist';

// --- Trust-boundary guards -------------------------------------------------
// Images live on Pinterest's pinimg CDN; never download/fetch from other hosts.
function isAllowedImageUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && /(^|\.)pinimg\.com$/i.test(x.hostname);
  } catch {
    return false;
  }
}
// Metric fetches must target a Pinterest origin (config.origin comes from the
// content script's page; validate it before using it as a fetch base).
// Strict host allowlist — the EXACT registrable Pinterest hosts the extension supports,
// in lockstep with manifest.json `host_permissions` (cross-checked by a test). The old
// `pinterest\.[a-z]{2,}$` fallback accepted fake TLDs like `pinterest.evil`, and the
// partial two-label list rejected real ccTLDs like `pinterest.co.in` (Pinterest India).
// Mirrors catalog-utils.js isPinterestHost / PINTEREST_HOST_SUFFIXES.
const PINTEREST_HOST_SUFFIXES = [
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
function isPinterestHostname(hostname) {
  const h = String(hostname || '')
    .toLowerCase()
    .replace(/\.$/, '');
  return PINTEREST_HOST_SUFFIXES.some((sfx) => h === sfx || h.endsWith('.' + sfx));
}
function isPinterestOrigin(origin) {
  try {
    const x = new URL(origin);
    return x.protocol === 'https:' && isPinterestHostname(x.hostname);
  } catch {
    return false;
  }
}
// Messages should only come from this extension's own pages/content scripts.
function isOwnSender(sender) {
  return !!sender && sender.id === chrome.runtime.id;
}
// Strip path separators / traversal / control chars from a download filename.
function sanitizeDownloadName(name) {
  return (
    String(name || 'pintwist')
      .replace(/[\\/]+/g, '_')
      .replace(/\.{2,}/g, '_')
      .replace(/[\x00-\x1f<>:"|?*]/g, '_')
      .slice(0, 150) || 'pintwist'
  );
}

chrome.runtime.onInstalled.addListener(() => {
  const preferenceDefaults = {
    pintwist_enabled: true,
    pintwist_show_overlays: true,
    pintwist_show_badges: true,
    pintwist_theme_color: '#F48FB1',
    [DOWNLOAD_FOLDER_KEY]: DEFAULT_DOWNLOAD_FOLDER,
    [DOWNLOAD_ASK_EACH_TIME_KEY]: false,
  };

  chrome.storage.sync.get(Object.keys(preferenceDefaults), (current) => {
    const missing = {};
    for (const [key, value] of Object.entries(preferenceDefaults)) {
      if (current[key] === undefined) missing[key] = value;
    }
    if (Object.keys(missing).length) chrome.storage.sync.set(missing);
  });

  chrome.storage.local.set({ sortOption: 'saves' });

  // One-time migration: split CSV imports out of the scan-accumulation store.
  // Historically both scans AND catalog CSV imports lived in `pintwist_catalog_rows`,
  // so importing inflated the bar's "N saved (manual scans)" count. Move the existing
  // rows (historically all imports) into the independent `pintwist_catalog_imports`
  // store and reset the scan store, so the bar reflects scans only going forward.
  chrome.storage.local.get(
    {
      pintwist_catalog_rows: [],
      pintwist_catalog_imports: [],
      pintwist_import_split_v1: false,
    },
    (res) => {
      if (res.pintwist_import_split_v1) return;
      const existing = Array.isArray(res.pintwist_catalog_rows) ? res.pintwist_catalog_rows : [];
      const imports = Array.isArray(res.pintwist_catalog_imports)
        ? res.pintwist_catalog_imports
        : [];
      // All three keys are written in one atomic set (data move + done-flag together),
      // so a failure leaves everything untouched and the migration simply retries on the
      // next onInstalled. Log on failure rather than silently assuming success.
      chrome.storage.local.set(
        {
          pintwist_catalog_imports: imports.concat(existing),
          pintwist_catalog_rows: [],
          pintwist_import_split_v1: true,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.warn(
              'PinTwist Free: import-split migration deferred:',
              chrome.runtime.lastError.message
            );
          }
        }
      );
    }
  );

  console.log('PinTwist Free: Installed');
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only honor messages from our own extension contexts (popup/content/catalog).
  if (!isOwnSender(sender)) return;
  // A content script asking which tab it's in (used to make the automation queue
  // single-OWNER so a second Pinterest tab can't hijack/pause it). (audit HIGH-1/HIGH-2)
  if (request.action === 'getTabId') {
    sendResponse({ tabId: sender && sender.tab ? sender.tab.id : null });
    return true;
  }
  // Is a given tab still open? Used so a surviving Pinterest tab can detect that the tab
  // OWNING the automation queue was closed and take over, instead of stalling forever.
  // chrome.tabs.get works without the "tabs" permission for existence checks (it just omits
  // url/title). Resolves {open:false} only when the tab is genuinely gone.
  if (request.action === 'isTabOpen') {
    const id = request.tabId;
    if (typeof id !== 'number') {
      sendResponse({ open: false });
      return true;
    }
    try {
      chrome.tabs.get(id, (tab) => {
        const open = !chrome.runtime.lastError && !!tab;
        sendResponse({ open });
      });
    } catch {
      sendResponse({ open: false });
    }
    return true;
  }

  if (request.action === 'fetchPinData') {
    if (!isPinterestOrigin(request.config && request.config.origin)) {
      sendResponse({ success: false, error: 'invalid_origin', pinID: request.pinID });
      return true;
    }
    fetchSinglePin(request.pinID, request.config, request.csrfToken)
      .then((data) => sendResponse({ success: true, data, pinID: request.pinID }))
      .catch((err) =>
        sendResponse({
          success: false,
          error: err.message,
          status: err.status,
          pinID: request.pinID,
        })
      );
    return true;
  }

  if (request.action === 'fetchBulkPins') {
    if (!isPinterestOrigin(request.config && request.config.origin)) {
      sendResponse({ success: false, error: 'invalid_origin' });
      return true;
    }
    fetchBulkPins(request.pinIDs, request.config, request.csrfToken)
      .then((resultsMap) => {
        const results = {};
        resultsMap.forEach((data, id) => (results[id] = data));
        sendResponse({ success: true, results });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'downloadImage') {
    if (!isAllowedImageUrl(request.url)) {
      sendResponse({ success: false, error: 'blocked_url' });
      return true;
    }
    handleDownload(request.url, request.filename)
      .then(() => sendResponse({ success: true }))
      .catch((err) =>
        sendResponse({ success: false, error: (err && err.message) || 'download_failed' })
      );
    return true;
  }

  if (request.action === 'downloadCsv') {
    handleCsvDownload(request.csv, request.filename)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err && err.message }));
    return true;
  }

  if (request.action === 'openCatalog') {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('catalog.html') });
    } catch {
      /* non-fatal */
    }
    sendResponse({ success: true });
    return true;
  }

  return true;
});

function buildHeaders(config, csrfToken) {
  const headers = {
    accept: 'application/json, text/javascript, */*, q=0.01',
    'accept-language': 'en-US,en;q=0.9',
    'x-app-version': config.appVersion,
    'x-pinterest-appstate': 'active',
    'x-pinterest-experimenthash': config.experimentHash,
    'x-pinterest-source-url': config.path,
    'x-pinterest-pws-handler': config.handlerId,
    'x-requested-with': 'XMLHttpRequest',
  };
  if (csrfToken) headers['x-csrftoken'] = csrfToken;
  return headers;
}

async function fetchSinglePin(pinID, config, csrfToken, retryCount = 2) {
  const options = { id: pinID, field_set_key: 'detailed', fetch_visual_search_objects: true };
  const params = new URLSearchParams({
    source_url: config.path || '/',
    data: JSON.stringify({ options, context: {} }),
    _: Date.now().toString(),
  });
  const response = await fetch(`${config.origin}/resource/PinResource/get/?${params}`, {
    method: 'GET',
    headers: buildHeaders(config, csrfToken),
    credentials: 'include',
  });
  if (response.status === 429) {
    if (retryCount > 0) {
      const waitTime = (3 - retryCount) * 30000;
      await new Promise((r) => setTimeout(r, waitTime));
      return fetchSinglePin(pinID, config, csrfToken, retryCount - 1);
    }
    throw Object.assign(new Error('Rate limited after retries'), { status: 429 });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  return json?.resource_response?.data ?? null;
}

async function fetchBulkPins(pinIDs, config, csrfToken) {
  const results = new Map();
  const CHUNK_SIZE = 25;
  for (let i = 0; i < pinIDs.length; i += CHUNK_SIZE) {
    const chunk = pinIDs.slice(i, i + CHUNK_SIZE);
    try {
      const options = { pin_ids: chunk, field_set_key: 'detailed' };
      const params = new URLSearchParams({
        source_url: config.path || '/',
        data: JSON.stringify({ options, context: {} }),
        _: Date.now().toString(),
      });
      const response = await fetch(`${config.origin}/resource/PinsResource/get/?${params}`, {
        method: 'GET',
        headers: buildHeaders(config, csrfToken),
        credentials: 'include',
      });
      if (response.ok) {
        const json = await response.json();
        const data = json?.resource_response?.data;
        if (Array.isArray(data)) {
          data.forEach((pin) => {
            if (pin?.id) results.set(pin.id, pin);
          });
          continue;
        }
      }
    } catch {
      console.warn('PinTwist Free: Bulk endpoint failed, using parallel fetch');
    }
    const fetchResults = await Promise.all(
      chunk.map(async (pinID) => {
        try {
          const data = await fetchSinglePin(pinID, config, csrfToken);
          return { pinID, data, success: true };
        } catch {
          return { pinID, data: null, success: false };
        }
      })
    );
    fetchResults.forEach((r) => {
      if (r.success && r.data) results.set(r.pinID, r.data);
    });
  }
  return results;
}

async function handleDownload(url, filename) {
  if (!isAllowedImageUrl(url)) {
    console.warn('PinTwist Free: blocked non-Pinterest image download');
    return;
  }
  try {
    const urlPath = new URL(url).pathname;
    const ext =
      (urlPath.split('.').pop()?.split('?')[0] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    const cleanFilename = sanitizeDownloadName(filename).replace(/\.[^.]+$/, '') + '.' + ext;
    const prefs = await chrome.storage.sync.get([DOWNLOAD_FOLDER_KEY, DOWNLOAD_ASK_EACH_TIME_KEY]);
    const askEachTime = false; // "Ask each time" option removed — always save silently to the folder.
    const folder = sanitizeDownloadFolder(prefs[DOWNLOAD_FOLDER_KEY]);
    const targetFilename = !askEachTime && folder ? `${folder}/${cleanFilename}` : cleanFilename;
    await chrome.downloads.download({
      url,
      filename: targetFilename,
      saveAs: askEachTime,
      conflictAction: 'uniquify',
    });
  } catch (error) {
    // Do NOT fall back to opening the URL in a tab — that would navigate to a
    // possibly-untrusted URL. Surface the failure to the caller so the message
    // response reflects reality instead of always reporting success.
    console.error('PinTwist Free: Download failed:', error);
    throw error;
  }
}

async function handleCsvDownload(csvText, filename) {
  try {
    const cleanFilename =
      sanitizeDownloadName(filename || 'pintwist_scan').replace(/\.[^.]+$/, '') + '.csv';
    const prefs = await chrome.storage.sync.get([DOWNLOAD_FOLDER_KEY, DOWNLOAD_ASK_EACH_TIME_KEY]);
    const askEachTime = false; // "Ask each time" option removed — always save silently to the folder.
    const folder = sanitizeDownloadFolder(prefs[DOWNLOAD_FOLDER_KEY]);
    const targetFilename = !askEachTime && folder ? `${folder}/${cleanFilename}` : cleanFilename;
    const dataUrl =
      'data:text/csv;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(csvText || '')));
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: targetFilename,
      saveAs: askEachTime,
      conflictAction: 'uniquify',
    });
    // Resolve only when the file is actually WRITTEN, not merely queued (audit C1).
    // chrome.downloads.download() resolves at queue time; the catalog auto-export clears
    // accumulated data on this call's success, so a queued-but-then-interrupted download
    // (disk full / permission / cancel) would wipe data with no real backup. Wait for the
    // download to reach 'complete' (throw on 'interrupted' so the caller keeps the data).
    await waitForDownloadComplete(downloadId);
  } catch (error) {
    console.error('PinTwist Free: CSV download failed:', error);
    throw error;
  }
}

function waitForDownloadComplete(downloadId) {
  return new Promise((resolve, reject) => {
    if (typeof downloadId !== 'number') return reject(new Error('no_download_id'));
    let settled = false;
    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      try {
        chrome.downloads.onChanged.removeListener(onChanged);
      } catch {}
      clearTimeout(timer);
      ok ? resolve() : reject(err || new Error('download_failed'));
    };
    const onChanged = (delta) => {
      if (!delta || delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete') finish(true);
      else if (delta.state.current === 'interrupted')
        finish(false, new Error('download_interrupted'));
    };
    chrome.downloads.onChanged.addListener(onChanged);
    // The file can finish before the listener attaches (small CSVs write instantly) — check now.
    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items && items[0];
      if (!item) return; // not found yet; rely on onChanged
      if (item.state === 'complete') finish(true);
      else if (item.state === 'interrupted') finish(false, new Error('download_interrupted'));
    });
    // Safety valve: never hang the caller forever (a very large/slow write). On timeout, treat as
    // failure so the caller keeps the catalog rather than risk clearing it unverified.
    const timer = setTimeout(() => finish(false, new Error('download_timeout')), 60000);
  });
}

function sanitizeDownloadFolder(folder) {
  if (typeof folder !== 'string') return '';
  return folder
    .replace(/\\/g, '/')
    .split('/')
    .map((part) =>
      part
        .trim()
        .replace(/[<>:"|?*\x00-\x1F]/g, '-')
        .replace(/^\.+|\.+$/g, '')
    )
    .filter((part) => part.length > 0 && part !== '..')
    .join('/');
}
