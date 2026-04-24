// ===== PINTWIST WEB - Ops Dashboard =====

const AUTO_REFRESH_MS = 30000;
let refreshTimer = null;

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
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

function renderHourlyChart(hourly) {
  if (!hourly || hourly.length === 0) return "";
  const max = Math.max(1, ...hourly.map((h) => h.count));
  const bars = hourly
    .map((h) => {
      const pct = (h.count / max) * 100;
      const hh = new Date(h.hour_start).getUTCHours();
      return `<div class="bar" style="height:${pct}%" data-count="${h.count}" title="${hh
        .toString()
        .padStart(2, "0")}:00 UTC · ${h.count} snapshots"></div>`;
    })
    .join("");
  const firstHour = new Date(hourly[0].hour_start).getUTCHours();
  const lastHour = new Date(hourly[hourly.length - 1].hour_start).getUTCHours();
  return `
    <div class="bar-chart">${bars}</div>
    <div class="bar-axis">
      <span>${firstHour.toString().padStart(2, "0")}:00 UTC (24h ago)</span>
      <span>${lastHour.toString().padStart(2, "0")}:00 UTC (now)</span>
    </div>
  `;
}

function renderCronJobs(jobs) {
  if (!jobs || jobs.length === 0) {
    return `<div class="empty">No cron jobs registered.</div>`;
  }
  return `
    <table class="data-table">
      <thead>
        <tr>
          <th>Job</th>
          <th>Schedule</th>
          <th>Purpose</th>
          <th class="col-num">Active</th>
        </tr>
      </thead>
      <tbody>
        ${jobs
          .map(
            (j) => `
          <tr>
            <td class="col-term">${esc(j.jobname)}</td>
            <td><code>${esc(j.schedule)}</code></td>
            <td>${esc(j.description || "")}</td>
            <td class="col-num">${j.active ? "✓" : "✗"}</td>
          </tr>
        `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderHealth(data) {
  const host = document.getElementById("dashboard-root");
  if (!host) return;
  if (!data) {
    host.innerHTML = `<div class="error">Failed to load.</div>`;
    return;
  }

  const t = data.totals || {};
  const i = data.ingest || {};
  const liveDot = i.snap_1h > 0 ? `<span class="dot-live"></span>` : `<span class="dot-idle"></span>`;
  const latestLabel = i.latest_snap ? timeAgo(i.latest_snap.seen_at) : "never";

  host.innerHTML = `
    <div class="status-line">
      ${liveDot}
      Ingestion: <strong>${i.snap_1h > 0 ? "live" : "idle"}</strong> · last snapshot ${latestLabel}
      · refreshed ${esc(timeAgo(data.generated_at))}
    </div>

    <div class="section-title">Last hour</div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="n">${fmtNum(i.snap_1h)}</div>
        <div class="l">Snapshots</div>
      </div>
      <div class="stat-card">
        <div class="n">${fmtNum(i.installs_1h)}</div>
        <div class="l">Active installs</div>
      </div>
    </div>

    <div class="section-title">Last 24 hours</div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="n">${fmtNum(i.snap_24h)}</div>
        <div class="l">Snapshots</div>
      </div>
      <div class="stat-card">
        <div class="n">${fmtNum(i.installs_24h)}</div>
        <div class="l">Unique installs</div>
      </div>
      <div class="stat-card">
        <div class="n">${i.snap_24h > 0 ? (i.snap_24h / (i.installs_24h || 1)).toFixed(0) : "0"}</div>
        <div class="l">Snapshots / install</div>
      </div>
      <div class="stat-card">
        <div class="n">${fmtNum(Math.round(i.snap_24h / 24))}</div>
        <div class="l">Avg snapshots / hr</div>
      </div>
    </div>

    <div class="section-title">Hourly ingestion — last 24h</div>
    <div class="insight-block" style="padding: 16px;">
      ${renderHourlyChart(i.hourly_last_24h)}
    </div>

    <div class="section-title">All-time totals</div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="n">${fmtNum(t.pins)}</div>
        <div class="l">Unique pins</div>
      </div>
      <div class="stat-card">
        <div class="n">${fmtNum(t.snapshots)}</div>
        <div class="l">Snapshots</div>
      </div>
      <div class="stat-card">
        <div class="n">${fmtNum(t.daily)}</div>
        <div class="l">Daily rollup rows</div>
      </div>
      <div class="stat-card">
        <div class="n">${fmtNum(i.installs_7d)}</div>
        <div class="l">Installs active 7d</div>
      </div>
    </div>

    <div class="section-title">Scheduled jobs</div>
    ${renderCronJobs(data.cron_jobs)}
  `;
}

let _healthInFlight = false;
async function fetchHealth() {
  if (_healthInFlight) return;
  _healthInFlight = true;
  try {
    const res = await window.Pintwist.auth.apiFetch("/api/health");
    if (res.status === 401) {
      window.Pintwist.auth.gate({ container: document.getElementById("app") });
      return;
    }
    if (res.status === 403) {
      document.getElementById("dashboard-root").innerHTML = `<div class="error">Admin access required.</div>`;
      return;
    }
    if (!res.ok) {
      document.getElementById("dashboard-root").innerHTML = window.Pintwist.auth.renderApiError(res, "dashboard");
      if (res.status === 429) setTimeout(() => fetchHealth(), 10_000);
      return;
    }
    const data = await res.json();
    renderHealth(data);
  } catch (err) {
    console.error("health fetch error:", err);
    document.getElementById("dashboard-root").innerHTML = `<div class="error">Network error.</div>`;
  } finally {
    _healthInFlight = false;
  }
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState === "visible") fetchHealth();
  }, AUTO_REFRESH_MS);
}

function renderPageShell() {
  const app = document.getElementById("app");
  const tpl = document.getElementById("page-template");
  app.innerHTML = "";
  app.appendChild(tpl.content.cloneNode(true));
  document.getElementById("topbar-host").outerHTML = window.Pintwist.auth.renderTopbar("dashboard");
  document.getElementById("pintwist-signout").addEventListener("click", window.Pintwist.auth.signOut);
  window.Pintwist.auth.mountStatsBar("stats-bar-host");
}

window.addEventListener("load", async () => {
  await window.Pintwist.auth.gate({
    container: document.getElementById("app"),
    requireAdmin: true,
    onReady: () => {
      renderPageShell();
      fetchHealth();
      startAutoRefresh();
    },
  });
});
