// ===== PINTWIST - BACKGROUND SERVICE WORKER =====
// No Clerk imports. Chrome's cookie API is the source of truth.

const AUTH_KEY = 'pintwist_auth';
const AUTH_DOMAIN = 'https://www.iscalelabs.com';

// ===== INGEST: anonymous pin observation telemetry =====
const INGEST_SUPABASE_URL = 'https://tzuvthfkdguxisquxlnb.supabase.co';
const INGEST_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6dXZ0aGZrZGd1eGlzcXV4bG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjAyODgsImV4cCI6MjA5MjEzNjI4OH0.DEaCLE030q5B2snqe1rCfy1qJLjqswYaMuwlhy_424o';
const INGEST_URL = INGEST_SUPABASE_URL + '/functions/v1/ingest';
const INGEST_FLUSH_INTERVAL_MS = 10_000;
const INGEST_MAX_BUFFER = 50;
const INGEST_OFFLINE_CAP = 500;
const INGEST_SESSION_DEDUP_TTL_MS = 60 * 60 * 1000;

const ingestState = {
  installId: null,
  buffer: new Map(),
  sessionSeen: new Map(),
  flushTimer: null,
  flushing: false,
  bootstrapped: false,
};

async function ingestEnsureInstallId() {
  if (ingestState.installId) return ingestState.installId;
  const { pintwist_install_id: existing } = await chrome.storage.local.get('pintwist_install_id');
  if (existing) {
    ingestState.installId = existing;
    return existing;
  }
  const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
  await chrome.storage.local.set({ pintwist_install_id: newId });
  ingestState.installId = newId;
  return newId;
}

async function ingestBootstrap() {
  if (ingestState.bootstrapped) return;
  ingestState.bootstrapped = true;
  await ingestEnsureInstallId();
}

function ingestScheduleFlush() {
  if (ingestState.flushTimer) return;
  ingestState.flushTimer = setTimeout(() => {
    ingestState.flushTimer = null;
    ingestFlush();
  }, INGEST_FLUSH_INTERVAL_MS);
}

function ingestEnqueue(obs) {
  const pinId = obs && obs.pin && obs.pin.pin_id;
  if (!pinId) return;
  const now = Date.now();
  const last = ingestState.sessionSeen.get(pinId);
  if (last && now - last < INGEST_SESSION_DEDUP_TTL_MS) return;
  ingestState.sessionSeen.set(pinId, now);

  if (ingestState.sessionSeen.size > 5000) {
    const cutoff = now - INGEST_SESSION_DEDUP_TTL_MS;
    for (const [id, t] of ingestState.sessionSeen) {
      if (t < cutoff) ingestState.sessionSeen.delete(id);
    }
  }

  ingestState.buffer.set(pinId, {
    pin_id: pinId,
    saves: obs.pin.saves ?? null,
    reactions: obs.pin.reactions ?? null,
    shares: obs.pin.shares ?? null,
    repins: obs.pin.repins ?? null,
    comments: obs.pin.comments ?? null,
    pin_created_at: obs.pin.pin_created_at || null,
    image_url: obs.pin.image_url || null,
    is_video: typeof obs.pin.is_video === 'boolean' ? obs.pin.is_video : null,
    // Rich metadata (v1.6.3+).
    title: obs.pin.title || null,
    description: obs.pin.description || null,
    link: obs.pin.link || null,
    domain: obs.pin.domain || null,
    dominant_color: obs.pin.dominant_color || null,
    alt_text: obs.pin.alt_text || null,
    board_name: obs.pin.board_name || null,
    pinner_username: obs.pin.pinner_username || null,
    source_url: obs.source_url || null,
    search_terms: obs.search_terms || null,
    seen_at: obs.seen_at || new Date().toISOString(),
  });

  if (ingestState.buffer.size >= INGEST_MAX_BUFFER) {
    ingestFlush();
  } else {
    ingestScheduleFlush();
  }
}

async function ingestFlush() {
  if (ingestState.flushing) return;
  ingestState.flushing = true;
  try {
    await ingestBootstrap();
    await ingestDrainOfflineQueue();

    if (ingestState.buffer.size === 0) return;

    const batch = Array.from(ingestState.buffer.values());
    ingestState.buffer.clear();

    const ok = await ingestSendBatch(batch);
    if (!ok) await ingestPersistOffline(batch);
  } finally {
    ingestState.flushing = false;
  }
}

async function ingestSendBatch(batch) {
  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: INGEST_ANON_KEY,
        authorization: 'Bearer ' + INGEST_ANON_KEY,
      },
      body: JSON.stringify({ install_id: ingestState.installId, batch }),
    });
    if (res.ok) return true;
    // 429 = rate limited, 5xx = server error → persist offline and retry later.
    // 4xx other than 429 = request rejected (bad payload, bad auth, schema drift).
    // Previously these returned true, silently dropping the batch. Now we persist
    // offline so data isn't lost before we notice the underlying issue — bounded
    // by INGEST_OFFLINE_CAP (500 pins), so a persistent 4xx won't balloon storage.
    if (res.status >= 400) {
      console.warn('[PinTwist] Ingest non-ok status:', res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[PinTwist] Ingest network error:', err);
    return false;
  }
}

async function ingestPersistOffline(batch) {
  const { pintwist_offline_queue = [] } = await chrome.storage.local.get('pintwist_offline_queue');
  const combined = pintwist_offline_queue.concat(batch);
  const trimmed = combined.length > INGEST_OFFLINE_CAP
    ? combined.slice(combined.length - INGEST_OFFLINE_CAP)
    : combined;
  await chrome.storage.local.set({ pintwist_offline_queue: trimmed });
}

async function ingestDrainOfflineQueue() {
  const { pintwist_offline_queue = [] } = await chrome.storage.local.get('pintwist_offline_queue');
  if (!pintwist_offline_queue.length) return;
  const queue = pintwist_offline_queue.slice();
  await chrome.storage.local.set({ pintwist_offline_queue: [] });

  const failed = [];
  const CHUNK = 50;
  for (let i = 0; i < queue.length; i += CHUNK) {
    const chunk = queue.slice(i, i + CHUNK);
    const ok = await ingestSendBatch(chunk);
    if (!ok) failed.push.apply(failed, chunk);
  }
  if (failed.length) await ingestPersistOffline(failed);
}

// Bootstrap as soon as the worker wakes
ingestBootstrap();

async function syncAuthState() {
  try {
    const cookie = await chrome.cookies.get({
      url: AUTH_DOMAIN,
      name: '__client_uat',
    });

    // Clerk sets __client_uat to a timestamp when signed in, "0" when signed out.
    const isSignedIn = cookie !== null && cookie.value !== '0';

    const state = {
      signedIn: isSignedIn,
      updatedAt: Date.now(),
    };

    await chrome.storage.local.set({ [AUTH_KEY]: state });
    console.log('[PinTwist] Auth state synced:', isSignedIn);
    return isSignedIn;
  } catch (err) {
    console.error('[PinTwist] Cookie check failed:', err);
    return false;
  }
}

// ── Trigger 1: Extension starts or installs ──
chrome.runtime.onStartup.addListener(syncAuthState);
chrome.runtime.onInstalled.addListener(() => {
  syncAuthState();
  chrome.storage.sync.set({
    pintwist_enabled: true,
    pintwist_show_overlays: true,
    pintwist_show_badges: true,
    pintwist_theme_color: '#F48FB1',
  });
  chrome.storage.local.set({ sortOption: 'saves' });
  ingestBootstrap();
  console.log('PinTwist: Installed');
});

// ── Trigger 2: Any Clerk cookie changes on iscalelabs.com ──
chrome.cookies.onChanged.addListener((changeInfo) => {
  const { cookie } = changeInfo;
  if (
    cookie.domain.includes('iscalelabs.com') &&
    (cookie.name === '__client_uat' || cookie.name === '__session')
  ) {
    syncAuthState();
  }
});

// ── Trigger 3: Web page tells us auth changed (fast path for first install) ──
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== 'https://www.iscalelabs.com') {
    sendResponse({ ok: false, error: 'unauthorized' });
    return;
  }

  if (message?.type === 'PINTWIST_AUTH_SYNC') {
    syncAuthState().then((isSignedIn) => {
      sendResponse({ ok: true, signedIn: isSignedIn });
    });
    return true;
  }

  sendResponse({ ok: false, error: 'unknown_type' });
});

// ── Trigger 4: Content script asks for current state ──
// Also handles pin data fetches and downloads
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === 'PINTWIST_CHECK_AUTH') {
    syncAuthState().then((isSignedIn) => {
      sendResponse({ signedIn: isSignedIn });
    });
    return true;
  }

  // Pin data fetch
  if (request.action === 'fetchPinData') {
    fetchSinglePin(request.pinID, request.config, request.csrfToken)
      .then((data) => sendResponse({ success: true, data, pinID: request.pinID }))
      .catch((err) => sendResponse({ success: false, error: err.message, status: err.status, pinID: request.pinID }));
    return true;
  }

  // Bulk pin fetch
  if (request.action === 'fetchBulkPins') {
    fetchBulkPins(request.pinIDs, request.config, request.csrfToken)
      .then((resultsMap) => {
        const results = {};
        resultsMap.forEach((data, id) => (results[id] = data));
        sendResponse({ success: true, results });
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Download
  if (request.action === 'downloadImage') {
    handleDownload(request.url, request.filename);
    sendResponse({ success: true });
    return true;
  }

  // Anonymous pin observation (ingest)
  if (request.action === 'recordPinObservation') {
    ingestEnqueue(request);
    sendResponse({ ok: true });
    return true;
  }

  return true;
});

// ===== PIN API HELPERS =====
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
    throw { status: 429, message: 'Rate limited after retries' };
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
          data.forEach((pin) => { if (pin?.id) results.set(pin.id, pin); });
          continue;
        }
      }
    } catch {
      console.warn('PinTwist: Bulk endpoint failed, using parallel fetch');
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
    fetchResults.forEach((r) => { if (r.success && r.data) results.set(r.pinID, r.data); });
  }
  return results;
}

async function handleDownload(url, filename) {
  try {
    const urlPath = new URL(url).pathname;
    const ext = urlPath.split('.').pop()?.split('?')[0] || 'jpg';
    const cleanFilename = filename.replace(/\.[^.]+$/, '') + '.' + ext;
    await chrome.downloads.download({ url, filename: cleanFilename, saveAs: false, conflictAction: 'uniquify' });
  } catch (error) {
    console.error('PinTwist: Download failed:', error);
    try { await chrome.tabs.create({ url, active: false }); } catch {}
  }
}
