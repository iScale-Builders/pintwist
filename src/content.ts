// ===== PINTWIST 1.5.3 - PERFORMANCE OPTIMIZED =====
// 35 Concurrent Requests | 40ms Delays | 2x Retry Safety | Maximum Speed
// Safe & Fast: 50-75% faster while avoiding rate limits

// ===== TYPE DEFINITIONS =====
interface PinConfig {
  appVersion: string | null;
  experimentHash: string | null;
  handlerId: string | null;
  origin: string;
  path: string;
  initialized: boolean;
}

interface PinMetrics {
  pinID: string;
  saves: number;
  reactions: number;
  shares: number;
  repins: number;
  comments: number;
  createdAt: string | null;
  imageUrl: string | null;
  isVideo: boolean;
  fetchFailed: boolean;
  timestamp?: number;
}

interface FilterRange {
  min: number;
  max: number;
}

interface FilterRanges {
  saves: FilterRange;
  comments: FilterRange;
  repins: FilterRange;
  reactions: FilterRange;
  shares: FilterRange;
  date: FilterRange;
}

interface AppState {
  metricsCache: Map<string, PinMetrics>;
  loadedIDs: Set<string>;
  processingIDs: Set<string>;
  sortedPinIDs: Set<string>;
  insertedNodes: Node[];
  selectedMetric: string;
  count: number;
  timeout: ReturnType<typeof setTimeout> | null;
  observer: MutationObserver | null;
  currentUrl: string;
  urlCheckInterval: ReturnType<typeof setInterval> | null;
  aborted: boolean;
  inFlightRequests: Map<string, Promise<PinMetrics | null>>;
  filterRanges: FilterRanges | null;
  activeFilters: FilterRanges | null;
  pagesToLoad?: number;
}

interface MessageRequest {
  action: string;
  data?: string;
}

interface FetchResponse {
  success: boolean;
  data?: unknown;
  pinID?: string;
  error?: string;
  status?: number;
}

// Extend Window interface for global function
declare global {
  interface Window {
    sort_all: () => Promise<void>;
  }
}

// ===== CONSTANTS =====
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ===== PINTEREST CONFIG (Cached) =====
const CONFIG: PinConfig = {
  appVersion: null,
  experimentHash: null,
  handlerId: null,
  origin: 'https://www.pinterest.com',
  path: '/',
  initialized: false,
};

// ===== STATE =====
const State: AppState = {
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

// ===== SOFT PINK ICONS =====
const ICONS: Record<string, string> = {
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

// ===== METRIC MAP =====
const _METRIC_MAP: Record<string, string> = {
  saves: 'saves',
  share: 'shares',
  reaction: 'reactions',
  repin: 'repins',
  comment: 'comments',
};

// ===== UTILITY FUNCTIONS =====
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Escape HTML attribute values to prevent XSS
function escapeAttr(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNumber(num: number): string {
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

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Unknown';
  }
}

function getDaysAgo(dateStr: string): string {
  try {
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days === 0) return 'TODAY';
    if (days === 1) return 'YESTERDAY';
    if (days < 7) return `${days}D`;
    if (days < 30) return `${Math.floor(days / 7)}W`;
    if (days < 365) return `${Math.floor(days / 30)}MO`;
    return `${Math.floor(days / 365)}Y`;
  } catch {
    return 'UNKNOWN';
  }
}

// ===== CONFIG EXTRACTION =====
function extractConfig(): PinConfig {
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
  } catch {
    CONFIG.appVersion = 'c7cbc61';
    CONFIG.experimentHash = '';
    CONFIG.handlerId = 'www/index.js';
  }
  CONFIG.initialized = true;
  return CONFIG;
}

function getFreshConfig(): {
  appVersion: string;
  experimentHash: string;
  handlerId: string;
  path: string;
  origin: string;
} {
  if (!CONFIG.initialized) extractConfig();
  return {
    appVersion: CONFIG.appVersion || 'c7cbc61',
    experimentHash: CONFIG.experimentHash || '',
    handlerId: CONFIG.handlerId || 'www/index.js',
    path: window.location.pathname || CONFIG.path,
    origin: window.location.origin || CONFIG.origin,
  };
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : null;
}

// ===== CACHE MANAGEMENT =====
async function saveCache(): Promise<void> {
  try {
    const MAX_SIZE = 2000;
    if (State.metricsCache.size > MAX_SIZE) {
      const entries = [...State.metricsCache.entries()];
      entries.slice(0, entries.length - MAX_SIZE).forEach(([k]) => State.metricsCache.delete(k));
    }
    await chrome.storage.local.set({
      pintwist_cache: Object.fromEntries(State.metricsCache),
    });
  } catch (e) {
    console.warn('PinTwist: Cache save failed', e);
  }
}

async function loadCache(): Promise<void> {
  try {
    const result = await chrome.storage.local.get('pintwist_cache');
    const pintwist_cache = result.pintwist_cache;
    if (pintwist_cache) {
      State.metricsCache = new Map(Object.entries(pintwist_cache));
      console.log(`PinTwist: Loaded ${State.metricsCache.size} cached pins`);
    }
  } catch (e) {
    console.warn('PinTwist: Cache load failed', e);
  }
}

function getCached(pinID: string): PinMetrics | null {
  const cached = State.metricsCache.get(pinID);
  if (cached && typeof cached.timestamp === 'number' && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached;
  }
  if (cached) State.metricsCache.delete(pinID);
  return null;
}

function setCache(pinID: string, metrics: PinMetrics): void {
  metrics.timestamp = Date.now();
  State.metricsCache.set(pinID, metrics);
  State.loadedIDs.add(pinID);
  if (State.metricsCache.size % 20 === 0) saveCache();
}

// ===== BULK DATA FETCHING (OPTIMIZED) =====
async function fetchBulk(pinIDs: string[]): Promise<Map<string, PinMetrics>> {
  if (!pinIDs.length) return new Map();
  const results = new Map<string, PinMetrics>();

  // Get cached first (instant)
  const uncached: string[] = [];
  pinIDs.forEach((id) => {
    const cached = getCached(id);
    if (cached) {
      results.set(id, cached);
    } else {
      uncached.push(id);
    }
  });

  if (!uncached.length) return results;

  // Fetch uncached pins
  const CHUNK_SIZE = 35;
  const CHUNK_DELAY = 40;
  const MAX_RETRIES = 2;

  for (let i = 0; i < uncached.length; i += CHUNK_SIZE) {
    const chunk = uncached.slice(i, i + CHUNK_SIZE);
    const promises = chunk.map(async (pinID) => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = (await chrome.runtime.sendMessage({
            action: 'fetchPinData',
            pinID,
            config: getFreshConfig(),
            csrfToken: getCsrfToken(),
          })) as FetchResponse;
          if (response?.success && response.data) {
            const metrics = extractMetrics(response.data, pinID);
            setCache(pinID, metrics);
            return { pinID, metrics };
          }
        } catch {
          if (attempt < MAX_RETRIES) {
            await sleep(1000);
            continue;
          }
        }
        break;
      }
      return null;
    });

    const chunkResults = await Promise.all(promises);
    chunkResults.forEach((r) => {
      if (r) results.set(r.pinID, r.metrics);
    });

    if (i + CHUNK_SIZE < uncached.length) {
      await sleep(CHUNK_DELAY);
    }
  }
  return results;
}

async function _fetchSingle(pinID: string): Promise<PinMetrics | null> {
  const cached = getCached(pinID);
  if (cached) return cached;

  if (State.inFlightRequests.has(pinID)) {
    return State.inFlightRequests.get(pinID) || null;
  }

  const promise = (async (): Promise<PinMetrics | null> => {
    const MAX_RETRIES = 2;

    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = (await chrome.runtime.sendMessage({
            action: 'fetchPinData',
            pinID,
            config: getFreshConfig(),
            csrfToken: getCsrfToken(),
          })) as FetchResponse;
          if (response?.success && response.data) {
            const metrics = extractMetrics(response.data, pinID);
            setCache(pinID, metrics);
            return metrics;
          }
        } catch {
          if (attempt < MAX_RETRIES) {
            await sleep(1000);
            continue;
          }
          console.error(`PinTwist: Fetch failed for ${pinID} after ${MAX_RETRIES + 1} attempts`);
        }
      }
      return null;
    } finally {
      State.inFlightRequests.delete(pinID);
    }
  })();

  State.inFlightRequests.set(pinID, promise);
  return promise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMetrics(data: any, pinID: string): PinMetrics {
  if (!data)
    return {
      pinID,
      saves: 0,
      reactions: 0,
      shares: 0,
      repins: 0,
      comments: 0,
      createdAt: null,
      imageUrl: null,
      isVideo: false,
      fetchFailed: true,
    };

  const isVideo = !!(
    data?.videos ||
    data?.story_pin_data?.pages?.[0]?.blocks?.[0]?.video ||
    data?.is_video
  );

  let imageUrl: string | null = null;

  // Helper to find URL in image object
  const findImageUrl = (images: Record<string, { url?: string }>): string | null => {
    const values = Object.values(images) as { url?: string }[];
    const found = values.find((img) => img?.url);
    return found?.url || null;
  };

  // Standard image locations
  if (data?.images) {
    imageUrl =
      data.images.orig?.url ||
      data.images['1200x']?.url ||
      data.images['736x']?.url ||
      data.images['564x']?.url ||
      data.images['474x']?.url ||
      data.images['236x']?.url ||
      findImageUrl(data.images) ||
      null;
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
        imageUrl = imgs.orig?.url || imgs['1200x']?.url || findImageUrl(imgs) || null;
        if (imageUrl) break;
      }
      if (page?.blocks) {
        for (const block of page.blocks) {
          if (block?.image?.images) {
            const imgs = block.image.images;
            imageUrl = imgs.orig?.url || findImageUrl(imgs) || null;
            if (imageUrl) break;
          }
          if (block?.video?.video_list) {
            const videoValues = Object.values(block.video.video_list) as { thumbnail?: string }[];
            for (const v of videoValues) {
              if (v?.thumbnail) {
                imageUrl = v.thumbnail;
                break;
              }
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
        imageUrl = slot.images.orig?.url || findImageUrl(slot.images) || null;
        if (imageUrl) break;
      }
    }
  }

  // Closeup image
  if (!imageUrl && data?.closeup_unified_description?.images) {
    const imgs = data.closeup_unified_description.images;
    imageUrl = imgs.orig?.url || findImageUrl(imgs) || null;
  }

  // Pin image signature fallback
  if (!imageUrl && data?.image_signature) {
    imageUrl = `https://i.pinimg.com/originals/${data.image_signature.slice(0, 2)}/${data.image_signature.slice(2, 4)}/${data.image_signature.slice(4, 6)}/${data.image_signature}.jpg`;
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
    fetchFailed: false,
  };
}

// ===== OVERLAY CREATION =====
function createOverlayHTML(metrics: PinMetrics): string {
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

function createLoadingHTML(): string {
  return `
        <div class="pintwist-metrics-overlay pintwist-loading-state" data-pintwist="placeholder">
            <div class="pintwist-metrics-column">
                ${[...Array(6)]
                  .map(
                    () => `
                    <div class="pintwist-metric-item pintwist-skeleton">
                        <div class="pintwist-metric-icon pintwist-skeleton-icon"></div>
                        <span class="pintwist-metric-value pintwist-skeleton-text"></span>
                    </div>
                `
                  )
                  .join('')}
            </div>
        </div>
    `;
}

// ===== DOWNLOAD =====
function downloadImage(pinID: string, imageUrl: string, button: HTMLButtonElement): void {
  if (!imageUrl) return;
  const text = button.querySelector('.pintwist-download-text') as HTMLElement;
  const loader = button.querySelector('.pintwist-download-loader') as HTMLElement;
  const icon = button.querySelector('.pintwist-download-icon') as HTMLElement;
  if (text) text.style.display = 'none';
  if (icon) icon.style.display = 'none';
  if (loader) loader.style.display = 'inline';
  button.disabled = true;
  chrome.runtime.sendMessage(
    {
      action: 'downloadImage',
      url: imageUrl,
      filename: `pinterest_${pinID}_${Date.now()}`,
    },
    () => {
      setTimeout(() => {
        if (text) text.style.display = 'inline';
        if (icon) icon.style.display = 'inline';
        if (loader) loader.style.display = 'none';
        button.disabled = false;
      }, 1500);
    }
  );
}

// ===== BULK PIN PROCESSING =====
async function processPinsBulk(elements: Element[]): Promise<void> {
  const toFetch: { pinID: string; element: Element }[] = [];
  elements.forEach((el) => {
    if (el.querySelector('[data-pintwist="overlay"]')) return;
    const pinID = el.getAttribute('data-test-pin-id');
    if (!pinID || State.processingIDs.has(pinID)) return;
    State.processingIDs.add(pinID);
    el.insertAdjacentHTML('beforeend', createLoadingHTML());
    toFetch.push({ pinID, element: el });
  });
  if (!toFetch.length) return;
  const results = await fetchBulk(toFetch.map((p) => p.pinID));
  toFetch.forEach(({ pinID, element }) => {
    const placeholder = element.querySelector('[data-pintwist="placeholder"]');
    if (placeholder) placeholder.remove();
    const metrics = results.get(pinID);
    if (metrics) {
      element.insertAdjacentHTML('beforeend', createOverlayHTML(metrics));
      const btn = element.querySelector('.pintwist-download-btn') as HTMLButtonElement;
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          downloadImage(pinID, btn.dataset.imageUrl || '', btn);
        });
      }
    }
    State.processingIDs.delete(pinID);
  });
}

// ===== MUTATION OBSERVER =====
function initObserver(): void {
  if (State.observer) State.observer.disconnect();
  let pending: Element[] = [];
  let debounce: ReturnType<typeof setTimeout> | null = null;
  State.observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        const el = node as Element;
        if (el.hasAttribute?.('data-test-pin-id')) pending.push(el);
        if (el.querySelectorAll) pending.push(...el.querySelectorAll('[data-test-pin-id]'));
      });
    });
    if (pending.length) {
      if (debounce) clearTimeout(debounce);
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

function processExisting(): void {
  const pins = document.querySelectorAll('[data-test-pin-id]');
  console.log(`PinTwist: Found ${pins.length} existing pins to process`);
  processPinsBulk(Array.from(pins));

  setTimeout(() => {
    const newPins = document.querySelectorAll('[data-test-pin-id]');
    console.log(`PinTwist: Retry found ${newPins.length} total pins`);
    processPinsBulk(Array.from(newPins));
  }, 2000);
}

// ===== SMART SCROLL DETECTION =====
async function _waitForNewPins(prevCount: number): Promise<boolean> {
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
  const finalCount = document.querySelectorAll('[data-test-pin-id]').length;
  return finalCount > prevCount;
}

// Toggle left-side metrics overlays visibility
function toggleOverlays(show: boolean): void {
  const overlays = document.querySelectorAll('.pintwist-metrics-overlay');
  overlays.forEach((overlay) => {
    (overlay as HTMLElement).style.display = show ? '' : 'none';
  });
}

// Adjust Pinterest content padding to prevent bar overlap on pin detail pages
function adjustPinterestPadding(): void {
  const isPinDetailPage = window.location.pathname.includes('/pin/');
  const container = document.querySelector('[data-test-id="masonry-container"]') as HTMLElement;
  const pinDetail = document.querySelector('[data-test-id="pin-closeup-page"]') as HTMLElement;

  if (isPinDetailPage && (container || pinDetail)) {
    const targetElement = pinDetail || container;
    targetElement.style.paddingTop = '80px';
  } else if (container) {
    container.style.paddingTop = '';
  }
}

// Toggle top-right metric badges visibility
function _toggleBadges(show: boolean): void {
  const badges = document.querySelectorAll('.pintwist-legacy-badge');
  badges.forEach((badge) => {
    (badge as HTMLElement).style.display = show ? '' : 'none';
  });
}

// Apply theme color to all themed elements
function applyThemeColor(color: string): void {
  const darkerColor = adjustColorBrightness(color, -20);

  document.documentElement.style.setProperty('--pintwist-primary', color);
  document.documentElement.style.setProperty('--pintwist-primary-dark', darkerColor);

  document.querySelectorAll('.pintwist-themed-fill').forEach((el) => {
    (el as HTMLElement).style.fill = color;
  });

  document.querySelectorAll('.pintwist-legacy-badge').forEach((el) => {
    const element = el as HTMLElement;
    if (!element.classList.contains('pintwist-badge-grey')) {
      element.style.borderColor = color;
      element.style.color = color;
      element.style.background = 'rgba(255, 255, 255, 0.9)';
    }
  });

  const resortBar = document.getElementById('pintwist-resort-bar');
  if (resortBar) {
    resortBar.style.borderBottomColor = color;
  }

  const filterBar = document.getElementById('pintwist-filter-bar');
  if (filterBar) {
    filterBar.style.borderBottomColor = color;
  }

  const initialBar = document.getElementById('pintwist-initial-bar');
  if (initialBar) {
    initialBar.style.borderBottomColor = color;

    const sortBtn = document.getElementById('pintwist-sort-pins-btn');
    if (sortBtn) {
      sortBtn.style.background = color;
    }

    const checkbox = document.getElementById('pintwist-show-overlays') as HTMLInputElement;
    if (checkbox) {
      checkbox.style.accentColor = color;
    }
  }
}

// Helper to darken/lighten a hex color
function adjustColorBrightness(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));
  return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

// ===== URL MONITORING =====
function startUrlMonitor(): void {
  window.addEventListener('popstate', handleUrlChange);
  window.addEventListener('hashchange', handleUrlChange);
  State.urlCheckInterval = setInterval(() => {
    if (window.location.href !== State.currentUrl) handleUrlChange();
  }, 2000);
}

function handleUrlChange(): void {
  if (window.location.href === State.currentUrl) return;
  State.aborted = true;
  clearState();
  State.currentUrl = window.location.href;

  adjustPinterestPadding();

  if (State.currentUrl.includes('pinterest')) setTimeout(init, 1000);
}

function clearState(): void {
  State.loadedIDs.clear();
  State.processingIDs.clear();
  State.sortedPinIDs.clear();
  State.insertedNodes = [];
  State.count = 0;
  if (State.timeout) clearTimeout(State.timeout);
  if (State.observer) {
    State.observer.disconnect();
    State.observer = null;
  }
}

// Function to hide bar
function hideBar(): void {
  const initialBar = document.getElementById('pintwist-initial-bar');
  const resortBar = document.getElementById('pintwist-resort-bar');
  const filterBar = document.getElementById('pintwist-filter-bar');
  const newGrid = document.getElementById('newgrid');

  if (initialBar) initialBar.remove();
  if (resortBar) resortBar.remove();
  if (filterBar) filterBar.remove();
  if (newGrid) newGrid.remove();

  State.aborted = true;
}

// ===== MESSAGE LISTENER =====
chrome.runtime.onMessage.addListener(
  (
    request: MessageRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: { success: boolean; reason?: string; error?: string }) => void
  ) => {
    if (!location.href.includes('pinterest')) {
      sendResponse({ success: false, reason: 'not pinterest' });
      return true;
    }

    try {
      if (request.action === 'enableBar') {
        const existingBar =
          document.getElementById('pintwist-initial-bar') ||
          document.getElementById('pintwist-resort-bar');
        if (!existingBar) {
          window.sort_all();
        }
      } else if (request.action === 'disableBar') {
        hideBar();
      } else if (request.action === 'showOverlays') {
        toggleOverlays(true);
      } else if (request.action === 'hideOverlays') {
        toggleOverlays(false);
      } else if (request.action === 'updateThemeColor' && request.data) {
        applyThemeColor(request.data);
      }
      sendResponse({ success: true });
    } catch (e) {
      console.warn('PinTwist: Message handler error', e);
      sendResponse({ success: false, error: (e as Error).message });
    }
    return true;
  }
);

// ===== INIT =====
async function init(): Promise<void> {
  if (!location.href.includes('pinterest')) return;
  console.log('PinTwist 1.5.3: Initializing...');
  extractConfig();
  if (!State.metricsCache.size) await loadCache();
  if (!State.urlCheckInterval) startUrlMonitor();

  setTimeout(() => {
    processExisting();
    initObserver();
  }, 1500);

  chrome.storage.sync.get(['pintwist_enabled'], (result) => {
    const isEnabled = result.pintwist_enabled !== false;
    if (isEnabled) {
      setTimeout(() => {
        window.sort_all();
      }, 2000);
    }
  });
}

// ===== SORT PANEL =====
// WARNING: This TypeScript version is INCOMPLETE!
// The full implementation exists in js/content.js (lines 541-1200+).
// DO NOT compile this to JavaScript until the full implementation is ported.
//
// Missing functions that need to be ported from js/content.js:
// - setupInitialBarEvents() - lines 654-733
// - startSortingProcess() - lines 735-908
// - showSortedBar() / finishSort() - lines 910-1200+
// - calculateFilterRanges()
// - setupFilterBar()
// - All filter bar event handlers
//
// The working extension uses js/content.js directly.
// This TypeScript file is a work-in-progress for type safety.

window.sort_all = async function (): Promise<void> {
  // STUB: See js/content.js for the full implementation
  console.warn('PinTwist: sort_all stub called. Full implementation is in js/content.js');

  document.getElementById('sort-panel')?.remove();
  document.getElementById('pintwist-initial-bar')?.remove();
  document.getElementById('pintwist-sorted-container')?.remove();

  State.aborted = false;

  // Basic pin processing - the full version creates the initial bar UI
  const pins = document.querySelectorAll('[data-test-pin-id]');
  if (pins.length > 0) {
    await processPinsBulk(Array.from(pins));
  }
};

window.addEventListener('beforeunload', saveCache);
window.onload = init;

// Empty export to make this a module (required for declare global)
export {};
