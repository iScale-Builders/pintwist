// ===== PINTWIST WEB - Niches Page =====

const AUTO_REFRESH_MS = 60_000;
let refreshTimer = null;

const state = {
  query: "",
  sort: "volume",
  window: 30,
  minVolume: 1,
  limit: 60,
  cursor: null,
  items: [],
  exhausted: false,
  loading: false,
};

function fmtNum(n) {
  if (n === null || n === undefined) return "-";
  n = Number(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toString();
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeAgo(iso) {
  if (!iso) return "-";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 30) return d + "d ago";
  const mo = Math.floor(d / 30);
  return mo + "mo ago";
}

function filterClientSide(rows) {
  if (!state.query) return rows;
  const q = state.query.toLowerCase();
  return rows.filter((r) => r.term.includes(q));
}

function renderRows(rows) {
  if (rows.length === 0) {
    return `<div class="empty">No niches match these filters. Try widening the window or lowering min volume.</div>`;
  }
  return `
    <div class="table-scroll">
    <table class="data-table">
      <thead>
        <tr>
          <th>Niche</th>
          <th class="col-num" title="Total pin observations">Volume</th>
          <th class="col-num" title="Distinct pins observed">Pins</th>
          <th class="col-num" title="Distinct installs that searched this">Reach</th>
          <th class="col-num" title="Highest save count among these pins">Max saves</th>
          <th class="col-num" title="Average saves across pins">Avg saves</th>
          <th class="col-num" title="Highest comment count">Max comments</th>
          <th class="col-num" title="Highest repin count">Max repins</th>
          <th class="col-num" title="Highest reaction count">Max reactions</th>
          <th class="col-num" title="Highest share count">Max shares</th>
          <th class="col-num">Last seen</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr data-term="${esc(r.term)}">
            <td class="col-term col-clickable">${esc(r.term)}</td>
            <td class="col-num col-clickable">${fmtNum(r.volume)}</td>
            <td class="col-num col-clickable">${fmtNum(r.unique_pins)}</td>
            <td class="col-num col-clickable">${fmtNum(r.reach)}</td>
            <td class="col-num col-clickable">${fmtNum(r.max_saves)}</td>
            <td class="col-num col-clickable">${fmtNum(r.avg_saves)}</td>
            <td class="col-num col-clickable">${fmtNum(r.max_comments)}</td>
            <td class="col-num col-clickable">${fmtNum(r.max_repins)}</td>
            <td class="col-num col-clickable">${fmtNum(r.max_reactions)}</td>
            <td class="col-num col-clickable">${fmtNum(r.max_shares)}</td>
            <td class="col-num col-clickable">${esc(timeAgo(r.latest_seen))}</td>
            <td class="col-action"><button class="btn-analyze" data-term="${esc(r.term)}" type="button">Analyze</button></td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
    </div>
  `;
}

function renderResults() {
  const host = document.getElementById("results");
  if (!host) return;
  if (state.loading && state.items.length === 0) {
    host.innerHTML = `<div class="loading"><div class="spinner"></div>Loading niches...</div>`;
    return;
  }
  const filtered = filterClientSide(state.items);
  host.innerHTML = renderRows(filtered);

  // Clickable cells (not buttons) navigate to trending filtered by niche
  host.querySelectorAll(".col-clickable").forEach((td) => {
    td.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-term]");
      const term = tr && tr.dataset.term;
      if (term) window.location.href = "/trending.html?q=" + encodeURIComponent(term);
    });
  });

  // Analyze buttons open the AI suggestions modal
  host.querySelectorAll("button.btn-analyze").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSuggestionsModal(btn.dataset.term);
    });
  });
}

// ===== AI Suggestions modal =====

async function openSuggestionsModal(niche) {
  const existing = document.getElementById("suggest-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "suggest-modal";
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal-card modal-wide">
      <div class="modal-header">
        <div>
          <div class="modal-title">Design concepts for <em>${esc(niche)}</em></div>
          <div class="modal-subtitle">Claude analyzes your top trending pins and proposes 3 design directions.</div>
        </div>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body" id="suggest-body">
        <div class="loading"><div class="spinner"></div>Analyzing trending pins with Claude...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  modal.querySelector(".modal-close").addEventListener("click", close);
  document.addEventListener(
    "keydown",
    function onEsc(ev) {
      if (ev.key === "Escape") {
        close();
        document.removeEventListener("keydown", onEsc);
      }
    }
  );

  try {
    const res = await window.Pintwist.auth.apiFetch("/api/suggest", {
      method: "POST",
      body: JSON.stringify({ niche, days: state.window, limit: 20 }),
    });
    const body = document.getElementById("suggest-body");
    if (!body) return;
    if (res.status === 401) {
      body.innerHTML = `<div class="error">Session expired. Please sign in again.</div>`;
      return;
    }
    if (res.status === 403) {
      body.innerHTML = `<div class="error">Admin access required.</div>`;
      return;
    }
    if (res.status === 429) {
      const txt = await res.text();
      const isDaily = /daily/i.test(txt);
      body.innerHTML = `<div class="error">${isDaily ? "Daily AI suggest limit reached (200/day). Try again tomorrow." : "Too many suggest requests (10/min). Wait a minute and try again."}</div>`;
      return;
    }
    if (!res.ok) {
      const txt = await res.text();
      body.innerHTML = `<div class="error">Analysis failed (HTTP ${res.status}). ${esc(txt.slice(0, 200))}</div>`;
      return;
    }
    const data = await res.json();
    body.innerHTML = renderSuggestions(data);
  } catch (err) {
    console.error("suggest fetch error:", err);
    const body = document.getElementById("suggest-body");
    if (body) body.innerHTML = `<div class="error">Network error. Try again.</div>`;
  }
}

function renderSuggestions(d) {
  if (!d || d.pins_analyzed === 0) {
    return `<div class="empty">${esc(d?.pattern_summary || "No data to analyze.")}</div>`;
  }
  const concepts = Array.isArray(d.concepts) ? d.concepts : [];
  return `
    <div class="suggest-meta">
      <span class="chip chip-primary">${esc(d.pins_analyzed)} pins analyzed</span>
      <span class="chip">${esc(d.days)}d window</span>
      <span class="chip">model: ${esc(d.model || "sonnet")}</span>
      ${d.elapsed_ms ? `<span class="chip">${esc(Math.round(d.elapsed_ms / 100) / 10)}s</span>` : ""}
    </div>
    <div class="suggest-summary">
      <div class="suggest-label">Pattern summary</div>
      <div class="suggest-summary-text">${esc(d.pattern_summary || "")}</div>
    </div>
    <div class="suggest-concepts">
      ${concepts
        .map(
          (c) => `
        <div class="suggest-concept">
          <div class="suggest-concept-header">
            <div class="suggest-concept-title">${esc(c.title || "(untitled)")}</div>
            <div class="suggest-conf" title="Confidence 1-10">
              <div class="suggest-conf-bar"><div class="suggest-conf-fill" style="width:${Math.max(0, Math.min(100, (Number(c.confidence) || 0) * 10))}%"></div></div>
              <span class="suggest-conf-num">${esc(c.confidence ?? "?")}/10</span>
            </div>
          </div>
          <div class="suggest-field">
            <span class="suggest-field-label">Theme</span>
            <span class="suggest-field-val">${esc(c.theme || "")}</span>
          </div>
          <div class="suggest-field">
            <span class="suggest-field-label">Visual direction</span>
            <span class="suggest-field-val">${esc(c.visual_direction || "")}</span>
          </div>
          <div class="suggest-field">
            <span class="suggest-field-label">Target audience</span>
            <span class="suggest-field-val">${esc(c.target_audience || "")}</span>
          </div>
          ${
            Array.isArray(c.signal_pins) && c.signal_pins.length
              ? `<div class="suggest-field">
                  <span class="suggest-field-label">Signal pins</span>
                  <span class="suggest-field-val">${c.signal_pins
                    .map(
                      (id) =>
                        `<a href="https://www.pinterest.com/pin/${encodeURIComponent(id)}/" target="_blank" rel="noopener noreferrer" class="signal-pin-link">${esc(id)}</a>`
                    )
                    .join(" ")}</span>
                </div>`
              : ""
          }
        </div>
      `
        )
        .join("")}
    </div>
  `;
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
    sort: state.sort,
    days: String(state.window),
    min_volume: String(state.minVolume),
    limit: String(state.limit),
  });
  if (state.cursor) params.set("cursor", state.cursor);

  try {
    const res = await window.Pintwist.auth.apiFetch("/api/niches?" + params.toString());
    const pagination = document.getElementById("pagination");
    const loadMore = document.getElementById("load-more");

    if (res.status === 401) {
      window.Pintwist.auth.gate({ container: document.getElementById("app") });
      return;
    }
    if (!res.ok) {
      document.getElementById("results").innerHTML = window.Pintwist.auth.renderApiError(res, "niches");
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
      if (loadMore) loadMore.disabled = state.exhausted;
    }
  } catch (err) {
    console.error("niches fetch error:", err);
    document.getElementById("results").innerHTML = `<div class="error">Network error.</div>`;
  } finally {
    state.loading = false;
  }
}

function wireFilters() {
  const searchInput = document.getElementById("search-input");
  const sortSelect = document.getElementById("sort-select");
  const windowChips = document.getElementById("window-chips");
  const minvolChips = document.getElementById("minvol-chips");
  const loadMore = document.getElementById("load-more");

  let debounce;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.query = e.target.value.trim().toLowerCase();
      renderResults();
    }, 150);
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
  handleChips(minvolChips, "minVolume", Number);

  loadMore.addEventListener("click", () => fetchPage());

  const btnExport = document.getElementById("btn-export-csv");
  if (btnExport) {
    btnExport.addEventListener("click", async () => {
      const prev = btnExport.textContent;
      btnExport.disabled = true;
      btnExport.textContent = "⤓ Exporting…";
      try {
        const params = new URLSearchParams({
          sort: state.sort,
          days: String(state.window),
          min_volume: String(state.minVolume),
          limit: "5000",
          format: "csv",
        });
        await window.Pintwist.auth.downloadCsv("/api/niches?" + params.toString());
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
  document.getElementById("topbar-host").outerHTML = window.Pintwist.auth.renderTopbar("niches");
  document.getElementById("pintwist-signout").addEventListener("click", window.Pintwist.auth.signOut);
  window.Pintwist.auth.mountStatsBar("stats-bar-host");
  wireFilters();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    fetchPage({ reset: true });
  }, AUTO_REFRESH_MS);
}

window.addEventListener("load", async () => {
  await window.Pintwist.auth.gate({
    container: document.getElementById("app"),
    requireAdmin: true,
    onReady: () => {
      renderPageShell();
      fetchPage({ reset: true });
      startAutoRefresh();
    },
  });
});
