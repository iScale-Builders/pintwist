// ===== PINTWIST WEB - Insights Page =====

const AUTO_REFRESH_MS = 120_000;
let refreshTimer = null;

const state = {
  window: 30,
  loading: false,
  data: null,
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

function fmtGrowth(ratio, thisWeek, prevWeek) {
  if (prevWeek === 0 && thisWeek > 0) {
    return `<span class="growth-new">NEW · ${thisWeek} pin${thisWeek === 1 ? "" : "s"}</span>`;
  }
  if (ratio >= 1.25) {
    return `<span class="growth-up">&uarr; ${ratio.toFixed(2)}&times;</span>`;
  }
  return `<span class="growth-flat">${ratio.toFixed(2)}&times;</span>`;
}

function renderCrossNiche(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="empty">Not enough cross-niche signal yet. Needs pins observed under multiple search terms.</div>`;
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Niche pair</th>
          <th class="col-num">Shared pins</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr>
            <td class="col-pair">
              <a href="/trending.html?q=${encodeURIComponent(r.term_a)}">${esc(r.term_a)}</a>
              <span class="sep">&times;</span>
              <a href="/trending.html?q=${encodeURIComponent(r.term_b)}">${esc(r.term_b)}</a>
            </td>
            <td class="col-num"><strong>${fmtNum(r.shared_pins)}</strong></td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderMomentum(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="empty">Not enough weekly data yet. Needs at least two weeks of pin observations.</div>`;
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Niche</th>
          <th class="col-num">This week</th>
          <th class="col-num">Prev week</th>
          <th class="col-num">Growth</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr class="clickable" data-term="${esc(r.term)}">
            <td class="col-term">${esc(r.term)}</td>
            <td class="col-num">${fmtNum(r.pins_this_week)}</td>
            <td class="col-num">${fmtNum(r.pins_prev_week)}</td>
            <td class="col-num">${fmtGrowth(r.growth_ratio, r.pins_this_week, r.pins_prev_week)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderVelocity(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="empty">No velocity data yet. Needs niches with multiple pins and save counts.</div>`;
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Niche</th>
          <th class="col-num">Pins</th>
          <th class="col-num">Avg saves</th>
          <th class="col-num">Max saves</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr class="clickable" data-term="${esc(r.term)}">
            <td class="col-term">${esc(r.term)}</td>
            <td class="col-num">${fmtNum(r.unique_pins)}</td>
            <td class="col-num"><strong>${fmtNum(r.avg_saves)}</strong></td>
            <td class="col-num">${fmtNum(r.max_saves)}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function wireRowClicks(host) {
  host.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.addEventListener("click", () => {
      const term = tr.dataset.term;
      if (term) window.location.href = "/trending.html?q=" + encodeURIComponent(term);
    });
  });
}

function renderResults() {
  const host = document.getElementById("insights-root");
  if (!host) return;

  if (state.loading) {
    host.innerHTML = `<div class="loading"><div class="spinner"></div>Computing insights...</div>`;
    return;
  }
  if (!state.data) {
    host.innerHTML = `<div class="error">No data loaded.</div>`;
    return;
  }

  const d = state.data;

  host.innerHTML = `
    <div class="insight-grid">
      <section class="insight-block">
        <div class="insight-header">
          <div class="insight-title">Cross-niche overlap</div>
          <div class="insight-subtitle">Niche pairs that share pins. Signal of cross-pollination — one design can target multiple audiences.</div>
        </div>
        ${renderCrossNiche(d.cross_niche)}
      </section>

      <section class="insight-block">
        <div class="insight-header">
          <div class="insight-title">Momentum (week over week)</div>
          <div class="insight-subtitle">Niches with growing unique-pin counts. Rising = Pinterest is amplifying; early entry window.</div>
        </div>
        ${renderMomentum(d.momentum)}
      </section>

      <section class="insight-block">
        <div class="insight-header">
          <div class="insight-title">Demand density (velocity)</div>
          <div class="insight-subtitle">Niches with highest average saves per pin. High density = hungry audience, but watch for saturation.</div>
        </div>
        ${renderVelocity(d.velocity)}
      </section>
    </div>
  `;

  wireRowClicks(host);
}

async function fetchInsights() {
  if (state.loading) return;
  state.loading = true;
  renderResults();

  try {
    const res = await window.Pintwist.auth.apiFetch("/api/insights?days=" + state.window);
    if (res.status === 401) {
      window.Pintwist.auth.gate({ container: document.getElementById("app") });
      return;
    }
    if (!res.ok) {
      document.getElementById("insights-root").innerHTML = window.Pintwist.auth.renderApiError(res, "insights");
      if (res.status === 429) setTimeout(() => fetchInsights(), 10_000);
      return;
    }
    state.data = await res.json();
  } catch (err) {
    console.error("insights fetch error:", err);
    document.getElementById("insights-root").innerHTML = `<div class="error">Network error.</div>`;
  } finally {
    state.loading = false;
    renderResults();
  }
}

function wireFilters() {
  const windowChips = document.getElementById("window-chips");
  windowChips.addEventListener("click", (e) => {
    const btn = e.target.closest("button.chip");
    if (!btn) return;
    [...windowChips.querySelectorAll(".chip")].forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    state.window = Number(btn.dataset.window);
    fetchInsights();
  });
}

function renderPageShell() {
  const app = document.getElementById("app");
  const tpl = document.getElementById("page-template");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  document.getElementById("topbar-host").outerHTML = window.Pintwist.auth.renderTopbar("insights");
  document.getElementById("pintwist-signout").addEventListener("click", window.Pintwist.auth.signOut);
  window.Pintwist.auth.mountStatsBar("stats-bar-host");
  wireFilters();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    fetchInsights();
  }, AUTO_REFRESH_MS);
}

window.addEventListener("load", async () => {
  await window.Pintwist.auth.gate({
    container: document.getElementById("app"),
    requireAdmin: true,
    onReady: () => {
      renderPageShell();
      fetchInsights();
      startAutoRefresh();
    },
  });
});
