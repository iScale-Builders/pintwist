const AUTH_KEY = "pintwist_auth";
const AUTH_DOMAIN = "https://www.iscalelabs.com";
async function syncAuthState() {
  try {
    const cookie = await chrome.cookies.get({
      url: AUTH_DOMAIN,
      name: "__client_uat"
    });
    const isSignedIn = cookie !== null && cookie.value !== "0";
    const state = {
      signedIn: isSignedIn,
      updatedAt: Date.now()
    };
    await chrome.storage.local.set({ [AUTH_KEY]: state });
    console.log("[PinTwist] Auth state synced:", isSignedIn);
    return isSignedIn;
  } catch (err) {
    console.error("[PinTwist] Cookie check failed:", err);
    return false;
  }
}
chrome.runtime.onStartup.addListener(syncAuthState);
chrome.runtime.onInstalled.addListener(() => {
  syncAuthState();
  chrome.storage.sync.set({
    pintwist_enabled: true,
    pintwist_show_overlays: true,
    pintwist_show_badges: true,
    pintwist_theme_color: "#F48FB1"
  });
  chrome.storage.local.set({ sortOption: "saves" });
  console.log("PinTwist: Installed");
});
chrome.cookies.onChanged.addListener((changeInfo) => {
  const { cookie } = changeInfo;
  if (cookie.domain.includes("iscalelabs.com") && (cookie.name === "__client_uat" || cookie.name === "__session")) {
    syncAuthState();
  }
});
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (sender.origin !== "https://www.iscalelabs.com") {
    sendResponse({ ok: false, error: "unauthorized" });
    return;
  }
  if (message?.type === "PINTWIST_AUTH_SYNC") {
    syncAuthState().then((isSignedIn) => {
      sendResponse({ ok: true, signedIn: isSignedIn });
    });
    return true;
  }
  sendResponse({ ok: false, error: "unknown_type" });
});
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type === "PINTWIST_CHECK_AUTH") {
    syncAuthState().then((isSignedIn) => {
      sendResponse({ signedIn: isSignedIn });
    });
    return true;
  }
  if (request.action === "fetchPinData") {
    fetchSinglePin(request.pinID, request.config, request.csrfToken).then((data) => sendResponse({ success: true, data, pinID: request.pinID })).catch((err) => sendResponse({ success: false, error: err.message, status: err.status, pinID: request.pinID }));
    return true;
  }
  if (request.action === "fetchBulkPins") {
    fetchBulkPins(request.pinIDs, request.config, request.csrfToken).then((resultsMap) => {
      const results = {};
      resultsMap.forEach((data, id) => results[id] = data);
      sendResponse({ success: true, results });
    }).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.action === "downloadImage") {
    handleDownload(request.url, request.filename);
    sendResponse({ success: true });
    return true;
  }
  return true;
});
function buildHeaders(config, csrfToken) {
  const headers = {
    accept: "application/json, text/javascript, */*, q=0.01",
    "accept-language": "en-US,en;q=0.9",
    "x-app-version": config.appVersion,
    "x-pinterest-appstate": "active",
    "x-pinterest-experimenthash": config.experimentHash,
    "x-pinterest-source-url": config.path,
    "x-pinterest-pws-handler": config.handlerId,
    "x-requested-with": "XMLHttpRequest"
  };
  if (csrfToken) headers["x-csrftoken"] = csrfToken;
  return headers;
}
async function fetchSinglePin(pinID, config, csrfToken, retryCount = 2) {
  const options = { id: pinID, field_set_key: "detailed", fetch_visual_search_objects: true };
  const params = new URLSearchParams({
    source_url: config.path || "/",
    data: JSON.stringify({ options, context: {} }),
    _: Date.now().toString()
  });
  const response = await fetch(`${config.origin}/resource/PinResource/get/?${params}`, {
    method: "GET",
    headers: buildHeaders(config, csrfToken),
    credentials: "include"
  });
  if (response.status === 429) {
    if (retryCount > 0) {
      const waitTime = (3 - retryCount) * 3e4;
      await new Promise((r) => setTimeout(r, waitTime));
      return fetchSinglePin(pinID, config, csrfToken, retryCount - 1);
    }
    throw { status: 429, message: "Rate limited after retries" };
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  return json?.resource_response?.data ?? null;
}
async function fetchBulkPins(pinIDs, config, csrfToken) {
  const results = /* @__PURE__ */ new Map();
  const CHUNK_SIZE = 25;
  for (let i = 0; i < pinIDs.length; i += CHUNK_SIZE) {
    const chunk = pinIDs.slice(i, i + CHUNK_SIZE);
    try {
      const options = { pin_ids: chunk, field_set_key: "detailed" };
      const params = new URLSearchParams({
        source_url: config.path || "/",
        data: JSON.stringify({ options, context: {} }),
        _: Date.now().toString()
      });
      const response = await fetch(`${config.origin}/resource/PinsResource/get/?${params}`, {
        method: "GET",
        headers: buildHeaders(config, csrfToken),
        credentials: "include"
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
      console.warn("PinTwist: Bulk endpoint failed, using parallel fetch");
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
  try {
    const urlPath = new URL(url).pathname;
    const ext = urlPath.split(".").pop()?.split("?")[0] || "jpg";
    const cleanFilename = filename.replace(/\.[^.]+$/, "") + "." + ext;
    await chrome.downloads.download({ url, filename: cleanFilename, saveAs: false, conflictAction: "uniquify" });
  } catch (error) {
    console.error("PinTwist: Download failed:", error);
    try {
      await chrome.tabs.create({ url, active: false });
    } catch {
    }
  }
}
