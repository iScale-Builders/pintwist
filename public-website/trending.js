// ===== PINTWIST WEB - Trending Page =====

const AUTO_REFRESH_MS = 60_000;
let refreshTimer = null;

const state = {
  query: "",
  sort: "reach",
  window: 7,
  minSaves: 0,
  limit: 40,
  cursor: null,
  items: [],
  exhausted: false,
  loading: false,
  advanced: {
    saves:     { min: null, max: null },
    comments:  { min: null, max: null },
    repins:    { min: null, max: null },
    reactions: { min: null, max: null },
    shares:    { min: null, max: null },
    created:   { min: null, max: null },  // ISO date strings
  },
};

function parseKM(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim().toUpperCase().replace(/,/g, "");
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([KM])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === "K") return Math.round(n * 1000);
  if (m[2] === "M") return Math.round(n * 1_000_000);
  return Math.round(n);
}

const SVG = {
  heart: '<svg xmlns="http://www.w3.org/2000/svg" class="pin-metric-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  comment: '<svg xmlns="http://www.w3.org/2000/svg" class="pin-metric-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/></svg>',
  repin: '<svg xmlns="http://www.w3.org/2000/svg" class="pin-metric-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18 9v4H6V9H4v6h6v5l6-5h4V9h-2z"/></svg>',
  reaction: '<svg xmlns="http://www.w3.org/2000/svg" class="pin-metric-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.536-4.464a.75.75 0 10-1.061-1.061 3.5 3.5 0 01-4.95 0 .75.75 0 00-1.06 1.06 5 5 0 007.07 0zM9 8.5c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S7.448 7 8 7s1 .672 1 1.5zm3 1.5c.552 0 1-.672 1-1.5S12.552 7 12 7s-1 .672-1 1.5.448 1.5 1 1.5z" clip-rule="evenodd"/></svg>',
  share: '<svg xmlns="http://www.w3.org/2000/svg" class="pin-metric-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>',
  users: '<svg xmlns="http://www.w3.org/2000/svg" class="pin-metric-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
};

function fmtNum(n) {
  if (n === null || n === undefined) return "-";
  n = Number(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseSearchTermsFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const q = u.searchParams.get("q");
    if (q) return q.replace(/\+/g, " ");
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "search" && parts[1] === "pins" && parts[2]) return decodeURIComponent(parts[2]);
  } catch {}
  return null;
}

function renderCard(pin) {
  const url = "https://www.pinterest.com/pin/" + encodeURIComponent(pin.pin_id) + "/";
  const img = pin.image_url || null;
  const niche = parseSearchTermsFromUrl(pin.latest_source);
  const title = pin.title || "";
  const domain = pin.domain || "";
  const imgTag = img
    ? `<img class="pin-img" src="${escapeHtml(img)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="pin-img" style="display:flex;align-items:center;justify-content:center;color:var(--gray)">No preview</div>`;
  const dlBtn = img
    ? `<button class="pin-download-btn" type="button" data-img="${escapeHtml(img)}" data-pin-id="${escapeHtml(pin.pin_id)}" title="Download image" aria-label="Download image"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>`
    : "";
  const detailsBtn = `<button class="pin-details-btn" type="button" data-pin-id="${escapeHtml(pin.pin_id)}" title="View snapshot timeline" aria-label="View details"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></button>`;
  const titleLine = title
    ? `<div class="pin-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>`
    : "";
  const domainChip = domain
    ? `<span class="pin-domain" title="External link">↗ ${escapeHtml(domain)}</span>`
    : "";

  return `
    <article class="pin-card">
      <a class="pin-card-link" href="${url}" target="_blank" rel="noopener noreferrer"></a>
      ${imgTag}
      ${dlBtn}
      ${detailsBtn}
      <div class="pin-body">
        ${titleLine}
        <div class="pin-metrics">
          <span class="pin-metric" title="Max saves">${SVG.heart}<strong>${fmtNum(pin.max_saves)}</strong></span>
          <span class="pin-metric" title="Max repins">${SVG.repin}<strong>${fmtNum(pin.max_repins)}</strong></span>
          <span class="pin-metric" title="Max comments">${SVG.comment}<strong>${fmtNum(pin.max_comments)}</strong></span>
          <span class="pin-metric" title="Max reactions">${SVG.reaction}<strong>${fmtNum(pin.max_reactions)}</strong></span>
          <span class="pin-metric" title="Max shares">${SVG.share}<strong>${fmtNum(pin.max_shares)}</strong></span>
        </div>
        <div class="pin-footer">
          <span>${niche ? escapeHtml(niche) : "—"}</span>
          ${domainChip}
          <span class="pin-reach-badge" title="Distinct installs that saw this pin">${SVG.users}${fmtNum(pin.reach)}</span>
        </div>
      </div>
    </article>
  `;
}

function wireDownloadButtons() {
  const host = document.getElementById("results");
  if (!host || host.dataset.dlWired === "1") return;
  host.dataset.dlWired = "1";
  host.addEventListener("click", async (e) => {
    // Details button
    const detailsBtn = e.target.closest(".pin-details-btn");
    if (detailsBtn) {
      e.preventDefault();
      e.stopPropagation();
      openPinDetail(detailsBtn.dataset.pinId);
      return;
    }
    // Download button
    const btn = e.target.closest(".pin-download-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const img = btn.dataset.img;
    const pinId = btn.dataset.pinId;
    if (!img) return;
    btn.disabled = true;
    btn.classList.add("loading");
    try {
      await window.Pintwist.auth.downloadPinImage(img, pinId);
    } finally {
      btn.disabled = false;
      btn.classList.remove("loading");
    }
  });
}

// ===== Pin detail modal =====
async function openPinDetail(pinId) {
  let modal = document.getElementById("pin-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "pin-modal";
    modal.className = "pin-modal";
    modal.innerHTML = `<div class="pin-modal-backdrop"></div><div class="pin-modal-content" role="dialog" aria-modal="true"><button class="pin-modal-close" aria-label="Close">×</button><div class="pin-modal-body"><div class="loading"><div class="spinner"></div>Loading...</div></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector(".pin-modal-backdrop").addEventListener("click", closePinModal);
    modal.querySelector(".pin-modal-close").addEventListener("click", closePinModal);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePinModal(); });
  }
  modal.classList.add("open");
  const body = modal.querySelector(".pin-modal-body");
  body.innerHTML = `<div class="loading"><div class="spinner"></div>Loading snapshot timeline...</div>`;

  try {
    const res = await window.Pintwist.auth.apiFetch("/api/snapshots?pin_id=" + encodeURIComponent(pinId));
    if (!res.ok) {
      body.innerHTML = window.Pintwist.auth.renderApiError(res, "snapshot timeline");
      return;
    }
    const data = await res.json();
    body.innerHTML = renderPinDetail(data);
  } catch (err) {
    console.error("openPinDetail error:", err);
    body.innerHTML = `<div class="error">Network error loading details.</div>`;
  }
}

function closePinModal() {
  const modal = document.getElementById("pin-modal");
  if (modal) modal.classList.remove("open");
}

function renderPinDetail({ pin, snapshots, snapshot_count, reach }) {
  const url = "https://www.pinterest.com/pin/" + encodeURIComponent(pin.pin_id) + "/";
  const img = pin.image_url || null;
  const meta = [
    pin.title && `<h2 class="pin-detail-title">${escapeHtml(pin.title)}</h2>`,
    pin.description && `<p class="pin-detail-desc">${escapeHtml(pin.description)}</p>`,
    pin.alt_text && pin.alt_text !== pin.description && `<p class="pin-detail-alt">Alt: ${escapeHtml(pin.alt_text)}</p>`,
  ].filter(Boolean).join("");

  const facts = [
    pin.link && `<div class="pin-fact"><span class="pin-fact-k">Link</span><a class="pin-fact-v" href="${escapeHtml(pin.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pin.link.length > 80 ? pin.link.slice(0, 80) + "…" : pin.link)}</a></div>`,
    pin.domain && `<div class="pin-fact"><span class="pin-fact-k">Domain</span><span class="pin-fact-v">${escapeHtml(pin.domain)}</span></div>`,
    pin.board_name && `<div class="pin-fact"><span class="pin-fact-k">Board</span><span class="pin-fact-v">${escapeHtml(pin.board_name)}</span></div>`,
    pin.pinner_username && `<div class="pin-fact"><span class="pin-fact-k">Pinner</span><span class="pin-fact-v">@${escapeHtml(pin.pinner_username)}</span></div>`,
    pin.dominant_color && `<div class="pin-fact"><span class="pin-fact-k">Color</span><span class="pin-fact-v"><span class="color-swatch" style="background:${escapeHtml(pin.dominant_color)}"></span>${escapeHtml(pin.dominant_color)}</span></div>`,
    pin.pin_created_at && `<div class="pin-fact"><span class="pin-fact-k">Pinned</span><span class="pin-fact-v">${new Date(pin.pin_created_at).toLocaleDateString()}</span></div>`,
    pin.is_video && `<div class="pin-fact"><span class="pin-fact-k">Type</span><span class="pin-fact-v">Video</span></div>`,
    `<div class="pin-fact"><span class="pin-fact-k">First seen</span><span class="pin-fact-v">${pin.first_seen ? new Date(pin.first_seen).toLocaleString() : "—"}</span></div>`,
    `<div class="pin-fact"><span class="pin-fact-k">Last seen</span><span class="pin-fact-v">${pin.last_seen ? new Date(pin.last_seen).toLocaleString() : "—"}</span></div>`,
  ].filter(Boolean).join("");

  // Build a tiny inline SVG sparkline of saves over time.
  let sparkSvg = "";
  if (snapshots.length >= 2) {
    const values = snapshots.map((s) => s.saves || 0);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const w = 100, h = 24;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    sparkSvg = `<svg class="pin-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  }

  const timelineRows = snapshots.length === 0
    ? `<tr><td colspan="7" style="text-align:center;color:var(--gray)">No snapshots yet</td></tr>`
    : snapshots.map((s) => `
        <tr>
          <td>${new Date(s.seen_at).toLocaleString()}</td>
          <td><code class="pin-install-badge">${escapeHtml(s.install_id_short)}</code></td>
          <td>${fmtNum(s.saves)}</td>
          <td>${fmtNum(s.repins)}</td>
          <td>${fmtNum(s.comments)}</td>
          <td>${fmtNum(s.reactions)}</td>
          <td>${escapeHtml(s.search_terms || "—")}</td>
        </tr>
      `).join("");

  return `
    <div class="pin-detail-grid">
      <div class="pin-detail-image-col">
        ${img ? `<img src="${escapeHtml(img)}" alt="" class="pin-detail-img"/>` : ""}
        <div class="pin-detail-actions">
          <a class="btn btn-secondary" href="${url}" target="_blank" rel="noopener noreferrer">Open on Pinterest ↗</a>
          ${img ? `<button class="btn btn-primary" data-pin-detail-dl data-img="${escapeHtml(img)}" data-pin-id="${escapeHtml(pin.pin_id)}">Download image</button>` : ""}
        </div>
      </div>
      <div class="pin-detail-info-col">
        ${meta || ""}
        <div class="pin-stats-row">
          <span class="pin-stat"><strong>${snapshot_count}</strong> snapshots</span>
          <span class="pin-stat"><strong>${reach}</strong> installs</span>
          ${sparkSvg ? `<span class="pin-stat" title="Saves over time">${sparkSvg}</span>` : ""}
        </div>
        <div class="pin-facts">${facts}</div>
        <h3 class="pin-detail-h3">Snapshot timeline</h3>
        <div class="pin-timeline-wrap">
          <table class="pin-timeline">
            <thead><tr><th>Seen at</th><th>Install</th><th>Saves</th><th>Repins</th><th>Comments</th><th>Reactions</th><th>Search</th></tr></thead>
            <tbody>${timelineRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// Delegate the in-modal download button (re-using the same helper).
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-pin-detail-dl]");
  if (!btn) return;
  e.preventDefault();
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "Downloading…";
  try {
    await window.Pintwist.auth.downloadPinImage(btn.dataset.img, btn.dataset.pinId);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

function renderResults() {
  const host = document.getElementById("results");
  if (!host) return;

  if (state.loading && state.items.length === 0) {
    host.innerHTML = `<div class="loading"><div class="spinner"></div>Loading trending pins...</div>`;
    return;
  }

  if (state.items.length === 0) {
    host.innerHTML = `<div class="empty">No pins match these filters. Try widening the window or lowering the min saves.</div>`;
    return;
  }

  host.innerHTML = `<div class="pin-grid">${state.items.map(renderCard).join("")}</div>`;
  wireDownloadButtons();
}

async function fetchPage({ reset = false } = {}) {
  if (state.loading) return;
  if (reset) {
    state.cursor = null;
    state.items = [];
    state.exhausted = false;
  }
  if (state.exhausted) return;

  state.loading = true;
  renderResults();

  const params = new URLSearchParams({
    q: state.query,
    sort: state.sort,
    days: String(state.window),
    limit: String(state.limit),
  });
  // Chip-level "min saves" (shortcut; advanced overrides if both set)
  if (state.minSaves > 0 && state.advanced.saves.min === null) {
    params.set("min_saves", String(state.minSaves));
  }
  // Advanced per-metric ranges
  for (const m of ["saves", "comments", "repins", "reactions", "shares"]) {
    const { min, max } = state.advanced[m];
    if (min !== null) params.set("min_" + m, String(min));
    if (max !== null) params.set("max_" + m, String(max));
  }
  // Pin creation date range
  if (state.advanced.created.min) params.set("min_pin_created", state.advanced.created.min);
  if (state.advanced.created.max) params.set("max_pin_created", state.advanced.created.max);
  if (state.cursor) params.set("cursor", state.cursor);

  try {
    const res = await window.Pintwist.auth.apiFetch("/api/trending?" + params.toString());
    const loadMoreBtn = document.getElementById("load-more");
    const pagination = document.getElementById("pagination");

    if (res.status === 401) {
      window.Pintwist.auth.gate({ container: document.getElementById("app") });
      return;
    }
    if (!res.ok) {
      host.innerHTML = window.Pintwist.auth.renderApiError(res, "pins");
      if (res.status === 429) setTimeout(() => fetchPage({ reset: true }), 10_000);
      return;
    }
    const body = await res.json();
    const batch = body.items || [];
    state.items = state.items.concat(batch);
    state.cursor = body.next_cursor || null;
    state.exhausted = !state.cursor || batch.length < state.limit;

    renderResults();

    if (pagination) {
      pagination.style.display = state.exhausted ? "none" : "flex";
      if (loadMoreBtn) loadMoreBtn.disabled = state.exhausted;
    }

    // Show/hide seed banner based on reach distribution
    const seedBanner = document.getElementById("seed-banner");
    if (seedBanner) {
      const hasMultiReach = state.items.some((p) => (p.reach || 0) > 1);
      seedBanner.style.display = hasMultiReach ? "none" : "block";
    }
  } catch (err) {
    console.error("fetchPage error:", err);
    const host = document.getElementById("results");
    if (host) host.innerHTML = `<div class="error">Network error. Check your connection and retry.</div>`;
  } finally {
    state.loading = false;
  }
}

function wireFilters() {
  const searchInput = document.getElementById("search-input");
  const sortSelect = document.getElementById("sort-select");
  const windowChips = document.getElementById("window-chips");
  const minSavesChips = document.getElementById("minsaves-chips");
  const loadMore = document.getElementById("load-more");

  let debounce;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.query = e.target.value.trim();
      fetchPage({ reset: true });
    }, 250);
  });

  sortSelect.addEventListener("change", (e) => {
    state.sort = e.target.value;
    fetchPage({ reset: true });
  });

  function handleChips(container, key, castFn) {
    container.addEventListener("click", (e) => {
      const btn = e.target.closest("button.chip");
      if (!btn) return;
      [...container.querySelectorAll(".chip")].forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      state[key] = castFn(btn.dataset[key]);
      fetchPage({ reset: true });
    });
  }
  handleChips(windowChips, "window", Number);
  handleChips(minSavesChips, "minSaves", Number);

  loadMore.addEventListener("click", () => fetchPage());

  // Advanced filters
  const toggleAdv = document.getElementById("toggle-advanced");
  const advPanel = document.getElementById("advanced-filters");
  toggleAdv.addEventListener("click", () => {
    const open = advPanel.style.display !== "none";
    advPanel.style.display = open ? "none" : "block";
    toggleAdv.textContent = (open ? "▶" : "▼") + " Advanced";
    if (!open) toggleAdv.classList.add("active");
    else toggleAdv.classList.remove("active");
  });

  const readAdvancedFilters = () => {
    for (const m of ["saves", "comments", "repins", "reactions", "shares"]) {
      const minEl = document.getElementById("f-" + m + "-min");
      const maxEl = document.getElementById("f-" + m + "-max");
      state.advanced[m] = {
        min: parseKM(minEl.value),
        max: parseKM(maxEl.value),
      };
    }
    const dmin = document.getElementById("f-created-min").value || null;
    const dmax = document.getElementById("f-created-max").value || null;
    state.advanced.created = { min: dmin, max: dmax };
  };

  document.getElementById("btn-apply-adv").addEventListener("click", () => {
    readAdvancedFilters();
    fetchPage({ reset: true });
  });

  document.getElementById("btn-reset-adv").addEventListener("click", () => {
    for (const m of ["saves", "comments", "repins", "reactions", "shares"]) {
      document.getElementById("f-" + m + "-min").value = "";
      document.getElementById("f-" + m + "-max").value = "";
    }
    document.getElementById("f-created-min").value = "";
    document.getElementById("f-created-max").value = "";
    readAdvancedFilters();
    fetchPage({ reset: true });
  });

  // Enter key in any advanced input = apply
  document.querySelectorAll("#advanced-filters .adv-input").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        readAdvancedFilters();
        fetchPage({ reset: true });
      }
    });
  });

  // CSV export: send all current filters + format=csv, with a bigger limit
  const btnExport = document.getElementById("btn-export-csv");
  if (btnExport) {
    btnExport.addEventListener("click", async () => {
      const prev = btnExport.textContent;
      btnExport.disabled = true;
      btnExport.textContent = "⤓ Exporting…";
      try {
        const params = new URLSearchParams({
          q: state.query,
          sort: state.sort,
          days: String(state.window),
          limit: "5000",
          format: "csv",
        });
        if (state.minSaves > 0 && state.advanced.saves.min === null) params.set("min_saves", String(state.minSaves));
        for (const m of ["saves", "comments", "repins", "reactions", "shares"]) {
          const { min, max } = state.advanced[m];
          if (min !== null) params.set("min_" + m, String(min));
          if (max !== null) params.set("max_" + m, String(max));
        }
        if (state.advanced.created.min) params.set("min_pin_created", state.advanced.created.min);
        if (state.advanced.created.max) params.set("max_pin_created", state.advanced.created.max);

        await window.Pintwist.auth.downloadCsv("/api/trending?" + params.toString());
      } catch (err) {
        console.error("CSV export failed:", err);
        alert("CSV export failed: " + err.message);
      } finally {
        btnExport.disabled = false;
        btnExport.textContent = prev;
      }
    });
  }
}

function renderPageShell() {
  const app = document.getElementById("app");
  const tpl = document.getElementById("page-template");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  document.getElementById("topbar-host").outerHTML = window.Pintwist.auth.renderTopbar("trending");
  document.getElementById("pintwist-signout").addEventListener("click", window.Pintwist.auth.signOut);
  window.Pintwist.auth.mountStatsBar("stats-bar-host");
  wireFilters();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    // Auto-refresh only the first page (don't re-paginate), no scroll jump.
    fetchPage({ reset: true });
  }, AUTO_REFRESH_MS);
}

window.addEventListener("load", async () => {
  const allowed = await window.Pintwist.auth.gate({
    container: document.getElementById("app"),
    requireAdmin: true,
    onReady: () => {
      renderPageShell();
      fetchPage({ reset: true });
      startAutoRefresh();
    },
  });
  // gate() handles the redirect/render; if allowed is false, nothing more to do
});
