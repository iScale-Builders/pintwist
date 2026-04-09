// ===== PINTWIST 1.5.3 - PERFORMANCE OPTIMIZED =====
// 35 Concurrent Requests | 40ms Delays | 2x Retry Safety | Maximum Speed
// Safe & Fast: 50-75% faster while avoiding rate limits
// ===== CONSTANTS =====
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
// ===== PINTEREST CONFIG (Cached) =====
const CONFIG = {
    appVersion: null,
    experimentHash: null,
    handlerId: null,
    origin: 'https://www.pinterest.com',
    path: '/',
    initialized: false
};
// ===== STATE =====
const State = {
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
    filterRanges: null, // ADDED: Original min/max from scan
    activeFilters: null // ADDED: User-modified filters
};

// ===== PINTEREST LAYOUT DETECTION =====

// Detect Pinterest's header height dynamically
function getPinterestHeaderHeight() {
    const headerSelectors = [
        '[data-test-id="header"]',
        '[data-test-id="header-container"]',
        'header',
        '[role="banner"]',
    ];

    for (const selector of headerSelectors) {
        const header = document.querySelector(selector);
        if (header) {
            const rect = header.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.height;
            }
        }
    }
    return 56; // Fallback default
}

// Detect Pinterest's left sidebar width dynamically
function getPinterestSidebarWidth() {
    const sidebarSelectors = [
        '[data-test-id="left-nav-container"]',
        'nav[aria-label]',
        'div[data-test-id="sidenav"]',
    ];

    for (const selector of sidebarSelectors) {
        const sidebar = document.querySelector(selector);
        if (sidebar) {
            const rect = sidebar.getBoundingClientRect();
            if (rect.width > 0 && rect.width < 120) {
                return rect.width;
            }
        }
    }
    return 60; // Fallback default (Pinterest's sidebar is ~60px)
}

// ===== CONTENT OFFSET FOR PIN PUSH-DOWN =====
const PINTWIST_BAR_HEIGHT = 70; // Bar height for content offset

// Apply margin-top to Pinterest's content to make room for PinTwist bar
function applyContentOffset() {
    const contentContainer = document.querySelector('[data-test-id="masonry-container"]')
        ?.closest('div')
        || document.querySelector('body > div:first-child');

    if (contentContainer && contentContainer.id !== 'pintwist-initial-bar') {
        contentContainer.style.marginTop = `${PINTWIST_BAR_HEIGHT}px`;
    }
}

// Remove the content offset when bar is hidden
function removeContentOffset() {
    const contentContainer = document.querySelector('[data-test-id="masonry-container"]')
        ?.closest('div')
        || document.querySelector('body > div:first-child');

    if (contentContainer && contentContainer.id !== 'pintwist-initial-bar') {
        contentContainer.style.marginTop = '';
    }
}

// ===== SOFT PINK ICONS =====
const ICONS = {
    heart: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    reaction: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.536-4.464a.75.75 0 10-1.061-1.061 3.5 3.5 0 01-4.95 0 .75.75 0 00-1.06 1.06 5 5 0 007.07 0zM9 8.5c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S7.448 7 8 7s1 .672 1 1.5zm3 1.5c.552 0 1-.672 1-1.5S12.552 7 12 7s-1 .672-1 1.5.448 1.5 1 1.5z" clip-rule="evenodd"/></svg>',
    share: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>',
    repin: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18 9v4H6V9H4v6h6v5l6-5h4V9h-2z"/><path d="M6 15v-4h12v4h2V9h-6l-6 5v1H6z"/></svg>',
    comment: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/></svg>',
    calendar: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z"/></svg>',
    download: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2v9.67z"/></svg>'
};
// ===== METRIC MAP =====
const METRIC_MAP = {
    saves: 'saves',
    share: 'shares',
    reaction: 'reactions',
    repin: 'repins',
    comment: 'comments'
};
// ===== UTILITY FUNCTIONS =====
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Escape HTML attribute values to prevent XSS
function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatNumber(num) {
    if (num >= 1000000) {
        const v = (num / 1000000).toFixed(1);
        return (v.endsWith('.0') ? v.slice(0, -2) : v) + 'M';
    }
    if (num >= 1000) {
        const v = (num / 1000).toFixed(1);
        return (v.endsWith('.0') ? v.slice(0, -2) : v) + 'K';
    }
    return num.toString();
}
function formatDate(dateStr) {
    try {
        return new Date(dateStr).toLocaleDateString('en-US', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });
    } catch { return 'Unknown'; }
}
function getDaysAgo(dateStr) {
    try {
        const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
        if (days === 0) return 'TODAY';
        if (days === 1) return 'YESTERDAY';
        if (days < 7) return `${days}D`;
        if (days < 30) return `${Math.floor(days / 7)}W`;
        if (days < 365) return `${Math.floor(days / 30)}MO`;
        return `${Math.floor(days / 365)}Y`;
    } catch { return 'UNKNOWN'; }
}
// ===== CONFIG EXTRACTION =====
function extractConfig() {
    if (CONFIG.initialized) return CONFIG;
    try {
        const script = document.querySelector('#__PWS_DATA__');
        if (script) {
            const data = JSON.parse(script.textContent || '{}');
            CONFIG.appVersion = data.appVersion || 'c7cbc61';
            CONFIG.experimentHash = data.context?.experiment_hash || '';
            CONFIG.handlerId = data.initialHandlerId || 'www/index.js';
            CONFIG.path = data.context?.path || '/';
            CONFIG.origin = data.context?.origin || 'https://www.pinterest.com';
        }
    } catch (e) {
        CONFIG.appVersion = 'c7cbc61';
        CONFIG.experimentHash = '';
        CONFIG.handlerId = 'www/index.js';
    }
    CONFIG.initialized = true;
    return CONFIG;
}
function getFreshConfig() {
    if (!CONFIG.initialized) extractConfig();
    return {
        appVersion: CONFIG.appVersion,
        experimentHash: CONFIG.experimentHash,
        handlerId: CONFIG.handlerId,
        path: window.location.pathname || CONFIG.path,
        origin: window.location.origin || CONFIG.origin
    };
}
function getCsrfToken() {
    const match = document.cookie.match(/csrftoken=([^;]+)/);
    return match ? match[1] : null;
}
// ===== CACHE MANAGEMENT =====
async function saveCache() {
    try {
        if (!chrome?.storage?.local) return;
        const MAX_SIZE = 2000;
        if (State.metricsCache.size > MAX_SIZE) {
            const entries = [...State.metricsCache.entries()];
            entries.slice(0, entries.length - MAX_SIZE).forEach(([k]) => State.metricsCache.delete(k));
        }
        await chrome.storage.local.set({
            pintwist_cache: Object.fromEntries(State.metricsCache)
        });
    } catch (e) {
        console.warn('PinTwist: Cache save failed', e);
    }
}
async function loadCache() {
    try {
        const { pintwist_cache } = await chrome.storage.local.get('pintwist_cache');
        if (pintwist_cache) {
            State.metricsCache = new Map(Object.entries(pintwist_cache));
            console.log(`PinTwist: Loaded ${State.metricsCache.size} cached pins`);
        }
    } catch (e) {
        console.warn('PinTwist: Cache load failed', e);
    }
}
function getCached(pinID) {
    const cached = State.metricsCache.get(pinID);
    if (cached && typeof cached.timestamp === 'number' && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached;
    }
    if (cached) State.metricsCache.delete(pinID);
    return null;
}
function setCache(pinID, metrics) {
    metrics.timestamp = Date.now();
    State.metricsCache.set(pinID, metrics);
    State.loadedIDs.add(pinID);
    if (State.metricsCache.size % 20 === 0) saveCache();
}
// ===== BULK DATA FETCHING (OPTIMIZED) =====
async function fetchBulk(pinIDs) {
    if (!pinIDs.length) return new Map();
    const results = new Map();
    // Get cached first (instant)
    const uncached = [];
    pinIDs.forEach(id => {
        const cached = getCached(id);
        if (cached) {
            results.set(id, cached);
        } else {
            uncached.push(id);
        }
    });
    if (!uncached.length) return results;
    // Fetch uncached pins
    // Process in chunks with controlled concurrency and retry logic
    const CHUNK_SIZE = 35;  // Optimized: 75% faster than 20, still conservative
    const CHUNK_DELAY = 40; // 40ms delay between chunks for rate limit safety
    const MAX_RETRIES = 2;  // Retry failed requests (network issues, rare rate limits)
    
    for (let i = 0; i < uncached.length; i += CHUNK_SIZE) {
        const chunk = uncached.slice(i, i + CHUNK_SIZE);
        const promises = chunk.map(async (pinID) => {
            // Retry wrapper for reliability
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const response = await chrome.runtime.sendMessage({
                        action: 'fetchPinData',
                        pinID,
                        config: getFreshConfig(),
                        csrfToken: getCsrfToken()
                    });
                    if (response?.success && response.data) {
                        const metrics = extractMetrics(response.data, pinID);
                        setCache(pinID, metrics);
                        return { pinID, metrics };
                    }
                } catch (e) {
                    // Retry on failure (unless last attempt)
                    if (attempt < MAX_RETRIES) {
                        await sleep(1000); // Wait 1s before retry
                        continue;
                    }
                    // Silently fail after all retries
                }
                break; // Exit retry loop if successful or response not valid
            }
            return null;
        });
        const chunkResults = await Promise.all(promises);
        chunkResults.forEach(r => {
            if (r) results.set(r.pinID, r.metrics);
        });
        
        // Small delay between chunks for rate limit safety
        if (i + CHUNK_SIZE < uncached.length) {
            await sleep(CHUNK_DELAY);
        }
    }
    return results;
}
async function fetchSingle(pinID) {
    const cached = getCached(pinID);
    if (cached) return cached;
    // Dedupe in-flight
    if (State.inFlightRequests.has(pinID)) {
        return State.inFlightRequests.get(pinID);
    }
    const promise = (async () => {
        const MAX_RETRIES = 2;
        
        try {
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const response = await chrome.runtime.sendMessage({
                        action: 'fetchPinData',
                        pinID,
                        config: getFreshConfig(),
                        csrfToken: getCsrfToken()
                    });
                    if (response?.success && response.data) {
                        const metrics = extractMetrics(response.data, pinID);
                        setCache(pinID, metrics);
                        return metrics;
                    }
                } catch (e) {
                    if (attempt < MAX_RETRIES) {
                        await sleep(1000); // Wait 1s before retry
                        continue;
                    }
                    console.error(`PinTwist: Fetch failed for ${pinID} after ${MAX_RETRIES + 1} attempts`, e);
                }
            }
            return null;
        } finally {
            // Always cleanup in-flight tracking, whether success or failure
            State.inFlightRequests.delete(pinID);
        }
    })();
    State.inFlightRequests.set(pinID, promise);
    return promise;
}
function extractMetrics(data, pinID) {
    if (!data) return { pinID, saves: 0, reactions: 0, shares: 0, repins: 0, comments: 0, createdAt: null, imageUrl: null, isVideo: false, fetchFailed: true };
    const isVideo = !!(data?.videos || data?.story_pin_data?.pages?.[0]?.blocks?.[0]?.video || data?.is_video);
    
    // Get image URL - try many different locations
    let imageUrl = null;
    
    // Standard image locations
    if (data?.images) {
        imageUrl = data.images.orig?.url || data.images['1200x']?.url || data.images['736x']?.url || 
                   data.images['564x']?.url || data.images['474x']?.url || data.images['236x']?.url ||
                   Object.values(data.images).find(img => img?.url)?.url;
    }
    
    // Video thumbnails
    if (!imageUrl && data?.videos?.video_list) {
        const videoList = data.videos.video_list;
        for (const key of Object.keys(videoList)) {
            if (videoList[key]?.thumbnail) {
                imageUrl = videoList[key].thumbnail;
                break;
            }
        }
    }
    
    // Story pin data
    if (!imageUrl && data?.story_pin_data?.pages) {
        for (const page of data.story_pin_data.pages) {
            if (page?.image?.images) {
                const imgs = page.image.images;
                imageUrl = imgs.orig?.url || imgs['1200x']?.url || Object.values(imgs).find(i => i?.url)?.url;
                if (imageUrl) break;
            }
            if (page?.blocks) {
                for (const block of page.blocks) {
                    if (block?.image?.images) {
                        const imgs = block.image.images;
                        imageUrl = imgs.orig?.url || Object.values(imgs).find(i => i?.url)?.url;
                        if (imageUrl) break;
                    }
                    if (block?.video?.video_list) {
                        for (const v of Object.values(block.video.video_list)) {
                            if (v?.thumbnail) { imageUrl = v.thumbnail; break; }
                        }
                    }
                }
            }
            if (imageUrl) break;
        }
    }
    
    // Carousel items
    if (!imageUrl && data?.carousel_data?.carousel_slots) {
        for (const slot of data.carousel_data.carousel_slots) {
            if (slot?.images) {
                imageUrl = slot.images.orig?.url || Object.values(slot.images).find(i => i?.url)?.url;
                if (imageUrl) break;
            }
        }
    }
    
    // Closeup image
    if (!imageUrl && data?.closeup_unified_description?.images) {
        const imgs = data.closeup_unified_description.images;
        imageUrl = imgs.orig?.url || Object.values(imgs).find(i => i?.url)?.url;
    }
    
    // Pin image signature fallback - construct URL
    if (!imageUrl && data?.image_signature) {
        imageUrl = `https://i.pinimg.com/originals/${data.image_signature.slice(0,2)}/${data.image_signature.slice(2,4)}/${data.image_signature.slice(4,6)}/${data.image_signature}.jpg`;
    }
    
    // Direct image_url field
    if (!imageUrl) {
        imageUrl = data?.image_url || data?.imageUrl || data?.image_medium_url;
    }
    
    return {
        pinID,
        saves: data?.aggregated_pin_data?.aggregated_stats?.saves || 0,
        reactions: data?.reaction_counts?.[1] || 0,
        shares: data?.share_count || 0,
        repins: data?.repin_count || 0,
        comments: data?.aggregated_pin_data?.comment_count || 0,
        createdAt: data?.created_at || null,
        imageUrl: imageUrl,
        isVideo: isVideo,
        fetchFailed: false
    };
}
// ===== OVERLAY CREATION =====
function createOverlayHTML(metrics) {
    const dateStr = metrics.createdAt ? formatDate(metrics.createdAt) : 'Unknown';
    const daysAgo = metrics.createdAt ? getDaysAgo(metrics.createdAt) : '';
    const safeUrl = metrics.imageUrl?.startsWith('https://') ? metrics.imageUrl : '';
    return `
        <div class="pintwist-metrics-overlay" data-pintwist="overlay">
            <div class="pintwist-metrics-column">
                <div class="pintwist-metric-item" title="Saves">
                    <div class="pintwist-metric-icon">${ICONS.heart}</div>
                    <span class="pintwist-metric-value">${formatNumber(metrics.saves)}</span>
                </div>
                <div class="pintwist-metric-item" title="Reactions">
                    <div class="pintwist-metric-icon">${ICONS.reaction}</div>
                    <span class="pintwist-metric-value">${formatNumber(metrics.reactions)}</span>
                </div>
                <div class="pintwist-metric-item" title="Shares">
                    <div class="pintwist-metric-icon">${ICONS.share}</div>
                    <span class="pintwist-metric-value">${formatNumber(metrics.shares)}</span>
                </div>
                <div class="pintwist-metric-item" title="Repins">
                    <div class="pintwist-metric-icon">${ICONS.repin}</div>
                    <span class="pintwist-metric-value">${formatNumber(metrics.repins)}</span>
                </div>
                <div class="pintwist-metric-item" title="Comments">
                    <div class="pintwist-metric-icon">${ICONS.comment}</div>
                    <span class="pintwist-metric-value">${formatNumber(metrics.comments)}</span>
                </div>
                <div class="pintwist-metric-item" title="${escapeAttr(dateStr)}">
                    <div class="pintwist-metric-icon">${ICONS.calendar}</div>
                    <span class="pintwist-metric-value">${daysAgo}</span>
                </div>
            </div>
            <button class="pintwist-download-btn" data-pin-id="${escapeAttr(metrics.pinID)}" data-image-url="${escapeAttr(safeUrl)}">
                <span class="pintwist-download-icon">${ICONS.download}</span>
                <span class="pintwist-download-text">Download</span>
                <span class="pintwist-download-loader" style="display:none;">⏳</span>
            </button>
        </div>
    `;
}
function createLoadingHTML() {
    return `
        <div class="pintwist-metrics-overlay pintwist-loading-state" data-pintwist="placeholder">
            <div class="pintwist-metrics-column">
                ${[...Array(6)].map(() => `
                    <div class="pintwist-metric-item pintwist-skeleton">
                        <div class="pintwist-metric-icon pintwist-skeleton-icon"></div>
                        <span class="pintwist-metric-value pintwist-skeleton-text"></span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}
// ===== DOWNLOAD =====
function downloadImage(pinID, imageUrl, button) {
    if (!imageUrl) return;
    const text = button.querySelector('.pintwist-download-text');
    const loader = button.querySelector('.pintwist-download-loader');
    const icon = button.querySelector('.pintwist-download-icon');
    if (text) text.style.display = 'none';
    if (icon) icon.style.display = 'none';
    if (loader) loader.style.display = 'inline';
    button.disabled = true;
    chrome.runtime.sendMessage({
        action: 'downloadImage',
        url: imageUrl,
        filename: `pinterest_${pinID}_${Date.now()}`
    }, () => {
        setTimeout(() => {
            if (text) text.style.display = 'inline';
            if (icon) icon.style.display = 'inline';
            if (loader) loader.style.display = 'none';
            button.disabled = false;
        }, 1500);
    });
}
// ===== BULK PIN PROCESSING =====
async function processPinsBulk(elements) {
    const toFetch = [];
    elements.forEach(el => {
        if (el.querySelector('[data-pintwist="overlay"]')) return;
        const pinID = el.getAttribute('data-test-pin-id');
        if (!pinID || State.processingIDs.has(pinID)) return;
        State.processingIDs.add(pinID);
        el.insertAdjacentHTML('beforeend', createLoadingHTML());
        toFetch.push({ pinID, element: el });
    });
    if (!toFetch.length) return;
    const results = await fetchBulk(toFetch.map(p => p.pinID));
    toFetch.forEach(({ pinID, element }) => {
        const placeholder = element.querySelector('[data-pintwist="placeholder"]');
        if (placeholder) placeholder.remove();
        const metrics = results.get(pinID);
        if (metrics) {
            element.insertAdjacentHTML('beforeend', createOverlayHTML(metrics));
            const btn = element.querySelector('.pintwist-download-btn');
            if (btn) {
                btn.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    downloadImage(pinID, btn.dataset.imageUrl, btn);
                });
            }
        }
        State.processingIDs.delete(pinID);
    });
}
// ===== MUTATION OBSERVER =====
function initObserver() {
    if (State.observer) State.observer.disconnect();
    let pending = [];
    let debounce = null;
    State.observer = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType !== 1) return;
                if (node.hasAttribute?.('data-test-pin-id')) pending.push(node);
                if (node.querySelectorAll) pending.push(...node.querySelectorAll('[data-test-pin-id]'));
            });
        });
        if (pending.length) {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
                const unique = [...new Set(pending)];
                pending = [];
                if (unique.length) {
                    processPinsBulk(unique);
                }
            }, 100);
        }
    });
    const container = document.querySelector('[data-test-id="masonry-container"]');
    if (container) {
        State.observer.observe(container, { childList: true, subtree: true });
    } else {
        setTimeout(initObserver, 2000);
    }
}
function processExisting() {
    const pins = document.querySelectorAll('[data-test-pin-id]');
    console.log(`PinTwist: Found ${pins.length} existing pins to process`);
    processPinsBulk(Array.from(pins));
    
    // Retry after a delay to catch any pins that loaded late
    setTimeout(() => {
        const newPins = document.querySelectorAll('[data-test-pin-id]');
        console.log(`PinTwist: Retry found ${newPins.length} total pins`);
        processPinsBulk(Array.from(newPins));
    }, 2000);
}
// ===== SMART SCROLL DETECTION =====
async function waitForNewPins(prevCount) {
    // Simple, consistent approach: wait in intervals, check for new pins
    const MAX_WAIT = 5000;
    const CHECK_INTERVAL = 250;
    const STABLE_TIME = 400;
    let lastCount = prevCount;
    let stableFor = 0;
    let elapsed = 0;
    while (elapsed < MAX_WAIT) {
        await sleep(CHECK_INTERVAL);
        elapsed += CHECK_INTERVAL;
        const current = document.querySelectorAll('[data-test-pin-id]').length;
        if (current > prevCount) {
            // Got new pins - wait for count to stabilize
            if (current === lastCount) {
                stableFor += CHECK_INTERVAL;
                if (stableFor >= STABLE_TIME) {
                    return true;
                }
            } else {
                stableFor = 0;
                lastCount = current;
            }
        }
    }
    // Check one final time
    const finalCount = document.querySelectorAll('[data-test-pin-id]').length;
    if (finalCount > prevCount) {
        return true;
    }
    return false;
}
// ===== SORT PANEL =====
window.sort_all = async function() {
    // Remove any existing bars
    document.getElementById('sort-panel')?.remove();
    document.getElementById('pintwist-initial-bar')?.remove();
    document.getElementById('pintwist-sorted-container')?.remove();

    State.aborted = false;

    // Load saved theme color BEFORE building the bar
    const themeColor = await new Promise((resolve) => {
        chrome.storage.sync.get(['pintwist_theme_color'], (result) => {
            resolve(result.pintwist_theme_color || '#F48FB1');
        });
    });

    // Create initial bar (BEFORE state)
    const initialBar = document.createElement('div');
    initialBar.id = 'pintwist-initial-bar';
    
    // Get Pinterest layout dimensions to position bar as centered floating pill
    const pinterestHeaderHeight = getPinterestHeaderHeight();
    const sidebarWidth = getPinterestSidebarWidth();
    const isTrendsPage = window.location.hostname.includes('trends.pinterest');

    // Different positioning for trends page vs main Pinterest
    let leftPos, rightPos;
    const pillPadding = 15;
    if (isTrendsPage) {
        // On trends page: left same as main, but shorten right side by 20% to avoid profile icons
        leftPos = pillPadding;
        rightPos = Math.round(window.innerWidth * 0.20); // 20% from right edge
    } else {
        // On main Pinterest: span from sidebar to right edge with padding
        leftPos = sidebarWidth + pillPadding;
        rightPos = pillPadding;
    }

    initialBar.style.cssText = `
        position: fixed !important;
        top: ${isTrendsPage ? 12 : pinterestHeaderHeight}px !important;
        left: ${leftPos}px !important;
        right: ${rightPos}px !important;
        z-index: 999999 !important;
        background: #F8F8F8 !important;
        border: 2px solid ${themeColor} !important;
        border-radius: 50px !important;
        padding: 8px 20px !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        box-sizing: border-box !important;
    `;

    initialBar.innerHTML = `
        <div class="pintwist-logo-container" style="display:flex; align-items:center; height:36px; margin:0;">
            <svg class="pintwist-logo-wordmark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0.00 0.00 2959.00 1062.00" style="height:28px; width:auto;">
                <path class="pintwist-themed-fill" style="fill:${themeColor}" d="M 606.29 202.72 A 0.15 0.15 0.0 0 0 606.08 202.86 L 606.08 337.13 A 2.37 2.36 82.7 0 1 604.31 339.42 C 597.59 341.17 590.21 344.19 585.28 345.89 Q 550.45 357.90 534.16 363.39 C 531.76 364.20 528.93 364.83 526.66 365.62 C 502.56 373.99 480.54 381.20 457.22 387.24 A 0.90 0.90 0.0 0 1 456.10 386.37 L 456.10 202.21 A 0.39 0.39 0.0 0 0 455.55 201.86 Q 428.32 214.10 404.51 226.28 Q 381.59 238.00 362.56 252.79 Q 349.75 262.74 341.35 275.06 C 335.39 283.81 333.91 294.26 337.79 304.37 C 340.67 311.86 345.33 317.43 351.32 323.78 Q 354.83 327.50 359.07 330.83 Q 374.56 342.98 385.53 348.96 Q 399.02 356.33 411.69 362.73 A 0.90 0.88 13.8 0 1 412.18 363.52 L 412.18 400.80 A 0.68 0.67 -8.9 0 1 411.71 401.44 C 385.32 409.94 360.46 417.94 333.83 428.08 Q 318.97 433.74 308.47 438.74 Q 306.99 439.45 303.79 439.83 A 1.51 1.47 60.6 0 1 302.66 439.50 C 281.45 422.03 262.57 403.40 248.91 380.41 Q 244.72 373.36 237.42 358.09 Q 224.53 331.16 223.64 301.27 C 223.11 283.05 224.31 265.60 229.47 247.93 Q 238.65 216.44 259.18 190.17 Q 266.52 180.79 275.22 171.47 C 276.57 170.03 277.68 168.13 279.11 166.68 Q 288.38 157.34 291.27 154.76 C 342.93 108.53 408.95 81.53 477.50 72.54 C 551.50 62.83 627.95 73.09 695.49 104.97 C 729.22 120.89 760.01 142.12 785.54 169.46 Q 796.65 181.36 804.51 191.49 C 816.01 206.34 823.65 222.35 831.50 242.25 A 5.32 5.18 33.8 0 1 831.85 243.90 Q 831.92 245.43 832.36 246.90 Q 837.11 262.83 838.34 279.74 Q 838.63 283.76 838.38 302.75 C 838.20 316.59 835.05 333.03 830.07 346.72 Q 816.87 382.98 789.98 411.76 C 777.03 425.63 761.48 439.16 745.21 450.41 C 715.59 470.89 682.67 487.22 649.86 501.59 Q 642.45 504.83 618.91 513.76 C 582.78 527.46 546.46 538.67 507.22 550.33 Q 486.59 556.46 474.77 560.40 Q 453.34 567.56 442.46 570.87 C 429.43 574.84 417.83 579.16 405.79 582.94 C 389.80 587.97 369.14 596.21 357.28 600.82 Q 340.76 607.25 323.06 616.32 C 298.86 628.72 277.28 643.69 261.53 665.02 Q 255.85 672.72 252.65 683.15 A 0.40 0.39 8.6 0 0 253.03 683.66 L 411.62 683.66 A 0.54 0.54 0.0 0 1 412.16 684.20 L 412.16 793.47 A 0.69 0.69 0.0 0 1 411.47 794.16 Q 342.30 794.11 180.00 794.14 Q 176.29 794.14 165.85 792.16 Q 154.23 789.96 144.41 783.63 C 132.32 775.84 123.98 761.05 121.17 747.29 Q 119.16 737.44 119.19 726.75 Q 119.23 707.75 122.76 689.08 Q 126.49 669.40 132.14 652.40 C 139.38 630.63 150.21 609.88 164.70 590.51 C 187.34 560.24 216.78 534.88 249.87 515.64 Q 290.68 491.91 335.87 474.34 Q 379.50 457.38 419.53 445.47 Q 448.26 436.92 450.77 436.12 Q 466.38 431.10 481.96 426.70 C 499.87 421.64 514.36 416.62 532.04 411.22 C 545.65 407.07 558.69 402.09 575.03 396.23 Q 581.61 393.88 592.01 389.66 Q 621.02 377.90 648.06 364.68 Q 648.54 364.44 649.10 363.95 Q 649.67 363.45 650.13 363.21 Q 657.72 359.17 668.73 353.30 Q 680.18 347.19 686.88 342.62 C 698.34 334.82 708.14 327.39 716.58 316.77 Q 722.14 309.76 724.21 303.04 C 727.98 290.74 724.40 280.56 716.31 270.50 Q 710.33 263.07 704.20 257.80 Q 687.44 243.38 664.86 231.14 Q 635.68 215.34 606.29 202.72 Z"/>
                <path class="pintwist-themed-fill" style="fill:${themeColor}" d="M 1658.87 345.16 L 1658.87 473.12 A 0.53 0.53 0.0 0 1 1658.34 473.65 L 1512.26 473.65 A 0.53 0.53 0.0 0 0 1511.73 474.18 L 1511.73 994.04 A 0.53 0.53 0.0 0 1 1511.20 994.57 L 1364.40 994.57 A 0.53 0.53 0.0 0 1 1363.87 994.04 L 1363.87 474.18 A 0.53 0.53 0.0 0 0 1363.34 473.65 L 1222.06 473.65 A 0.53 0.53 0.0 0 1 1221.53 473.12 L 1221.53 345.16 A 0.53 0.53 0.0 0 1 1222.06 344.63 L 1658.34 344.63 A 0.53 0.53 0.0 0 1 1658.87 345.16 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${themeColor}" x="2053.71" y="387.10" width="126.24" height="87.08" rx="0.34"/>
                <path class="pintwist-themed-fill" style="fill:${themeColor}" d="M 2596.95 414.06 L 2723.06 414.06 A 0.61 0.60 90.0 0 1 2723.66 414.67 L 2723.66 548.78 A 0.81 0.81 0.0 0 0 2724.47 549.59 L 2786.21 549.59 A 0.63 0.63 0.0 0 1 2786.84 550.22 L 2786.84 631.63 A 0.43 0.43 0.0 0 1 2786.41 632.06 L 2724.13 632.04 A 0.50 0.49 86.4 0 0 2723.64 632.60 Q 2723.67 632.78 2723.66 861.00 Q 2723.66 869.04 2726.02 876.20 C 2732.10 894.62 2751.39 898.17 2768.26 897.50 Q 2782.37 896.93 2796.22 894.56 A 0.50 0.50 0.0 0 1 2796.81 895.05 L 2796.81 992.57 A 0.60 0.59 86.1 0 1 2796.30 993.16 Q 2752.82 999.93 2711.01 999.11 C 2691.78 998.73 2670.45 995.62 2652.10 988.22 C 2601.22 967.68 2596.61 915.65 2596.61 868.83 Q 2596.63 634.84 2596.63 632.47 A 0.42 0.42 0.0 0 0 2596.21 632.05 L 2553.85 632.05 A 0.37 0.37 0.0 0 1 2553.48 631.68 L 2553.48 550.21 A 0.62 0.62 0.0 0 1 2554.10 549.59 L 2596.14 549.59 A 0.49 0.49 0.0 0 0 2596.63 549.10 L 2596.63 414.39 A 0.33 0.32 -90.0 0 1 2596.95 414.06 Z"/>
                <path class="pintwist-themed-fill" style="fill:${themeColor}" d="M 904.40 549.44 L 1028.50 549.44 A 0.62 0.62 0.0 0 1 1029.12 550.06 L 1029.12 593.36 A 0.33 0.32 -22.9 0 0 1029.68 593.58 C 1060.01 563.04 1099.78 538.48 1144.44 542.17 C 1190.73 546.00 1213.10 584.85 1217.56 627.14 Q 1218.51 636.20 1218.43 653.40 Q 1218.38 666.38 1218.41 994.20 A 0.37 0.37 0.0 0 1 1218.04 994.57 L 1094.24 994.57 A 0.47 0.46 0.0 0 1 1093.77 994.11 Q 1093.78 732.02 1093.77 663.00 C 1093.77 654.62 1092.70 644.52 1087.19 637.64 C 1080.45 629.24 1066.39 629.27 1056.76 632.53 Q 1042.19 637.45 1029.38 646.57 A 0.61 0.60 72.9 0 0 1029.12 647.07 L 1029.12 994.25 A 0.32 0.31 90.0 0 1 1028.81 994.57 L 904.10 994.57 A 0.43 0.42 -0.0 0 1 903.67 994.15 L 903.67 550.17 A 0.73 0.73 0.0 0 1 904.40 549.44 Z"/>
                <path class="pintwist-themed-fill" style="fill:${themeColor}" d="M 2443.38 693.49 A 0.39 0.38 -21.0 0 1 2442.85 693.26 C 2434.62 667.73 2411.94 626.87 2380.16 629.85 C 2369.39 630.86 2360.75 636.59 2357.91 647.44 C 2354.22 661.58 2362.47 674.29 2371.69 684.59 C 2383.49 697.76 2397.51 709.73 2410.73 720.37 C 2427.37 733.75 2442.76 748.12 2459.63 762.54 C 2491.45 789.73 2524.43 822.35 2529.83 866.27 Q 2533.10 892.83 2525.72 917.25 C 2511.54 964.15 2469.10 992.49 2422.47 1000.06 Q 2399.65 1003.76 2373.19 1001.45 Q 2349.94 999.43 2330.46 992.81 C 2298.37 981.91 2273.16 960.38 2254.95 932.04 Q 2242.63 912.87 2233.87 890.94 A 0.41 0.41 0.0 0 1 2234.08 890.42 L 2318.71 853.03 A 0.60 0.59 67.1 0 1 2319.51 853.36 C 2331.61 884.06 2356.36 925.48 2396.36 916.15 C 2412.23 912.45 2416.06 899.23 2412.66 884.47 Q 2410.31 874.30 2402.76 865.24 C 2393.26 853.85 2382.21 844.32 2371.49 835.26 Q 2367.22 831.64 2319.90 792.10 C 2301.98 777.13 2285.28 761.67 2271.21 743.76 Q 2246.43 712.21 2244.04 674.11 Q 2242.61 651.19 2248.40 631.37 C 2263.29 580.40 2311.63 548.70 2362.55 542.88 Q 2384.79 540.33 2407.91 543.89 Q 2456.33 551.35 2488.19 586.99 C 2505.13 605.94 2517.07 630.98 2523.79 656.13 A 0.63 0.62 -19.8 0 1 2523.44 656.86 L 2443.38 693.49 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${themeColor}" x="700.59" y="549.46" width="125.48" height="445.12" rx="0.53"/>
                <path class="pintwist-themed-fill" style="fill:${themeColor}" d="M 1707.96 800.58 L 1742.35 549.80 A 0.42 0.41 -86.0 0 1 1742.76 549.44 L 1832.96 549.44 A 0.44 0.43 86.2 0 1 1833.39 549.82 L 1863.15 806.36 A 0.17 0.17 0.0 0 0 1863.49 806.36 L 1900.89 549.83 A 0.45 0.45 0.0 0 1 1901.34 549.44 L 1997.68 549.44 A 0.35 0.34 -85.7 0 1 1998.02 549.84 L 1931.93 994.18 A 0.45 0.45 0.0 0 1 1931.48 994.57 L 1824.54 994.57 A 0.68 0.67 -3.9 0 1 1823.87 993.99 L 1785.72 745.83 A 0.17 0.17 0.0 0 0 1785.39 745.83 L 1742.60 994.19 A 0.46 0.45 4.4 0 1 1742.15 994.57 L 1636.58 994.57 A 0.48 0.47 85.8 0 1 1636.11 994.16 L 1570.81 549.99 A 0.48 0.48 0.0 0 1 1571.28 549.44 L 1675.17 549.44 A 0.45 0.44 86.3 0 1 1675.61 549.83 L 1707.71 800.58 A 0.13 0.13 0.0 0 0 1707.96 800.58 Z"/>
                <rect class="pintwist-themed-fill" style="fill:${themeColor}" x="2054.54" y="549.45" width="125.40" height="445.12" rx="0.34"/>
                <path class="pintwist-themed-fill" style="fill:${themeColor}" d="M 605.64 566.15 A 0.34 0.34 0.0 0 1 606.08 566.47 Q 606.12 711.52 606.13 870.68 Q 606.13 879.74 605.00 886.24 C 601.84 904.45 595.88 920.87 587.77 938.55 Q 572.46 971.96 550.09 1004.09 Q 542.48 1015.03 531.96 1029.18 A 0.65 0.64 44.1 0 1 530.93 1029.19 Q 522.29 1018.19 510.59 1001.21 Q 492.78 975.36 479.32 948.62 Q 475.01 940.06 472.55 934.18 C 469.06 925.87 466.38 920.52 464.45 914.45 Q 459.88 900.07 457.31 884.43 Q 456.11 877.16 456.11 867.47 Q 456.07 755.78 456.14 613.91 A 1.20 1.19 80.4 0 1 456.94 612.78 C 468.44 608.78 482.28 604.50 502.57 598.50 Q 518.45 593.80 530.48 589.85 C 541.79 586.14 554.86 582.71 567.73 578.51 Q 587.15 572.16 605.64 566.15 Z"/>
            </svg>
        </div>
        
        <label class="pintwist-sort-label" style="height:36px; display:flex; align-items:center; color:#555; font-weight:600; font-size:13px; margin:0;">Sort by:</label>
        <div class="custom-dropdown" id="pintwist-initial-dropdown-wrapper" style="display:flex; align-items:center; width:auto; min-width:120px; height:36px; margin:0;">
            <button class="custom-dropdown-btn" id="pintwist-initial-dropdown-btn" type="button" style="height:36px; display:flex; align-items:center; padding:0 12px; background:#FFF; border:1.5px solid #DDD; border-radius:6px; font-size:13px; font-weight:600; color:#555; gap:8px; box-sizing:border-box; cursor:pointer; margin:0;">
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
                <div class="dropdown-item" data-value="date">Date</div>
            </div>
        </div>
        <input type="hidden" id="pintwist-initial-sort-option" value="saves">
        
        <label class="pintwist-pages-label" style="height:36px; display:flex; align-items:center; color:#555; font-weight:600; font-size:13px; margin:0;">Pages to load:</label>
        <input type="number" id="pintwist-pages-input" class="pintwist-pages-input" value="4" min="1" max="50" style="height:36px; width:55px; padding:0 10px; background:#FFF; border:1.5px solid #DDD; border-radius:6px; font-size:13px; font-weight:600; color:#555; text-align:center; box-sizing:border-box; margin:0;">
        
        <button id="pintwist-sort-pins-btn" class="pintwist-sort-btn" style="height:36px; display:flex; align-items:center; justify-content:center; padding:0 20px; background:${themeColor}; color:#FFF; border:none; border-radius:6px; font-weight:700; font-size:12px; cursor:pointer; text-transform:uppercase; box-sizing:border-box; margin:0;">SORT PINS</button>
        
        <div class="pintwist-search-wrapper" style="display:flex; align-items:center; height:36px; margin:0;">
            <input type="text" id="pintwist-search-input-initial" placeholder="Search Pinterest..." style="height:36px; padding:0 12px; border:1.5px solid #DDD; border-right:none; border-radius:16px 0 0 16px; font-size:12px; width:140px; background:#FFF; color:#555; box-sizing:border-box; margin:0;">
            <button id="pintwist-search-btn-initial" style="height:36px; padding:0 12px; border:1.5px solid #DDD; border-left:none; border-radius:0 16px 16px 0; background:#F0F0F0; color:#666; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center; box-sizing:border-box; margin:0;">🔍</button>
        </div>
        
        <label class="pintwist-checkbox-wrapper" style="display:flex; align-items:center; height:36px; gap:6px; cursor:pointer; margin:0;">
            <input type="checkbox" id="pintwist-show-overlays" checked style="width:16px; height:16px; accent-color:${themeColor}; margin:0;">
            <span class="pintwist-checkbox-label" style="color:#555; font-size:12px; font-weight:600;">Show Overlays</span>
        </label>
        
        <a href="https://www.youtube.com/@iscalepod" target="_blank" class="pintwist-tutorial-link" style="height:36px; display:flex; align-items:center; padding:0 12px; background:#EFEFEF; color:#777; font-size:11px; font-weight:600; text-decoration:none; border-radius:4px; margin-left:auto; box-sizing:border-box;">Tutorial: youtube.com/@iscalepod</a>
    `;

    document.body.appendChild(initialBar);
    setupInitialBarEvents(initialBar);

    // Push content down to make room for PinTwist bar
    applyContentOffset();
};

// Toggle left-side metrics overlays visibility
function toggleOverlays(show) {
    const overlays = document.querySelectorAll('.pintwist-metrics-overlay');
    overlays.forEach(overlay => {
        overlay.style.display = show ? '' : 'none';
    });
}

// Adjust Pinterest content padding to prevent bar overlap on pin detail pages
function adjustPinterestPadding() {
    const isPinDetailPage = window.location.pathname.includes('/pin/');
    const container = document.querySelector('[data-test-id="masonry-container"]');
    const pinDetail = document.querySelector('[data-test-id="pin-closeup-page"]');
    
    // On pin detail pages, add padding to prevent overlap
    if (isPinDetailPage && (container || pinDetail)) {
        const targetElement = pinDetail || container;
        targetElement.style.paddingTop = '80px';
    } else if (container) {
        // Remove padding on normal pages
        container.style.paddingTop = '';
    }
}

function setupInitialBarEvents(bar) {
    const dropdownBtn = document.getElementById('pintwist-initial-dropdown-btn');
    const dropdownMenu = document.getElementById('pintwist-initial-dropdown-menu');
    const dropdownText = dropdownBtn.querySelector('.dropdown-text');
    const sortInput = document.getElementById('pintwist-initial-sort-option');
    
    // Dropdown functionality
    dropdownBtn.addEventListener('click', e => {
        e.stopPropagation();
        dropdownMenu.classList.toggle('show');
    });
    
    dropdownMenu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', e => {
            sortInput.value = e.target.dataset.value;
            dropdownText.textContent = e.target.textContent;
            dropdownMenu.classList.remove('show');
            chrome.storage.local.set({ sortOption: sortInput.value });
        });
    });
    
    document.addEventListener('click', e => {
        if (!dropdownBtn.contains(e.target)) dropdownMenu.classList.remove('show');
    });
    
    // Pinterest search functionality
    const searchInput = document.getElementById('pintwist-search-input-initial');
    const searchBtn = document.getElementById('pintwist-search-btn-initial');
    
    const performSearch = () => {
        const query = searchInput.value.trim();
        if (query) {
            window.location.href = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
        }
    };
    
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') performSearch();
    });
    
    // Show Overlays checkbox
    const overlayCheckbox = document.getElementById('pintwist-show-overlays');
    
    // Load saved state
    chrome.storage.sync.get(['pintwist_show_overlays'], (result) => {
        const showOverlays = result.pintwist_show_overlays !== false; // Default: true
        overlayCheckbox.checked = showOverlays;
        toggleOverlays(showOverlays);
    });

    overlayCheckbox.addEventListener('change', () => {
        const isChecked = overlayCheckbox.checked;
        chrome.storage.sync.set({ pintwist_show_overlays: isChecked });
        toggleOverlays(isChecked);
    });
    
    // Load saved theme color for initial bar
    chrome.storage.sync.get(['pintwist_theme_color'], (result) => {
        const savedColor = result.pintwist_theme_color || '#F48FB1';
        applyThemeColor(savedColor);
    });

    // SORT PINS button - triggers the actual sorting
    const sortBtn = document.getElementById('pintwist-sort-pins-btn');
    sortBtn.addEventListener('click', async () => {
        const pages = parseInt(document.getElementById('pintwist-pages-input').value) || 4;
        const sortMetric = document.getElementById('pintwist-initial-sort-option').value;
        
        // Store these for the sorting process
        State.pagesToLoad = pages;
        State.selectedMetric = sortMetric;
        
        // Remove initial bar
        bar.remove();
        
        // Start the actual sorting process
        await startSortingProcess(pages, sortMetric);
    });
}

async function startSortingProcess(pages, sortMetric) {
    try {
        // This function handles the transition from initial bar to sorted bar
        // It calls the existing loadPinsOptimized logic
        
        // Get saved theme color for progress panel
        const savedThemeColor = await new Promise(resolve => {
            chrome.storage.sync.get(['pintwist_theme_color'], (result) => {
                resolve(result.pintwist_theme_color || '#F48FB1');
            });
        });
        
        // Calculate a lighter shade for gradient
        const lighterColor = adjustColorBrightness(savedThemeColor, 40);
        
        // Create a temporary container for progress display
        const progressPanel = document.createElement('div');
        progressPanel.id = 'pintwist-progress-panel';
        progressPanel.innerHTML = `
        <style>
            @keyframes pintwist-shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }
        </style>
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                    background: linear-gradient(135deg, #ffffff 0%, #fafafa 100%); 
                    padding: 40px 48px; border-radius: 24px; 
                    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.15), 0 10px 30px rgba(0,0,0,0.1);
                    z-index: 999999; min-width: 420px; border: 1px solid rgba(0, 0, 0, 0.05);">
            
            <div style="text-align: center; margin-bottom: 24px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0.00 0.00 2959.00 1062.00" style="height: 50px; width: auto; margin-bottom: 8px;">
                    <path fill="${savedThemeColor}" d="M 606.29 202.72 A 0.15 0.15 0.0 0 0 606.08 202.86 L 606.08 337.13 A 2.37 2.36 82.7 0 1 604.31 339.42 C 597.59 341.17 590.21 344.19 585.28 345.89 Q 550.45 357.90 534.16 363.39 C 531.76 364.20 528.93 364.83 526.66 365.62 C 502.56 373.99 480.54 381.20 457.22 387.24 A 0.90 0.90 0.0 0 1 456.10 386.37 L 456.10 202.21 A 0.39 0.39 0.0 0 0 455.55 201.86 Q 428.32 214.10 404.51 226.28 Q 381.59 238.00 362.56 252.79 Q 349.75 262.74 341.35 275.06 C 335.39 283.81 333.91 294.26 337.79 304.37 C 340.67 311.86 345.33 317.43 351.32 323.78 Q 354.83 327.50 359.07 330.83 Q 374.56 342.98 385.53 348.96 Q 399.02 356.33 411.69 362.73 A 0.90 0.88 13.8 0 1 412.18 363.52 L 412.18 400.80 A 0.68 0.67 -8.9 0 1 411.71 401.44 C 385.32 409.94 360.46 417.94 333.83 428.08 Q 318.97 433.74 308.47 438.74 Q 306.99 439.45 303.79 439.83 A 1.51 1.47 60.6 0 1 302.66 439.50 C 281.45 422.03 262.57 403.40 248.91 380.41 Q 244.72 373.36 237.42 358.09 Q 224.53 331.16 223.64 301.27 C 223.11 283.05 224.31 265.60 229.47 247.93 Q 238.65 216.44 259.18 190.17 Q 266.52 180.79 275.22 171.47 C 276.57 170.03 277.68 168.13 279.11 166.68 Q 288.38 157.34 291.27 154.76 C 342.93 108.53 408.95 81.53 477.50 72.54 C 551.50 62.83 627.95 73.09 695.49 104.97 C 729.22 120.89 760.01 142.12 785.54 169.46 Q 796.65 181.36 804.51 191.49 C 816.01 206.34 823.65 222.35 831.50 242.25 A 5.32 5.18 33.8 0 1 831.85 243.90 Q 831.92 245.43 832.36 246.90 Q 837.11 262.83 838.34 279.74 Q 838.63 283.76 838.38 302.75 C 838.20 316.59 835.05 333.03 830.07 346.72 Q 816.87 382.98 789.98 411.76 C 777.03 425.63 761.48 439.16 745.21 450.41 C 715.59 470.89 682.67 487.22 649.86 501.59 Q 642.45 504.83 618.91 513.76 C 582.78 527.46 546.46 538.67 507.22 550.33 Q 486.59 556.46 474.77 560.40 Q 453.34 567.56 442.46 570.87 C 429.43 574.84 417.83 579.16 405.79 582.94 C 389.80 587.97 369.14 596.21 357.28 600.82 Q 340.76 607.25 323.06 616.32 C 298.86 628.72 277.28 643.69 261.53 665.02 Q 255.85 672.72 252.65 683.15 A 0.40 0.39 8.6 0 0 253.03 683.66 L 411.62 683.66 A 0.54 0.54 0.0 0 1 412.16 684.20 L 412.16 793.47 A 0.69 0.69 0.0 0 1 411.47 794.16 Q 342.30 794.11 180.00 794.14 Q 176.29 794.14 165.85 792.16 Q 154.23 789.96 144.41 783.63 C 132.32 775.84 123.98 761.05 121.17 747.29 Q 119.16 737.44 119.19 726.75 Q 119.23 707.75 122.76 689.08 Q 126.49 669.40 132.14 652.40 C 139.38 630.63 150.21 609.88 164.70 590.51 C 187.34 560.24 216.78 534.88 249.87 515.64 Q 290.68 491.91 335.87 474.34 Q 379.50 457.38 419.53 445.47 Q 448.26 436.92 450.77 436.12 Q 466.38 431.10 481.96 426.70 C 499.87 421.64 514.36 416.62 532.04 411.22 C 545.65 407.07 558.69 402.09 575.03 396.23 Q 581.61 393.88 592.01 389.66 Q 621.02 377.90 648.06 364.68 Q 648.54 364.44 649.10 363.95 Q 649.67 363.45 650.13 363.21 Q 657.72 359.17 668.73 353.30 Q 680.18 347.19 686.88 342.62 C 698.34 334.82 708.14 327.39 716.58 316.77 Q 722.14 309.76 724.21 303.04 C 727.98 290.74 724.40 280.56 716.31 270.50 Q 710.33 263.07 704.20 257.80 Q 687.44 243.38 664.86 231.14 Q 635.68 215.34 606.29 202.72 Z M 1658.87 345.16 L 1658.87 473.12 A 0.53 0.53 0.0 0 1 1658.34 473.65 L 1512.26 473.65 A 0.53 0.53 0.0 0 0 1511.73 474.18 L 1511.73 994.04 A 0.53 0.53 0.0 0 1 1511.20 994.57 L 1364.40 994.57 A 0.53 0.53 0.0 0 1 1363.87 994.04 L 1363.87 474.18 A 0.53 0.53 0.0 0 0 1363.34 473.65 L 1222.06 473.65 A 0.53 0.53 0.0 0 1 1221.53 473.12 L 1221.53 345.16 A 0.53 0.53 0.0 0 1 1222.06 344.63 L 1658.34 344.63 A 0.53 0.53 0.0 0 1 1658.87 345.16 Z M 2053.71 387.10 L 2179.95 387.10 A 0.34 0.34 0 0 1 2180.29 387.44 L 2180.29 473.84 A 0.34 0.34 0 0 1 2179.95 474.18 L 2053.71 474.18 A 0.34 0.34 0 0 1 2053.37 473.84 L 2053.37 387.44 A 0.34 0.34 0 0 1 2053.71 387.10 Z M 2596.95 414.06 L 2723.06 414.06 A 0.61 0.60 90.0 0 1 2723.66 414.67 L 2723.66 548.78 A 0.81 0.81 0.0 0 0 2724.47 549.59 L 2786.21 549.59 A 0.63 0.63 0.0 0 1 2786.84 550.22 L 2786.84 631.63 A 0.43 0.43 0.0 0 1 2786.41 632.06 L 2724.13 632.04 A 0.50 0.49 86.4 0 0 2723.64 632.60 Q 2723.67 632.78 2723.66 861.00 Q 2723.66 869.04 2726.02 876.20 C 2732.10 894.62 2751.39 898.17 2768.26 897.50 Q 2782.37 896.93 2796.22 894.56 A 0.50 0.50 0.0 0 1 2796.81 895.05 L 2796.81 992.57 A 0.60 0.59 86.1 0 1 2796.30 993.16 Q 2752.82 999.93 2711.01 999.11 C 2691.78 998.73 2670.45 995.62 2652.10 988.22 C 2601.22 967.68 2596.61 915.65 2596.61 868.83 Q 2596.63 634.84 2596.63 632.47 A 0.42 0.42 0.0 0 0 2596.21 632.05 L 2553.85 632.05 A 0.37 0.37 0.0 0 1 2553.48 631.68 L 2553.48 550.21 A 0.62 0.62 0.0 0 1 2554.10 549.59 L 2596.14 549.59 A 0.49 0.49 0.0 0 0 2596.63 549.10 L 2596.63 414.39 A 0.33 0.32 -90.0 0 1 2596.95 414.06 Z M 904.40 549.44 L 1028.50 549.44 A 0.62 0.62 0.0 0 1 1029.12 550.06 L 1029.12 593.36 A 0.33 0.32 -22.9 0 0 1029.68 593.58 C 1060.01 563.04 1099.78 538.48 1144.44 542.17 C 1190.73 546.00 1213.10 584.85 1217.56 627.14 Q 1218.51 636.20 1218.43 653.40 Q 1218.38 666.38 1218.41 994.20 A 0.37 0.37 0.0 0 1 1218.04 994.57 L 1094.24 994.57 A 0.47 0.46 0.0 0 1 1093.77 994.11 Q 1093.78 732.02 1093.77 663.00 C 1093.77 654.62 1092.70 644.52 1087.19 637.64 C 1080.45 629.24 1066.39 629.27 1056.76 632.53 Q 1042.19 637.45 1029.38 646.57 A 0.61 0.60 72.9 0 0 1029.12 647.07 L 1029.12 994.25 A 0.32 0.31 90.0 0 1 1028.81 994.57 L 904.10 994.57 A 0.43 0.42 -0.0 0 1 903.67 994.15 L 903.67 550.17 A 0.73 0.73 0.0 0 1 904.40 549.44 Z M 2443.38 693.49 A 0.39 0.38 -21.0 0 1 2442.85 693.26 C 2434.62 667.73 2411.94 626.87 2380.16 629.85 C 2369.39 630.86 2360.75 636.59 2357.91 647.44 C 2354.22 661.58 2362.47 674.29 2371.69 684.59 C 2383.49 697.76 2397.51 709.73 2410.73 720.37 C 2427.37 733.75 2442.76 748.12 2459.63 762.54 C 2491.45 789.73 2524.43 822.35 2529.83 866.27 Q 2533.10 892.83 2525.72 917.25 C 2511.54 964.15 2469.10 992.49 2422.47 1000.06 Q 2399.65 1003.76 2373.19 1001.45 Q 2349.94 999.43 2330.46 992.81 C 2298.37 981.91 2273.16 960.38 2254.95 932.04 Q 2242.63 912.87 2233.87 890.94 A 0.41 0.41 0.0 0 1 2234.08 890.42 L 2318.71 853.03 A 0.60 0.59 67.1 0 1 2319.51 853.36 C 2331.61 884.06 2356.36 925.48 2396.36 916.15 C 2412.23 912.45 2416.06 899.23 2412.66 884.47 Q 2410.31 874.30 2402.76 865.24 C 2393.26 853.85 2382.21 844.32 2371.49 835.26 Q 2367.22 831.64 2319.90 792.10 C 2301.98 777.13 2285.28 761.67 2271.21 743.76 Q 2246.43 712.21 2244.04 674.11 Q 2242.61 651.19 2248.40 631.37 C 2263.29 580.40 2311.63 548.70 2362.55 542.88 Q 2384.79 540.33 2407.91 543.89 Q 2456.33 551.35 2488.19 586.99 C 2505.13 605.94 2517.07 630.98 2523.79 656.13 A 0.63 0.62 -19.8 0 1 2523.44 656.86 L 2443.38 693.49 Z M 700.59 549.46 L 826.07 549.46 A 0.53 0.53 0 0 1 826.60 549.99 L 826.60 994.05 A 0.53 0.53 0 0 1 826.07 994.58 L 700.59 994.58 A 0.53 0.53 0 0 1 700.06 994.05 L 700.06 549.99 A 0.53 0.53 0 0 1 700.59 549.46 Z M 1707.96 800.58 L 1742.35 549.80 A 0.42 0.41 -86.0 0 1 1742.76 549.44 L 1832.96 549.44 A 0.44 0.43 86.2 0 1 1833.39 549.82 L 1863.15 806.36 A 0.17 0.17 0.0 0 0 1863.49 806.36 L 1900.89 549.83 A 0.45 0.45 0.0 0 1 1901.34 549.44 L 1997.68 549.44 A 0.35 0.34 -85.7 0 1 1998.02 549.84 L 1931.93 994.18 A 0.45 0.45 0.0 0 1 1931.48 994.57 L 1824.54 994.57 A 0.68 0.67 -3.9 0 1 1823.87 993.99 L 1785.72 745.83 A 0.17 0.17 0.0 0 0 1785.39 745.83 L 1742.60 994.19 A 0.46 0.45 4.4 0 1 1742.15 994.57 L 1636.58 994.57 A 0.48 0.47 85.8 0 1 1636.11 994.16 L 1570.81 549.99 A 0.48 0.48 0.0 0 1 1571.28 549.44 L 1675.17 549.44 A 0.45 0.44 86.3 0 1 1675.61 549.83 L 1707.71 800.58 A 0.13 0.13 0.0 0 0 1707.96 800.58 Z M 2054.54 549.45 L 2179.94 549.45 A 0.34 0.34 0 0 1 2180.28 549.79 L 2180.28 994.23 A 0.34 0.34 0 0 1 2179.94 994.57 L 2054.54 994.57 A 0.34 0.34 0 0 1 2054.20 994.23 L 2054.20 549.79 A 0.34 0.34 0 0 1 2054.54 549.45 Z M 605.64 566.15 A 0.34 0.34 0.0 0 1 606.08 566.47 Q 606.12 711.52 606.13 870.68 Q 606.13 879.74 605.00 886.24 C 601.84 904.45 595.88 920.87 587.77 938.55 Q 572.46 971.96 550.09 1004.09 Q 542.48 1015.03 531.96 1029.18 A 0.65 0.64 44.1 0 1 530.93 1029.19 Q 522.29 1018.19 510.59 1001.21 Q 492.78 975.36 479.32 948.62 Q 475.01 940.06 472.55 934.18 C 469.06 925.87 466.38 920.52 464.45 914.45 Q 459.88 900.07 457.31 884.43 Q 456.11 877.16 456.11 867.47 Q 456.07 755.78 456.14 613.91 A 1.20 1.19 80.4 0 1 456.94 612.78 C 468.44 608.78 482.28 604.50 502.57 598.50 Q 518.45 593.80 530.48 589.85 C 541.79 586.14 554.86 582.71 567.73 578.51 Q 587.15 572.16 605.64 566.15 Z"/>
                </svg>
                <div style="color: #888; font-weight: 600; font-size: 16px; letter-spacing: 0.5px;">
                    Loading...
                </div>
            </div>
            
            <div id="pintwist-progress-info" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 0 4px;">
                <div style="font-size: 18px; font-weight: 700; color: #888;">
                    Page <span id="pintwist-progress-current" style="color: ${savedThemeColor};">0</span> 
                    <span style="color: #999; font-weight: 500;">of</span> 
                    <span id="pintwist-progress-total" style="color: ${savedThemeColor};">${pages}</span>
                </div>
                <div style="font-size: 18px; font-weight: 700; color: ${savedThemeColor};">
                    <span id="pintwist-progress-pct">0</span>%
                </div>
            </div>
            
            <div style="background: linear-gradient(90deg, #f5f5f5 0%, #eeeeee 100%); height: 8px; border-radius: 4px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);">
                <div id="pintwist-progress-bar" style="
                    background: linear-gradient(90deg, ${savedThemeColor} 0%, ${lighterColor} 25%, ${savedThemeColor} 50%, ${lighterColor} 75%, ${savedThemeColor} 100%);
                    background-size: 200% 100%;
                    animation: pintwist-shimmer 1.5s linear infinite;
                    height: 100%; 
                    width: 0%; 
                    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1); 
                    border-radius: 4px;
                "></div>
            </div>
            
            <div id="pintwist-progress-status" style="margin-top: 20px; text-align: center; font-size: 13px; color: #888; font-weight: 500; letter-spacing: 0.2px;">
                Initializing...
            </div>
        </div>
    `;
    document.body.appendChild(progressPanel);
    
    // Store values in State
    State.selectedMetric = sortMetric;
    State.sortedPinIDs.clear();
    State.insertedNodes = [];
    State.count = 0;
    State.aborted = false;
    
    const progressBar = document.getElementById('pintwist-progress-bar');
    const progressCurrent = document.getElementById('pintwist-progress-current');
    const progressPct = document.getElementById('pintwist-progress-pct');
    const progressStatus = document.getElementById('pintwist-progress-status');
    
    const totalPages = pages;
    let noNewPinsCount = 0;
    
    for (let page = 1; page <= totalPages; page++) {
        if (State.aborted) {
            progressStatus.textContent = 'Cancelled';
            setTimeout(() => progressPanel.remove(), 2000);
            return;
        }
        
        progressCurrent.textContent = page;
        progressPct.textContent = Math.round((page / totalPages) * 100);
        progressBar.style.width = `${(page / totalPages) * 100}%`;
        progressStatus.textContent = `Page ${page}: Scanning...`;
        
        // Get all pins currently visible
        const pins = document.querySelectorAll('[data-test-pin-id]');
        const newPins = Array.from(pins).filter(p => {
            const id = p.getAttribute('data-test-pin-id');
            return id && !State.sortedPinIDs.has(id);
        });
        
        if (newPins.length > 0) {
            noNewPinsCount = 0;
            progressStatus.textContent = `Page ${page}: Fetching ${newPins.length} pins...`;
            const pinIDs = newPins.map(p => p.getAttribute('data-test-pin-id'));
            const metricsMap = await fetchBulk(pinIDs);
            
            for (const el of newPins) {
                const pinID = el.getAttribute('data-test-pin-id');
                if (State.sortedPinIDs.has(pinID)) continue;
                State.sortedPinIDs.add(pinID);
                const metrics = metricsMap.get(pinID);
                if (!metrics) continue;
                
                let sortValue, displayText;
                if (State.selectedMetric === 'date') {
                    sortValue = new Date(metrics.createdAt).getTime() || 0;
                    displayText = new Date(metrics.createdAt).toLocaleDateString('en-US', {
                        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                    });
                } else {
                    sortValue = metrics[METRIC_MAP[State.selectedMetric]] || 0;
                    displayText = formatNumber(sortValue);
                }
                
                // Set attributes on the element
                el.setAttribute('rel', sortValue);
                el.dataset.pinId = pinID;
                el.classList.add('pinbox');
                
                // Add overlay
                el.insertAdjacentHTML('beforeend', createOverlayHTML(metrics));
                
                // Clone for later insertion
                const clone = el.closest('[data-grid-item="true"]')?.cloneNode(true);
                if (clone) State.insertedNodes.push(clone);
                
                State.count++;
            }
            
            progressStatus.textContent = `Page ${page}: Done! (${newPins.length} pins processed)`;
        } else {
            noNewPinsCount++;
            progressStatus.textContent = `Page ${page}: No new pins found`;
            if (noNewPinsCount >= 2) {
                progressStatus.textContent = 'No more new pins found - stopping early';
                break;
            }
        }
        
        // Scroll to load more pins
        if (page < totalPages) {
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(2500);
        }
    }
    
    // Done loading, now show the sorted bar
    progressStatus.textContent = 'Building sorted view...';
    await sleep(500);
    progressPanel.remove();
    
    // Now create and show the "after" bar (existing functionality)
    showSortedBar();
    
    } catch (error) {
        console.error('PinTwist: Error in startSortingProcess:', error);
        alert('PinTwist Error: ' + error.message + '\n\nPlease refresh the page and try again.');
        document.getElementById('pintwist-progress-panel')?.remove();
    }
}

function showSortedBar() {
    // This calls the existing finishSort function which creates the "after" bar
    finishSort();
}

function finishSort() {
    const newGrid = document.createElement('div');
    newGrid.id = 'newgrid';
    const gridItems = document.querySelectorAll('div[data-grid-item="true"]');
    if (gridItems.length) {
        const parent = gridItems[0].parentElement;
        parent.before(newGrid);
        parent.remove();
    }
    const node = document.createElement('div');
    State.insertedNodes.forEach(item => node.appendChild(item));
    newGrid.appendChild(node);
    const list = Array.from(newGrid.querySelectorAll('.pinbox'));
    // Add overlays
    list.forEach(el => {
        const pinID = el.dataset.pinId;
        if (!pinID) return;
        el.querySelectorAll('[data-pintwist]').forEach(x => x.remove());
        const metrics = getCached(pinID);
        if (metrics) el.insertAdjacentHTML('beforeend', createOverlayHTML(metrics));
    });
    // Sort
    list.sort((a, b) => (parseInt(b.getAttribute('rel')) || 0) - (parseInt(a.getAttribute('rel')) || 0));
    newGrid.innerHTML = '';
    // Resort bar
    const metricLabel = State.selectedMetric.charAt(0).toUpperCase() + State.selectedMetric.slice(1);
    const resortBar = `
        <div id="pintwist-resort-bar">
            <div class="pintwist-logo-container">
                <svg class="pintwist-logo-wordmark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0.00 0.00 2959.00 1062.00" height="28">
                    <path class="pintwist-themed-fill" d="M 606.29 202.72 A 0.15 0.15 0.0 0 0 606.08 202.86 L 606.08 337.13 A 2.37 2.36 82.7 0 1 604.31 339.42 C 597.59 341.17 590.21 344.19 585.28 345.89 Q 550.45 357.90 534.16 363.39 C 531.76 364.20 528.93 364.83 526.66 365.62 C 502.56 373.99 480.54 381.20 457.22 387.24 A 0.90 0.90 0.0 0 1 456.10 386.37 L 456.10 202.21 A 0.39 0.39 0.0 0 0 455.55 201.86 Q 428.32 214.10 404.51 226.28 Q 381.59 238.00 362.56 252.79 Q 349.75 262.74 341.35 275.06 C 335.39 283.81 333.91 294.26 337.79 304.37 C 340.67 311.86 345.33 317.43 351.32 323.78 Q 354.83 327.50 359.07 330.83 Q 374.56 342.98 385.53 348.96 Q 399.02 356.33 411.69 362.73 A 0.90 0.88 13.8 0 1 412.18 363.52 L 412.18 400.80 A 0.68 0.67 -8.9 0 1 411.71 401.44 C 385.32 409.94 360.46 417.94 333.83 428.08 Q 318.97 433.74 308.47 438.74 Q 306.99 439.45 303.79 439.83 A 1.51 1.47 60.6 0 1 302.66 439.50 C 281.45 422.03 262.57 403.40 248.91 380.41 Q 244.72 373.36 237.42 358.09 Q 224.53 331.16 223.64 301.27 C 223.11 283.05 224.31 265.60 229.47 247.93 Q 238.65 216.44 259.18 190.17 Q 266.52 180.79 275.22 171.47 C 276.57 170.03 277.68 168.13 279.11 166.68 Q 288.38 157.34 291.27 154.76 C 342.93 108.53 408.95 81.53 477.50 72.54 C 551.50 62.83 627.95 73.09 695.49 104.97 C 729.22 120.89 760.01 142.12 785.54 169.46 Q 796.65 181.36 804.51 191.49 C 816.01 206.34 823.65 222.35 831.50 242.25 A 5.32 5.18 33.8 0 1 831.85 243.90 Q 831.92 245.43 832.36 246.90 Q 837.11 262.83 838.34 279.74 Q 838.63 283.76 838.38 302.75 C 838.20 316.59 835.05 333.03 830.07 346.72 Q 816.87 382.98 789.98 411.76 C 777.03 425.63 761.48 439.16 745.21 450.41 C 715.59 470.89 682.67 487.22 649.86 501.59 Q 642.45 504.83 618.91 513.76 C 582.78 527.46 546.46 538.67 507.22 550.33 Q 486.59 556.46 474.77 560.40 Q 453.34 567.56 442.46 570.87 C 429.43 574.84 417.83 579.16 405.79 582.94 C 389.80 587.97 369.14 596.21 357.28 600.82 Q 340.76 607.25 323.06 616.32 C 298.86 628.72 277.28 643.69 261.53 665.02 Q 255.85 672.72 252.65 683.15 A 0.40 0.39 8.6 0 0 253.03 683.66 L 411.62 683.66 A 0.54 0.54 0.0 0 1 412.16 684.20 L 412.16 793.47 A 0.69 0.69 0.0 0 1 411.47 794.16 Q 342.30 794.11 180.00 794.14 Q 176.29 794.14 165.85 792.16 Q 154.23 789.96 144.41 783.63 C 132.32 775.84 123.98 761.05 121.17 747.29 Q 119.16 737.44 119.19 726.75 Q 119.23 707.75 122.76 689.08 Q 126.49 669.40 132.14 652.40 C 139.38 630.63 150.21 609.88 164.70 590.51 C 187.34 560.24 216.78 534.88 249.87 515.64 Q 290.68 491.91 335.87 474.34 Q 379.50 457.38 419.53 445.47 Q 448.26 436.92 450.77 436.12 Q 466.38 431.10 481.96 426.70 C 499.87 421.64 514.36 416.62 532.04 411.22 C 545.65 407.07 558.69 402.09 575.03 396.23 Q 581.61 393.88 592.01 389.66 Q 621.02 377.90 648.06 364.68 Q 648.54 364.44 649.10 363.95 Q 649.67 363.45 650.13 363.21 Q 657.72 359.17 668.73 353.30 Q 680.18 347.19 686.88 342.62 C 698.34 334.82 708.14 327.39 716.58 316.77 Q 722.14 309.76 724.21 303.04 C 727.98 290.74 724.40 280.56 716.31 270.50 Q 710.33 263.07 704.20 257.80 Q 687.44 243.38 664.86 231.14 Q 635.68 215.34 606.29 202.72 Z"/>
                    <path class="pintwist-themed-fill" d="M 1658.87 345.16 L 1658.87 473.12 A 0.53 0.53 0.0 0 1 1658.34 473.65 L 1512.26 473.65 A 0.53 0.53 0.0 0 0 1511.73 474.18 L 1511.73 994.04 A 0.53 0.53 0.0 0 1 1511.20 994.57 L 1364.40 994.57 A 0.53 0.53 0.0 0 1 1363.87 994.04 L 1363.87 474.18 A 0.53 0.53 0.0 0 0 1363.34 473.65 L 1222.06 473.65 A 0.53 0.53 0.0 0 1 1221.53 473.12 L 1221.53 345.16 A 0.53 0.53 0.0 0 1 1222.06 344.63 L 1658.34 344.63 A 0.53 0.53 0.0 0 1 1658.87 345.16 Z"/>
                    <rect class="pintwist-themed-fill" x="2053.71" y="387.10" width="126.24" height="87.08" rx="0.34"/>
                    <path class="pintwist-themed-fill" d="M 2596.95 414.06 L 2723.06 414.06 A 0.61 0.60 90.0 0 1 2723.66 414.67 L 2723.66 548.78 A 0.81 0.81 0.0 0 0 2724.47 549.59 L 2786.21 549.59 A 0.63 0.63 0.0 0 1 2786.84 550.22 L 2786.84 631.63 A 0.43 0.43 0.0 0 1 2786.41 632.06 L 2724.13 632.04 A 0.50 0.49 86.4 0 0 2723.64 632.60 Q 2723.67 632.78 2723.66 861.00 Q 2723.66 869.04 2726.02 876.20 C 2732.10 894.62 2751.39 898.17 2768.26 897.50 Q 2782.37 896.93 2796.22 894.56 A 0.50 0.50 0.0 0 1 2796.81 895.05 L 2796.81 992.57 A 0.60 0.59 86.1 0 1 2796.30 993.16 Q 2752.82 999.93 2711.01 999.11 C 2691.78 998.73 2670.45 995.62 2652.10 988.22 C 2601.22 967.68 2596.61 915.65 2596.61 868.83 Q 2596.63 634.84 2596.63 632.47 A 0.42 0.42 0.0 0 0 2596.21 632.05 L 2553.85 632.05 A 0.37 0.37 0.0 0 1 2553.48 631.68 L 2553.48 550.21 A 0.62 0.62 0.0 0 1 2554.10 549.59 L 2596.14 549.59 A 0.49 0.49 0.0 0 0 2596.63 549.10 L 2596.63 414.39 A 0.33 0.32 -90.0 0 1 2596.95 414.06 Z"/>
                    <path class="pintwist-themed-fill" d="M 904.40 549.44 L 1028.50 549.44 A 0.62 0.62 0.0 0 1 1029.12 550.06 L 1029.12 593.36 A 0.33 0.32 -22.9 0 0 1029.68 593.58 C 1060.01 563.04 1099.78 538.48 1144.44 542.17 C 1190.73 546.00 1213.10 584.85 1217.56 627.14 Q 1218.51 636.20 1218.43 653.40 Q 1218.38 666.38 1218.41 994.20 A 0.37 0.37 0.0 0 1 1218.04 994.57 L 1094.24 994.57 A 0.47 0.46 0.0 0 1 1093.77 994.11 Q 1093.78 732.02 1093.77 663.00 C 1093.77 654.62 1092.70 644.52 1087.19 637.64 C 1080.45 629.24 1066.39 629.27 1056.76 632.53 Q 1042.19 637.45 1029.38 646.57 A 0.61 0.60 72.9 0 0 1029.12 647.07 L 1029.12 994.25 A 0.32 0.31 90.0 0 1 1028.81 994.57 L 904.10 994.57 A 0.43 0.42 -0.0 0 1 903.67 994.15 L 903.67 550.17 A 0.73 0.73 0.0 0 1 904.40 549.44 Z"/>
                    <path class="pintwist-themed-fill" d="M 2443.38 693.49 A 0.39 0.38 -21.0 0 1 2442.85 693.26 C 2434.62 667.73 2411.94 626.87 2380.16 629.85 C 2369.39 630.86 2360.75 636.59 2357.91 647.44 C 2354.22 661.58 2362.47 674.29 2371.69 684.59 C 2383.49 697.76 2397.51 709.73 2410.73 720.37 C 2427.37 733.75 2442.76 748.12 2459.63 762.54 C 2491.45 789.73 2524.43 822.35 2529.83 866.27 Q 2533.10 892.83 2525.72 917.25 C 2511.54 964.15 2469.10 992.49 2422.47 1000.06 Q 2399.65 1003.76 2373.19 1001.45 Q 2349.94 999.43 2330.46 992.81 C 2298.37 981.91 2273.16 960.38 2254.95 932.04 Q 2242.63 912.87 2233.87 890.94 A 0.41 0.41 0.0 0 1 2234.08 890.42 L 2318.71 853.03 A 0.60 0.59 67.1 0 1 2319.51 853.36 C 2331.61 884.06 2356.36 925.48 2396.36 916.15 C 2412.23 912.45 2416.06 899.23 2412.66 884.47 Q 2410.31 874.30 2402.76 865.24 C 2393.26 853.85 2382.21 844.32 2371.49 835.26 Q 2367.22 831.64 2319.90 792.10 C 2301.98 777.13 2285.28 761.67 2271.21 743.76 Q 2246.43 712.21 2244.04 674.11 Q 2242.61 651.19 2248.40 631.37 C 2263.29 580.40 2311.63 548.70 2362.55 542.88 Q 2384.79 540.33 2407.91 543.89 Q 2456.33 551.35 2488.19 586.99 C 2505.13 605.94 2517.07 630.98 2523.79 656.13 A 0.63 0.62 -19.8 0 1 2523.44 656.86 L 2443.38 693.49 Z"/>
                    <rect class="pintwist-themed-fill" x="700.59" y="549.46" width="125.48" height="445.12" rx="0.53"/>
                    <path class="pintwist-themed-fill" d="M 1707.96 800.58 L 1742.35 549.80 A 0.42 0.41 -86.0 0 1 1742.76 549.44 L 1832.96 549.44 A 0.44 0.43 86.2 0 1 1833.39 549.82 L 1863.15 806.36 A 0.17 0.17 0.0 0 0 1863.49 806.36 L 1900.89 549.83 A 0.45 0.45 0.0 0 1 1901.34 549.44 L 1997.68 549.44 A 0.35 0.34 -85.7 0 1 1998.02 549.84 L 1931.93 994.18 A 0.45 0.45 0.0 0 1 1931.48 994.57 L 1824.54 994.57 A 0.68 0.67 -3.9 0 1 1823.87 993.99 L 1785.72 745.83 A 0.17 0.17 0.0 0 0 1785.39 745.83 L 1742.60 994.19 A 0.46 0.45 4.4 0 1 1742.15 994.57 L 1636.58 994.57 A 0.48 0.47 85.8 0 1 1636.11 994.16 L 1570.81 549.99 A 0.48 0.48 0.0 0 1 1571.28 549.44 L 1675.17 549.44 A 0.45 0.44 86.3 0 1 1675.61 549.83 L 1707.71 800.58 A 0.13 0.13 0.0 0 0 1707.96 800.58 Z"/>
                    <rect class="pintwist-themed-fill" x="2054.54" y="549.45" width="125.40" height="445.12" rx="0.34"/>
                    <path class="pintwist-themed-fill" d="M 605.64 566.15 A 0.34 0.34 0.0 0 1 606.08 566.47 Q 606.12 711.52 606.13 870.68 Q 606.13 879.74 605.00 886.24 C 601.84 904.45 595.88 920.87 587.77 938.55 Q 572.46 971.96 550.09 1004.09 Q 542.48 1015.03 531.96 1029.18 A 0.65 0.64 44.1 0 1 530.93 1029.19 Q 522.29 1018.19 510.59 1001.21 Q 492.78 975.36 479.32 948.62 Q 475.01 940.06 472.55 934.18 C 469.06 925.87 466.38 920.52 464.45 914.45 Q 459.88 900.07 457.31 884.43 Q 456.11 877.16 456.11 867.47 Q 456.07 755.78 456.14 613.91 A 1.20 1.19 80.4 0 1 456.94 612.78 C 468.44 608.78 482.28 604.50 502.57 598.50 Q 518.45 593.80 530.48 589.85 C 541.79 586.14 554.86 582.71 567.73 578.51 Q 587.15 572.16 605.64 566.15 Z"/>
                </svg>
            </div>
            <label>Re-sort by:</label>
            <div class="custom-dropdown" id="resort-dropdown-wrapper" style="width:auto; min-width:150px">
                <button class="custom-dropdown-btn" id="resort-dropdown-btn" type="button">
                    <span class="dropdown-text">${metricLabel}</span>
                    <svg class="dropdown-arrow" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M6 9L1 4h10z"/>
                    </svg>
                </button>
                <div class="custom-dropdown-menu" id="resort-dropdown-menu">
                    <div class="dropdown-item" data-value="saves">Saves</div>
                    <div class="dropdown-item" data-value="reaction">Reactions</div>
                    <div class="dropdown-item" data-value="share">Shares</div>
                    <div class="dropdown-item" data-value="repin">Repins</div>
                    <div class="dropdown-item" data-value="comment">Comments</div>
                    <div class="dropdown-item" data-value="date">Date</div>
                </div>
            </div>
            <input type="hidden" id="pintwist-resort-select" value="${State.selectedMetric}">
            <div class="pintwist-search-wrapper">
                <input type="text" id="pintwist-search-input" placeholder="Search Pinterest..." />
                <button id="pintwist-search-btn">🔍</button>
            </div>
            <label class="pintwist-checkbox-wrapper">
                <input type="checkbox" id="pintwist-show-badges" checked>
                <span class="pintwist-checkbox-label">Show Badges</span>
            </label>
            <button id="pintwist-filter-toggle">▼ Filters</button>
            <span class="resort-info" id="pintwist-match-count"><svg class="sorted-icon" width="14" height="14" viewBox="0 0 24 24" fill="#8e8e8e" style="vertical-align: middle; margin-right: 4px; margin-bottom: 2px;"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg>${list.length} PINS SORTED BY PINTWIST</span>
            <a href="https://www.youtube.com/@iscalepod" target="_blank" class="pintwist-tutorial-link">Tutorial: youtube.com/@iscalepod</a>
        </div>
    `;
    
    // ADDED: Calculate filter ranges from scanned pins
    calculateFilterRanges(list);
    
    // ADDED: Filter bar HTML
    const filterBar = `
        <div id="pintwist-filter-bar" class="pintwist-filter-expanded">
            <div class="filter-row">
                <button id="pintwist-reset-all-filters" class="reset-all-btn" title="Clear all filters">X ALL</button>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Saves:</label>
                        <input type="text" id="filter-saves-min" class="filter-input" data-metric="saves" data-bound="min" value="${State.filterRanges.saves.min}">
                        <span class="filter-dash">—</span>
                        <input type="text" id="filter-saves-max" class="filter-input" data-metric="saves" data-bound="max" value="${State.filterRanges.saves.max}">
                        <div class="filter-pills-container" data-metric="saves"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Comments:</label>
                        <input type="text" id="filter-comments-min" class="filter-input" data-metric="comments" data-bound="min" value="${State.filterRanges.comments.min}">
                        <span class="filter-dash">—</span>
                        <input type="text" id="filter-comments-max" class="filter-input" data-metric="comments" data-bound="max" value="${State.filterRanges.comments.max}">
                        <div class="filter-pills-container" data-metric="comments"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Repins:</label>
                        <input type="text" id="filter-repins-min" class="filter-input" data-metric="repins" data-bound="min" value="${State.filterRanges.repins.min}">
                        <span class="filter-dash">—</span>
                        <input type="text" id="filter-repins-max" class="filter-input" data-metric="repins" data-bound="max" value="${State.filterRanges.repins.max}">
                        <div class="filter-pills-container" data-metric="repins"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Reactions:</label>
                        <input type="text" id="filter-reactions-min" class="filter-input" data-metric="reactions" data-bound="min" value="${State.filterRanges.reactions.min}">
                        <span class="filter-dash">—</span>
                        <input type="text" id="filter-reactions-max" class="filter-input" data-metric="reactions" data-bound="max" value="${State.filterRanges.reactions.max}">
                        <div class="filter-pills-container" data-metric="reactions"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper">
                    <div class="filter-group">
                        <label>Shares:</label>
                        <input type="text" id="filter-shares-min" class="filter-input" data-metric="shares" data-bound="min" value="${State.filterRanges.shares.min}">
                        <span class="filter-dash">—</span>
                        <input type="text" id="filter-shares-max" class="filter-input" data-metric="shares" data-bound="max" value="${State.filterRanges.shares.max}">
                        <div class="filter-pills-container" data-metric="shares"></div>
                    </div>
                </div>
                <div class="filter-group-wrapper filter-date">
                    <div class="filter-group">
                        <label>Date:</label>
                        <input type="date" id="filter-date-min" class="filter-input" data-metric="date" data-bound="min" value="${new Date(State.filterRanges.date.min).toISOString().split('T')[0]}">
                        <span class="filter-dash">—</span>
                        <input type="date" id="filter-date-max" class="filter-input" data-metric="date" data-bound="max" value="${new Date(State.filterRanges.date.max).toISOString().split('T')[0]}">
                        <div class="filter-pills-container" data-metric="date"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    let html = '<div class="pinterest--container" id="pintwist-sorted-container">';
    list.forEach(e => {
        e.classList.add('pinterest--block');
        const pinID = e.dataset.pinId || e.getAttribute('data-test-pin-id');
        const metrics = pinID ? getCached(pinID) : null;
        
        // ===== VIDEO PIN FIX: Completely rebuild video pins to match image pins =====
        // Detect video by API flag OR by presence of video element in DOM
        const hasVideoElement = !!e.querySelector('video');
        const isVideoPin = metrics?.isVideo || hasVideoElement;
        
        if (isVideoPin) {
            // Get thumbnail URL from multiple sources
            const video = e.querySelector('video');
            const thumbnailUrl = video?.poster || 
                                 video?.getAttribute('poster') || 
                                 video?.getAttribute('data-poster') ||
                                 metrics?.imageUrl ||
                                 e.querySelector('img')?.src;  // Fallback to any existing image
            
            if (thumbnailUrl) {
                // Save the overlay (or create it)
                const existingOverlay = e.querySelector('[data-pintwist]');
                const overlayHTML = existingOverlay ? existingOverlay.outerHTML : createOverlayHTML(metrics);
                
                // Get sort value for legacy badge
                let sortValue = 0;
                let displayText = '';
                if (State.selectedMetric === 'date') {
                    sortValue = metrics?.createdAt ? new Date(metrics.createdAt).getTime() : 0;
                    displayText = metrics?.createdAt ? getDaysAgo(metrics.createdAt) : 'Unknown';
                } else {
                    sortValue = ({
                        saves: metrics?.saves,
                        share: metrics?.shares,
                        reaction: metrics?.reactions,
                        repin: metrics?.repins,
                        comment: metrics?.comments
                    })[State.selectedMetric] || 0;
                    displayText = `${State.selectedMetric.charAt(0).toUpperCase() + State.selectedMetric.slice(1)}: ${formatNumber(sortValue)}`;
                }
                
                // COMPLETELY CLEAR the element
                e.innerHTML = '';
                
                // Rebuild with: link wrapper + image + badges + overlay
                const link = document.createElement('a');
                link.href = `https://www.pinterest.com/pin/${pinID}/`;
                link.target = '_blank';
                link.style.cssText = 'display:block;text-decoration:none;';
                
                const img = document.createElement('img');
                img.src = thumbnailUrl;
                img.alt = 'Video thumbnail';
                img.style.cssText = 'width:100%;height:320px;object-fit:cover;border-radius:16px 16px 0 0;display:block;';
                link.appendChild(img);
                e.appendChild(link);
                
                // Add video badge
                const videoBadge = document.createElement('div');
                videoBadge.className = 'pintwist-video-badge';
                videoBadge.textContent = '▶ Video';
                e.appendChild(videoBadge);
                
                // Add legacy metric badge
                const metricBadge = document.createElement('a');
                metricBadge.href = `/pin/${pinID}/`;
                metricBadge.target = '_blank';
                metricBadge.className = 'pintwist-legacy-badge';
                metricBadge.textContent = displayText;
                metricBadge.dataset.pinId = pinID;
                e.appendChild(metricBadge);
                
                // Re-add overlay
                e.insertAdjacentHTML('beforeend', overlayHTML);
                
                // Add to HTML and continue to next pin
                html += e.outerHTML;
                return;
            }
        }
        
        // ===== IMAGE PINS: Normal processing (unchanged) =====
        // Convert any lazy-loaded images to regular src
        e.querySelectorAll('img').forEach(img => {
            const lazySrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('loading-src');
            if (lazySrc && !img.src) {
                img.src = lazySrc;
            }
            const srcset = img.getAttribute('srcset');
            if (srcset && !img.src) {
                const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
                if (urls.length) img.src = urls[urls.length - 1];
            }
        });
        
        // Check all images for valid http URLs
        let hasVisibleMedia = false;
        e.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') || img.src || '';
            if (src && src.startsWith('http')) {
                hasVisibleMedia = true;
            }
        });
        
        // Check for background images
        if (!hasVisibleMedia) {
            e.querySelectorAll('div[style*="background"]').forEach(div => {
                const style = div.getAttribute('style') || '';
                const match = style.match(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/);
                if (match) {
                    const img = document.createElement('img');
                    img.src = match[1];
                    img.style.cssText = 'width:100%;height:320px;object-fit:cover;border-radius:16px 16px 0 0;display:block;';
                    div.parentNode?.insertBefore(img, div);
                    div.remove();
                    hasVisibleMedia = true;
                }
            });
        }
        
        // If still no visible media, use API image
        if (!hasVisibleMedia && metrics?.imageUrl) {
            const thumbnailImg = document.createElement('img');
            thumbnailImg.src = metrics.imageUrl;
            thumbnailImg.alt = 'Pin thumbnail';
            thumbnailImg.style.cssText = 'width:100%;height:320px;object-fit:cover;border-radius:16px 16px 0 0;display:block;';
            e.insertBefore(thumbnailImg, e.firstChild);
            hasVisibleMedia = true;
        }
        
        // Last resort placeholder
        if (!hasVisibleMedia) {
            const placeholder = document.createElement('div');
            placeholder.className = 'pintwist-placeholder-thumb';
            placeholder.innerHTML = `<span>📌</span><span>Pin #${pinID?.slice(-6) || '?'}</span><a href="https://www.pinterest.com/pin/${pinID}/" target="_blank" class="pintwist-view-link">View on Pinterest</a>`;
            e.insertBefore(placeholder, e.firstChild);
        }
        
        // Remove inline padding-bottom styles
        e.querySelectorAll('[style*="padding-bottom"]').forEach(el => {
            el.style.paddingBottom = '0';
        });
        
        // Remove title links (links that ONLY contain text, no media elements)
        e.querySelectorAll('a').forEach(el => {
            // Check if link has any media children (img, video, canvas, svg, or divs with background)
            const hasMedia = el.querySelector('img, video, canvas, svg, [style*="background"]');
            const hasStructure = el.querySelector('div, span');
            // Only remove if it's clearly a text-only title link (not our badges)
            if (!hasMedia && !hasStructure && el.textContent.trim().length > 0 && 
                !el.classList.contains('pintwist-download-btn') && 
                !el.classList.contains('pintwist-legacy-badge')) {
                el.remove();
            }
        });
        // Remove Pinterest UI elements
        e.querySelectorAll('[data-test-id="pinTitle"], [data-test-id="pin-title"], [data-test-id="truncated-description"]').forEach(el => el.remove());
        e.querySelectorAll('button:not(.pintwist-download-btn)').forEach(el => el.remove());
        e.querySelectorAll('[role="button"]:not(.pintwist-download-btn)').forEach(el => el.remove());
        
        // CRITICAL: Add top-right metric badge for ALL pins!
        if (!e.querySelector('.pintwist-legacy-badge')) {
            // Calculate displayText based on current sort metric
            let displayText = '';
            if (State.selectedMetric === 'date') {
                displayText = metrics?.createdAt ? getDaysAgo(metrics.createdAt) : 'Unknown';
            } else {
                const sortValue = ({
                    saves: metrics?.saves,
                    share: metrics?.shares,
                    reaction: metrics?.reactions,
                    repin: metrics?.repins,
                    comment: metrics?.comments
                })[State.selectedMetric] || 0;
                displayText = `${State.selectedMetric.charAt(0).toUpperCase() + State.selectedMetric.slice(1)}: ${formatNumber(sortValue)}`;
            }
            
            const metricBadge = document.createElement('a');
            metricBadge.href = `/pin/${pinID}/`;
            metricBadge.target = '_blank';
            metricBadge.className = 'pintwist-legacy-badge';
            metricBadge.textContent = displayText;
            metricBadge.dataset.pinId = pinID;
            e.appendChild(metricBadge);
        }
        
        html += e.outerHTML;
    });
    html += '</div>';
    document.write(`<style>
        #pintwist-sorted-container div { padding-bottom: 0 !important; min-height: 0 !important; }
        #pintwist-sorted-container [style*="padding-bottom"] { padding-bottom: 0 !important; }
        .pinterest--block, .pinterest--block * { padding-bottom: 0 !important; }
    </style>${resortBar}${filterBar}${html}`);
    setTimeout(() => {
        reattachListeners();
        setupResortBar();
        setupSearchBar();
        setupFilterBar(); // ADDED: Setup filter bar event handlers
        
        // Adjust padding for pin detail pages
        adjustPinterestPadding();
    }, 100);
    window.scrollTo(0, 0);
    saveCache();
}
function reattachListeners() {
    document.querySelectorAll('.pintwist-download-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            downloadImage(newBtn.dataset.pinId, newBtn.dataset.imageUrl, newBtn);
        });
    });
}

// Toggle top-right metric badges visibility
function toggleBadges(show) {
    const badges = document.querySelectorAll('.pintwist-legacy-badge');
    badges.forEach(badge => {
        badge.style.display = show ? '' : 'none';
    });
}

// Apply theme color to all themed elements
function applyThemeColor(color) {
    // Calculate darker shade for hover states
    const darkerColor = adjustColorBrightness(color, -20);
    
    // Update CSS custom properties
    document.documentElement.style.setProperty('--pintwist-primary', color);
    document.documentElement.style.setProperty('--pintwist-primary-dark', darkerColor);
    
    // Update SVG logo fills
    document.querySelectorAll('.pintwist-themed-fill').forEach(el => {
        el.style.fill = color;
    });
    
    // Update inline-styled elements that can't use CSS variables
    document.querySelectorAll('.pintwist-legacy-badge').forEach(el => {
        if (!el.classList.contains('pintwist-badge-grey')) {
            el.style.borderColor = color;
            el.style.color = color;
            el.style.background = 'rgba(255, 255, 255, 0.9)';
        }
    });
    
    // Update resort bar bottom border
    const resortBar = document.getElementById('pintwist-resort-bar');
    if (resortBar) {
        resortBar.style.setProperty('border-color', color, 'important');
    }

    // Update filter bar border
    const filterBar = document.getElementById('pintwist-filter-bar');
    if (filterBar) {
        filterBar.style.setProperty('border-color', color, 'important');
    }
    
    // Update initial bar elements
    const initialBar = document.getElementById('pintwist-initial-bar');
    if (initialBar) {
        initialBar.style.setProperty('border-color', color, 'important');
        
        // Update SORT PINS button
        const sortBtn = document.getElementById('pintwist-sort-pins-btn');
        if (sortBtn) {
            sortBtn.style.background = color;
        }
        
        // Update checkbox accent color
        const checkbox = document.getElementById('pintwist-show-overlays');
        if (checkbox) {
            checkbox.style.accentColor = color;
        }
    }
}

// Helper to darken/lighten a hex color
function adjustColorBrightness(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, Math.min(255, (num >> 16) + amt));
    const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
    const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

function setupResortBar() {
    const btn = document.getElementById('resort-dropdown-btn');
    const menu = document.getElementById('resort-dropdown-menu');
    const text = btn?.querySelector('.dropdown-text');
    const input = document.getElementById('pintwist-resort-select');
    if (!btn || !menu) return;
    btn.addEventListener('click', e => {
        e.stopPropagation();
        menu.classList.toggle('show');
    });
    menu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', e => {
            input.value = e.target.dataset.value;
            text.textContent = e.target.textContent;
            menu.classList.remove('show');
            resortPins(e.target.dataset.value);
        });
    });
    document.addEventListener('click', e => {
        if (!btn.contains(e.target)) menu.classList.remove('show');
    });
    
    // Show Badges checkbox
    const badgeCheckbox = document.getElementById('pintwist-show-badges');
    if (badgeCheckbox) {
        // Load saved state
        chrome.storage.sync.get(['pintwist_show_badges'], (result) => {
            const showBadges = result.pintwist_show_badges !== false; // Default: true
            badgeCheckbox.checked = showBadges;
            toggleBadges(showBadges);
        });

        badgeCheckbox.addEventListener('change', () => {
            const isChecked = badgeCheckbox.checked;
            chrome.storage.sync.set({ pintwist_show_badges: isChecked });
            toggleBadges(isChecked);
        });
    }

    // Load saved theme color
    chrome.storage.sync.get(['pintwist_theme_color'], (result) => {
        const savedColor = result.pintwist_theme_color || '#F48FB1';
        applyThemeColor(savedColor);
    });
}
function setupSearchBar() {
    const input = document.getElementById('pintwist-search-input');
    const btn = document.getElementById('pintwist-search-btn');
    if (!input || !btn) return;
    
    const doSearch = () => {
        const query = input.value.trim();
        if (query) {
            // Use current Pinterest domain (works for all countries)
            window.location.href = `${window.location.origin}/search/pins/?q=${encodeURIComponent(query)}`;
        }
    };
    
    btn.addEventListener('click', doSearch);
    input.addEventListener('keypress', e => {
        if (e.key === 'Enter') doSearch();
    });
}
function resortPins(metric) {
    const container = document.getElementById('pintwist-sorted-container');
    if (!container) return;
    const pins = Array.from(container.querySelectorAll('.pinterest--block'));
    pins.forEach(el => {
        const pinID = el.dataset.pinId || el.getAttribute('data-test-pin-id');
        if (!pinID) return;
        const metrics = getCached(pinID);
        if (!metrics) return;
        let sortValue, displayText;
        if (metric === 'date') {
            sortValue = new Date(metrics.createdAt).getTime() || 0;
            displayText = new Date(metrics.createdAt).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
        } else {
            sortValue = ({ saves: metrics.saves, share: metrics.shares, reaction: metrics.reactions, repin: metrics.repins, comment: metrics.comments })[metric] || 0;
            displayText = `${metric.charAt(0).toUpperCase() + metric.slice(1)}: ${formatNumber(sortValue)}`;
        }
        el.setAttribute('rel', sortValue);
        const badge = el.querySelector('.pintwist-legacy-badge');
        if (badge) badge.textContent = displayText;
    });
    pins.sort((a, b) => (parseInt(b.getAttribute('rel')) || 0) - (parseInt(a.getAttribute('rel')) || 0));
    container.innerHTML = '';
    pins.forEach(p => container.appendChild(p));
    reattachListeners();
    const info = document.querySelector('#pintwist-resort-bar .resort-info');
    if (info) info.innerHTML = `<svg class="sorted-icon" width="14" height="14" viewBox="0 0 24 24" fill="#8e8e8e" style="vertical-align: middle; margin-right: 4px; margin-bottom: 2px;"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg>${pins.length} PINS SORTED BY PINTWIST`;
}

// ===== FILTER SYSTEM (ADDED) =====
function calculateFilterRanges(pinElements) {
    // Use passed pin elements to calculate filter ranges
    const currentPagePinIDs = new Set();
    
    pinElements.forEach(el => {
        const pinID = el.dataset.pinId;
        if (pinID && State.metricsCache.has(pinID)) {
            currentPagePinIDs.add(pinID);
        }
    });
    
    const ranges = {
        saves: { min: Infinity, max: -Infinity },
        comments: { min: Infinity, max: -Infinity },
        repins: { min: Infinity, max: -Infinity },
        reactions: { min: Infinity, max: -Infinity },
        shares: { min: Infinity, max: -Infinity },
        date: { min: Infinity, max: -Infinity }
    };
    
    // Loop only through current page pins, not entire cache
    for (const pinID of currentPagePinIDs) {
        const metrics = State.metricsCache.get(pinID);
        ranges.saves.min = Math.min(ranges.saves.min, metrics.saves);
        ranges.saves.max = Math.max(ranges.saves.max, metrics.saves);
        
        ranges.comments.min = Math.min(ranges.comments.min, metrics.comments);
        ranges.comments.max = Math.max(ranges.comments.max, metrics.comments);
        
        ranges.repins.min = Math.min(ranges.repins.min, metrics.repins);
        ranges.repins.max = Math.max(ranges.repins.max, metrics.repins);
        
        ranges.reactions.min = Math.min(ranges.reactions.min, metrics.reactions);
        ranges.reactions.max = Math.max(ranges.reactions.max, metrics.reactions);
        
        ranges.shares.min = Math.min(ranges.shares.min, metrics.shares);
        ranges.shares.max = Math.max(ranges.shares.max, metrics.shares);
        
        // Parse date - handle both string dates and timestamps
        if (metrics.createdAt) {
            let timestamp;
            
            // If it's already a number, use it
            if (typeof metrics.createdAt === 'number') {
                timestamp = metrics.createdAt;
            } else {
                // Parse the date string
                timestamp = new Date(metrics.createdAt).getTime();
            }
            
            // Normalize to midnight for date input compatibility
            if (timestamp && !isNaN(timestamp)) {
                const dateOnly = new Date(new Date(timestamp).toISOString().split('T')[0]);
                const normalizedTimestamp = dateOnly.getTime();
                
                ranges.date.min = Math.min(ranges.date.min, normalizedTimestamp);
                ranges.date.max = Math.max(ranges.date.max, normalizedTimestamp);
            }
        }
    }
    
    // Safeguard: If no valid dates found, use sensible defaults
    if (ranges.date.min === Infinity || ranges.date.max === -Infinity) {
        console.warn('PinTwist: No valid dates found in pins, using defaults');
        const now = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1);
        
        ranges.date.min = new Date(oneYearAgo.toISOString().split('T')[0]).getTime();
        ranges.date.max = new Date(now.toISOString().split('T')[0]).getTime();
    }
    
    State.filterRanges = ranges;
    State.activeFilters = JSON.parse(JSON.stringify(ranges)); // Clone
    return ranges;
}

function parseFilterValue(value) {
    if (!value) return null;
    const str = value.toString().toUpperCase();
    if (str.includes('M')) return parseFloat(str) * 1000000;
    if (str.includes('K')) return parseFloat(str) * 1000;
    return parseFloat(str) || 0;
}

function applyFilters() {
    // Safe date parsing - returns fallback if invalid/empty
    const parseDateSafe = (value, fallback) => {
        if (!value) return fallback;
        const d = new Date(value);
        const ts = d.getTime();
        return isNaN(ts) ? fallback : ts;
    };
    
    const filters = {
        saves: {
            min: parseFilterValue(document.getElementById('filter-saves-min').value),
            max: parseFilterValue(document.getElementById('filter-saves-max').value)
        },
        comments: {
            min: parseFilterValue(document.getElementById('filter-comments-min').value),
            max: parseFilterValue(document.getElementById('filter-comments-max').value)
        },
        repins: {
            min: parseFilterValue(document.getElementById('filter-repins-min').value),
            max: parseFilterValue(document.getElementById('filter-repins-max').value)
        },
        reactions: {
            min: parseFilterValue(document.getElementById('filter-reactions-min').value),
            max: parseFilterValue(document.getElementById('filter-reactions-max').value)
        },
        shares: {
            min: parseFilterValue(document.getElementById('filter-shares-min').value),
            max: parseFilterValue(document.getElementById('filter-shares-max').value)
        },
        date: {
            min: parseDateSafe(document.getElementById('filter-date-min').value, 0),
            // Add 24 hours minus 1ms to max date for inclusive end-of-day filtering
            max: parseDateSafe(document.getElementById('filter-date-max').value, Date.now()) + (24 * 60 * 60 * 1000 - 1)
        }
    };
    
    State.activeFilters = filters;
    
    const container = document.getElementById('pintwist-sorted-container');
    if (!container) return;
    
    // Remove existing separator
    document.querySelector('.pintwist-filter-separator')?.remove();
    
    const allPins = Array.from(container.querySelectorAll('.pinterest--block'));
    const matching = [];
    const filtered = [];
    
    allPins.forEach(pin => {
        const pinID = pin.dataset.pinId;
        const metrics = getCached(pinID);
        if (!metrics) return;
        
        const createdTimestamp = new Date(metrics.createdAt).getTime();
        
        const matches = 
            metrics.saves >= filters.saves.min && metrics.saves <= filters.saves.max &&
            metrics.comments >= filters.comments.min && metrics.comments <= filters.comments.max &&
            metrics.repins >= filters.repins.min && metrics.repins <= filters.repins.max &&
            metrics.reactions >= filters.reactions.min && metrics.reactions <= filters.reactions.max &&
            metrics.shares >= filters.shares.min && metrics.shares <= filters.shares.max &&
            createdTimestamp >= filters.date.min && createdTimestamp <= filters.date.max;
        
        const badge = pin.querySelector('.pintwist-legacy-badge');
        
        if (matches) {
            matching.push(pin);
            // Keep red badge
            if (badge) {
                badge.classList.remove('pintwist-badge-grey');
            }
        } else {
            filtered.push(pin);
            // Make badge grey
            if (badge) {
                badge.classList.add('pintwist-badge-grey');
            }
        }
    });
    
    // Sort both sections by current metric
    const sortMetric = State.selectedMetric;
    const sortFn = (a, b) => {
        const pinA = getCached(a.dataset.pinId);
        const pinB = getCached(b.dataset.pinId);
        if (!pinA || !pinB) return 0;
        
        let valueA, valueB;
        if (sortMetric === 'date') {
            valueA = new Date(pinA.createdAt).getTime();
            valueB = new Date(pinB.createdAt).getTime();
        } else {
            const metricMap = { saves: 'saves', comment: 'comments', repin: 'repins', reaction: 'reactions', share: 'shares' };
            const key = metricMap[sortMetric];
            valueA = pinA[key] || 0;
            valueB = pinB[key] || 0;
        }
        
        return valueB - valueA;
    };
    
    matching.sort(sortFn);
    filtered.sort(sortFn);
    
    // Clear container
    container.innerHTML = '';
    
    // Add matching pins
    matching.forEach(p => container.appendChild(p));
    
    // Add separator if there are filtered pins
    if (filtered.length > 0) {
        const separator = document.createElement('div');
        separator.className = 'pintwist-filter-separator';
        separator.innerHTML = `<span>Filtered Results (${filtered.length} pins)</span>`;
        container.appendChild(separator);
        
        // Add filtered pins
        filtered.forEach(p => container.appendChild(p));
    }
    
    // Update count
    const countEl = document.getElementById('pintwist-match-count');
    if (countEl) {
        countEl.innerHTML = `<svg class="sorted-icon" width="14" height="14" viewBox="0 0 24 24" fill="#8e8e8e" style="vertical-align: middle; margin-right: 4px; margin-bottom: 2px;"><path d="M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z"/></svg>${matching.length}/${allPins.length} PINS SORTED BY PINTWIST`;
    }
    
    // Reattach listeners
    reattachListeners();
    
    // Save filters to storage
    chrome.storage.local.set({ pintwist_active_filters: filters });
    
    // Update active filters display
    updateActiveFiltersDisplay();
}

function resetFilters() {
    if (!State.filterRanges) return;
    
    document.getElementById('filter-saves-min').value = State.filterRanges.saves.min;
    document.getElementById('filter-saves-max').value = State.filterRanges.saves.max;
    
    document.getElementById('filter-comments-min').value = State.filterRanges.comments.min;
    document.getElementById('filter-comments-max').value = State.filterRanges.comments.max;
    
    document.getElementById('filter-repins-min').value = State.filterRanges.repins.min;
    document.getElementById('filter-repins-max').value = State.filterRanges.repins.max;
    
    document.getElementById('filter-reactions-min').value = State.filterRanges.reactions.min;
    document.getElementById('filter-reactions-max').value = State.filterRanges.reactions.max;
    
    document.getElementById('filter-shares-min').value = State.filterRanges.shares.min;
    document.getElementById('filter-shares-max').value = State.filterRanges.shares.max;
    
    document.getElementById('filter-date-min').value = new Date(State.filterRanges.date.min).toISOString().split('T')[0];
    document.getElementById('filter-date-max').value = new Date(State.filterRanges.date.max).toISOString().split('T')[0];
    
    // Resize all inputs after reset
    resizeAllFilterInputs();
    
    applyFilters();
}

function resizeAllFilterInputs() {
    document.querySelectorAll('.filter-input').forEach(input => {
        const value = input.value || input.placeholder || '0';
        const length = value.length;
        const width = Math.max(40, Math.min(100, length * 8 + 16));
        input.style.width = width + 'px';
    });
}

function setupFilterBar() {
    const toggleBtn = document.getElementById('pintwist-filter-toggle');
    const filterBar = document.getElementById('pintwist-filter-bar');
    const resetAllBtn = document.getElementById('pintwist-reset-all-filters');
    
    let debounceTimer = null;
    
    // Dynamic input sizing function
    const resizeInput = (input) => {
        const value = input.value || input.placeholder || '0';
        const length = value.length;
        // Calculate width: ~8px per character + padding
        const width = Math.max(40, Math.min(100, length * 8 + 16));
        input.style.width = width + 'px';
    };
    
    // Auto-apply filters with 1 second debounce on all filter inputs
    const allFilterInputs = document.querySelectorAll('.filter-input');
    allFilterInputs.forEach(input => {
        // Initial sizing
        resizeInput(input);
        
        input.addEventListener('input', (e) => {
            // Resize input as user types
            resizeInput(e.target);
            
            // Debounced filter apply
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                applyFilters();
            }, 1000);
        });
        
        // Also apply on Enter key
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(debounceTimer);
                applyFilters();
            }
        });
    });
    
    toggleBtn?.addEventListener('click', () => {
        filterBar.classList.toggle('pintwist-filter-expanded');
        toggleBtn.textContent = filterBar.classList.contains('pintwist-filter-expanded') ? '▼ Filters' : '▶ Filters';
    });
    
    resetAllBtn?.addEventListener('click', resetFilters);
}

function updateActiveFiltersDisplay() {
    if (!State.filterRanges || !State.activeFilters) return;
    
    // Clear all pill containers
    document.querySelectorAll('.filter-pills-container').forEach(container => {
        container.innerHTML = '';
    });
    
    // Helper to check if either min or max has been changed
    const hasChanges = (metric) => {
        const minInput = document.getElementById(`filter-${metric}-min`);
        const maxInput = document.getElementById(`filter-${metric}-max`);
        
        if (!minInput || !maxInput) return false;
        
        if (metric === 'date') {
            // For dates, compare date strings
            const originalMin = new Date(State.filterRanges.date.min).toISOString().split('T')[0];
            const originalMax = new Date(State.filterRanges.date.max).toISOString().split('T')[0];
            
            const minChanged = minInput.value && minInput.value !== originalMin;
            const maxChanged = maxInput.value && maxInput.value !== originalMax;
            
            return minChanged || maxChanged;
        } else {
            // For numbers, parse and compare
            const originalMin = State.filterRanges[metric].min;
            const originalMax = State.filterRanges[metric].max;
            
            // Parse current values
            const currentMinParsed = minInput.value.trim() ? parseFilterValue(minInput.value) : originalMin;
            const currentMaxParsed = maxInput.value.trim() ? parseFilterValue(maxInput.value) : originalMax;
            
            // Check if either changed
            const minChanged = currentMinParsed !== originalMin;
            const maxChanged = currentMaxParsed !== originalMax;
            
            return minChanged || maxChanged;
        }
    };
    
    // Helper to add RESET pill
    const addResetPill = (metric) => {
        const container = document.querySelector(`.filter-pills-container[data-metric="${metric}"]`);
        if (!container) return;
        
        const pillElement = document.createElement('div');
        pillElement.className = 'filter-pill filter-reset-pill';
        pillElement.innerHTML = `
            <div class="filter-pill-remove">×</div>
        `;
        container.appendChild(pillElement);
        
        // Click handler to reset BOTH min and max
        pillElement.querySelector('.filter-pill-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            resetMetricFilter(metric);
        });
    };
    
    // Check each metric and add RESET pill if changed
    const metrics = ['saves', 'comments', 'repins', 'reactions', 'shares', 'date'];
    metrics.forEach(metric => {
        if (hasChanges(metric)) {
            addResetPill(metric);
        }
    });
}

function resetMetricFilter(metric) {
    if (!State.filterRanges) return;
    
    // Reset both min and max inputs to original values
    if (metric === 'date') {
        document.getElementById(`filter-${metric}-min`).value = new Date(State.filterRanges.date.min).toISOString().split('T')[0];
        document.getElementById(`filter-${metric}-max`).value = new Date(State.filterRanges.date.max).toISOString().split('T')[0];
    } else {
        document.getElementById(`filter-${metric}-min`).value = State.filterRanges[metric].min;
        document.getElementById(`filter-${metric}-max`).value = State.filterRanges[metric].max;
    }
    
    // Resize inputs
    resizeAllFilterInputs();
    
    // Reapply filters
    applyFilters();
}

function removeIndividualFilter(metric, bound) {
    if (!State.filterRanges) return;
    
    // Reset the specific filter bound to default
    if (metric === 'date') {
        const inputId = `filter-${metric}-${bound}`;
        const defaultValue = State.filterRanges[metric][bound];
        const input = document.getElementById(inputId);
        input.value = new Date(defaultValue).toISOString().split('T')[0];
        
        // Resize input
        const value = input.value || '0';
        const width = Math.max(40, Math.min(100, value.length * 8 + 16));
        input.style.width = width + 'px';
    } else {
        const inputId = `filter-${metric}-${bound}`;
        const defaultValue = State.filterRanges[metric][bound];
        const input = document.getElementById(inputId);
        input.value = formatNumber(defaultValue);
        
        // Resize input
        const value = input.value || '0';
        const width = Math.max(40, Math.min(100, value.length * 8 + 16));
        input.style.width = width + 'px';
    }
    
    // Re-apply filters with updated values
    applyFilters();
}

// ===== URL MONITORING =====
function startUrlMonitor() {
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    State.urlCheckInterval = setInterval(() => {
        if (window.location.href !== State.currentUrl) handleUrlChange();
    }, 2000);
}
function handleUrlChange() {
    if (window.location.href === State.currentUrl) return;
    State.aborted = true;
    clearState();
    State.currentUrl = window.location.href;

    if (State.currentUrl.includes('pinterest')) setTimeout(init, 1000);
}
function clearState() {
    State.loadedIDs.clear();
    State.processingIDs.clear();
    State.sortedPinIDs.clear();
    State.insertedNodes = [];
    State.count = 0;
    if (State.timeout) clearTimeout(State.timeout);
    if (State.observer) {
        State.observer.disconnect();
        State.observer = null; // Reset so initObserver will create new one
    }
}
// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!location.href.includes('pinterest')) return;
    
    try {
        if (request.action === 'enableBar') {
            // Show the bar
            const existingBar = document.getElementById('pintwist-initial-bar') || 
                               document.getElementById('pintwist-resort-bar');
            if (!existingBar) {
                sort_all();
            }
        } else if (request.action === 'disableBar') {
            // Hide the bar
            hideBar();
        } else if (request.action === 'showOverlays') {
            toggleOverlays(true);
        } else if (request.action === 'hideOverlays') {
            toggleOverlays(false);
        } else if (request.action === 'updateThemeColor') {
            applyThemeColor(request.data);
        }
    } catch (e) {
        console.warn('PinTwist: Message handler error', e);
    }
});

// Function to hide bar
function hideBar() {
    const initialBar = document.getElementById('pintwist-initial-bar');
    const resortBar = document.getElementById('pintwist-resort-bar');
    const filterBar = document.getElementById('pintwist-filter-bar');
    const newGrid = document.getElementById('newgrid');

    if (initialBar) initialBar.remove();
    if (resortBar) resortBar.remove();
    if (filterBar) filterBar.remove();
    if (newGrid) newGrid.remove();

    // Remove content offset when bar is hidden
    removeContentOffset();

    State.aborted = true;
}

// ===== AUTH CHECK =====
const AUTH_KEY = 'pintwist_auth';

async function checkAuth() {
    // Fast path: read cached storage
    try {
        const result = await chrome.storage.local.get(AUTH_KEY);
        const auth = result[AUTH_KEY];
        if (auth?.signedIn) return true;
    } catch {}

    // Fallback: ask background to do a fresh cookie check
    try {
        const response = await chrome.runtime.sendMessage({ type: 'PINTWIST_CHECK_AUTH' });
        return response?.signedIn === true;
    } catch {
        return false;
    }
}

// React to auth changes while Pinterest tab is already open
let initHasRun = false;
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[AUTH_KEY]) return;

    const auth = changes[AUTH_KEY].newValue;
    if (auth?.signedIn) {
        if (!initHasRun) {
            init();
        }
    } else {
        initHasRun = false;
        hideBar();
    }
});

// ===== INIT =====
async function init() {
    if (!location.href.includes('pinterest')) return;
    console.log('PinTwist 1.5.3: Initializing...');

    const authenticated = await checkAuth();
    if (!authenticated) {
        console.log('PinTwist: Not authenticated. Sign in at iscalelabs.com to use PinTwist.');
        return;
    }

    initHasRun = true;
    extractConfig();
    if (!State.metricsCache.size) await loadCache();
    if (!State.urlCheckInterval) startUrlMonitor();

    // ALWAYS start badge system first (independent of bar)
    setTimeout(() => {
        processExisting();
        initObserver();
    }, 1500);

    // Then check if bar should auto-show
    chrome.storage.sync.get(['pintwist_enabled'], (result) => {
        const isEnabled = result.pintwist_enabled !== false; // Default to ON
        if (isEnabled) {
            // Auto-show bar after badges start loading
            setTimeout(() => {
                sort_all();
            }, 2000);
        }
    });
}
window.addEventListener('beforeunload', saveCache);
// document_idle means load may have already fired, so call init() directly
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
} else {
    window.addEventListener('load', init);
}
