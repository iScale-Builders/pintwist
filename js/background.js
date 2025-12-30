"use strict";
// ===== PINTWIST 1.5.3 - BACKGROUND SCRIPT =====
// Bulk API | High Performance | Production Ready
// Set default state to ON when installed
chrome.runtime.onInstalled.addListener(() => {
    // User preferences go to sync (persists across devices)
    chrome.storage.sync.set({
        pintwist_enabled: true, // Default to ON
        pintwist_show_overlays: true, // Default: show overlays
        pintwist_show_badges: true, // Default: show badges
        pintwist_theme_color: '#F48FB1', // Default: pink
    });
    // Session/cache data stays in local
    chrome.storage.local.set({
        sortOption: 'saves',
    });
    console.log('PinTwist 1.5.3: Installed - Bar enabled by default');
});
// ===== BUILD HEADERS =====
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
    if (csrfToken)
        headers['x-csrftoken'] = csrfToken;
    return headers;
}
// ===== SINGLE PIN FETCH =====
async function fetchSinglePin(pinID, config, csrfToken, retryCount = 2) {
    const options = {
        id: pinID,
        field_set_key: 'detailed',
        fetch_visual_search_objects: true,
    };
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
    // Rate limit handling with retry
    if (response.status === 429) {
        if (retryCount > 0) {
            const waitTime = (3 - retryCount) * 30000; // 30s, then 60s
            console.log(`PinTwist: Rate limited, waiting ${waitTime / 1000}s before retry...`);
            await new Promise((r) => setTimeout(r, waitTime));
            return fetchSinglePin(pinID, config, csrfToken, retryCount - 1);
        }
        throw { status: 429, message: 'Rate limited after retries' };
    }
    if (!response.ok)
        throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return json?.resource_response?.data ?? null;
}
// ===== BULK PIN FETCH (PRIMARY - FAST) =====
async function fetchBulkPins(pinIDs, config, csrfToken) {
    const results = new Map();
    const CHUNK_SIZE = 25;
    // Split into chunks
    for (let i = 0; i < pinIDs.length; i += CHUNK_SIZE) {
        const chunk = pinIDs.slice(i, i + CHUNK_SIZE);
        try {
            // Try bulk endpoint first
            const options = {
                pin_ids: chunk,
                field_set_key: 'detailed',
            };
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
                        if (pin?.id)
                            results.set(pin.id, pin);
                    });
                    continue;
                }
            }
        }
        catch {
            console.warn('PinTwist: Bulk endpoint failed, using parallel fetch');
        }
        // Fallback: Parallel individual fetches (still fast)
        const fetchPromises = chunk.map(async (pinID) => {
            try {
                const data = await fetchSinglePin(pinID, config, csrfToken);
                return { pinID, data, success: true };
            }
            catch {
                return { pinID, data: null, success: false };
            }
        });
        const fetchResults = await Promise.all(fetchPromises);
        fetchResults.forEach((r) => {
            if (r.success && r.data)
                results.set(r.pinID, r.data);
        });
    }
    return results;
}
// ===== MESSAGE HANDLER =====
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    // Single pin fetch
    if (request.action === 'fetchPinData') {
        fetchSinglePin(request.pinID, request.config, request.csrfToken)
            .then((data) => sendResponse({ success: true, data, pinID: request.pinID }))
            .catch((err) => sendResponse({
            success: false,
            error: err.message,
            status: err.status,
            pinID: request.pinID,
        }));
        return true;
    }
    // Bulk pin fetch (optimized)
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
    // Image download with correct extension
    if (request.action === 'downloadImage') {
        handleDownload(request.url, request.filename);
        sendResponse({ success: true });
        return true;
    }
    return true;
});
// ===== DOWNLOAD HANDLER =====
async function handleDownload(url, filename) {
    try {
        // Extract correct extension from URL
        const urlPath = new URL(url).pathname;
        const ext = urlPath.split('.').pop()?.split('?')[0] || 'jpg';
        const cleanFilename = filename.replace(/\.[^.]+$/, '') + '.' + ext;
        await chrome.downloads.download({
            url,
            filename: cleanFilename,
            saveAs: false,
            conflictAction: 'uniquify',
        });
    }
    catch (error) {
        console.error('PinTwist: Download failed:', error);
        // Fallback: open in new tab
        try {
            await chrome.tabs.create({ url, active: false });
        }
        catch (e) {
            console.error('PinTwist: Fallback failed:', e);
        }
    }
}
//# sourceMappingURL=background.js.map