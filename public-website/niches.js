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
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr class="clickable" data-term="${esc(r.term)}">
            <td class="col-term">${esc(r.term)}</td>
            <td class="col-num">${fmtNum(r.volume)}</td>
            <td class="col-num">${fmtNum(r.unique_pins)}</td>
            <td class="col-num">${fmtNum(r.reach)}</td>
            <td class="col-num">${fmtNum(r.max_saves)}</td>
            <td class="col-num">${fmtNum(r.avg_saves)}</td>
            <td class="col-num">${fmtNum(r.max_comments)}</td>
            <td class="col-num">${fmtNum(r.max_repins)}</td>
            <td class="col-num">${fmtNum(r.max_reactions)}</td>
            <td class="col-num">${fmtNum(r.max_shares)}</td>
            <td class="col-num">${esc(timeAgo(r.latest_seen))}</td>
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

  host.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => {
      const term = tr.dataset.term;
      if (term) window.location.href = "/trending.html?q=" + encodeURIComponent(term);
    });
  });
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
      document.getElementById("results").innerHTML = `<div class="error">Couldn't load niches (HTTP ${res.status}).</div>`;
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
