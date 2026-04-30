// ===== PINTWIST WEB - Clerk Auth + API Helpers =====
//
// Shared auth module for all Pintwist web pages.
// Exposes: window.Pintwist.auth with methods:
//   - init(): bootstraps Clerk, returns Promise<user|null>
//   - isSignedIn(): boolean
//   - getUser(): Clerk user object or null
//   - isAdmin(): boolean (email === contact@iscalelabs.com)
//   - apiFetch(path, opts): fetch wrapper that attaches session token
//   - gate(opts): shows signed-out screen or renders content
//   - signOut(): clears Clerk session cookies, reloads
//
// Clerk is loaded via <script> tag in each HTML file (see trending.html).

(function () {
  const ADMIN_EMAIL = "contact@iscalelabs.com";
  const SIGN_IN_URL = "https://www.iscalelabs.com/extension-sign-in?source=pintwist-web";

  let clerkReady = null;

  async function waitForClerk() {
    if (clerkReady) return clerkReady;
    clerkReady = new Promise((resolve) => {
      const check = () => {
        if (window.Clerk && window.Clerk.loaded) {
          resolve(window.Clerk);
        } else if (window.Clerk && window.Clerk.load) {
          window.Clerk.load({ allowedRedirectProtocols: ["https:"] }).then(() => resolve(window.Clerk));
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
    return clerkReady;
  }

  async function init() {
    const clerk = await waitForClerk();
    return clerk.user || null;
  }

  function isSignedIn() {
    return !!(window.Clerk && window.Clerk.user);
  }

  function getUser() {
    return window.Clerk ? window.Clerk.user : null;
  }

  function getEmail() {
    const u = getUser();
    return u?.primaryEmailAddress?.emailAddress || null;
  }

  function isAdmin() {
    return getEmail() === ADMIN_EMAIL;
  }

  async function getSessionToken() {
    if (!window.Clerk || !window.Clerk.session) return null;
    return window.Clerk.session.getToken();
  }

  async function apiFetch(path, opts = {}) {
    const token = await getSessionToken();
    const headers = Object.assign(
      { "content-type": "application/json" },
      opts.headers || {},
      token ? { authorization: "Bearer " + token } : {}
    );
    return fetch(path, Object.assign({}, opts, { headers }));
  }

  // Download a CSV export via an auth'd fetch. filename can include {timestamp}.
  async function downloadCsv(path, fallbackFilename) {
    const res = await apiFetch(path);
    if (!res.ok) {
      const body = await res.text();
      throw new Error("HTTP " + res.status + ": " + body.slice(0, 200));
    }
    const cd = res.headers.get("content-disposition") || "";
    const m = cd.match(/filename="?([^";]+)"?/i);
    const filename = m ? m[1] : fallbackFilename || "pintwist-export.csv";
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 0);
  }

  function renderAuthGate(container) {
    container.innerHTML = `
      <div class="auth-gate">
        <div class="auth-card">
          <div class="auth-logo">P</div>
          <div class="auth-title">Sign in to Pintwist</div>
          <div class="auth-subtitle">Requires an iScaleLabs account. Same sign-in as the extension.</div>
          <button id="pintwist-signin" class="btn-primary" type="button">Sign in with iScaleLabs</button>
        </div>
      </div>
    `;
    document.getElementById("pintwist-signin").addEventListener("click", () => {
      window.location.href = SIGN_IN_URL;
    });
  }

  function renderAdminOnly(container) {
    container.innerHTML = `
      <div class="auth-gate">
        <div class="auth-card">
          <div class="auth-logo" style="background:#595959">!</div>
          <div class="auth-title">Admin only</div>
          <div class="auth-subtitle">This page is restricted to the admin account.</div>
          <button class="btn-primary" type="button" onclick="window.location.href='/trending.html'">Back to trending</button>
        </div>
      </div>
    `;
  }

  async function gate({ container, requireAdmin = false, onReady }) {
    container = container || document.getElementById("app") || document.body;
    const loadingEl = container.querySelector("[data-auth-loading]");
    if (loadingEl) loadingEl.style.display = "block";

    try {
      await init();
    } catch (err) {
      console.error("Clerk init failed:", err);
    }

    if (loadingEl) loadingEl.style.display = "none";

    if (!isSignedIn()) {
      renderAuthGate(container);
      return false;
    }
    if (requireAdmin && !isAdmin()) {
      renderAdminOnly(container);
      return false;
    }
    if (onReady) onReady(getUser());
    return true;
  }

  function signOut() {
    // Don't call Clerk.signOut() directly — it can crash in some contexts.
    // Clear session cookies and reload.
    const host = "https://www.iscalelabs.com";
    document.cookie = "__client_uat=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.iscalelabs.com";
    document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.iscalelabs.com";
    fetch(host + "/api/auth/sign-out", { method: "POST", credentials: "include" }).finally(() => {
      window.location.href = SIGN_IN_URL;
    });
  }

  // --- Global stats bar ---
  // Renders a thin strip under the topbar showing total pins, snapshots,
  // active installs, and last activity. Auto-refreshes every 60s.

  const STATS_REFRESH_MS = 60_000;
  let statsTimer = null;

  function fmtNum(n) {
    if (n === null || n === undefined) return "—";
    n = Number(n);
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return n.toString();
  }

  function timeAgo(iso) {
    if (!iso) return "—";
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return s + "s ago";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    return d + "d ago";
  }

  async function refreshStats() {
    try {
      const res = await apiFetch("/api/stats");
      if (!res.ok) return;
      const d = await res.json();
      const set = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
      };
      set("stat-pins", fmtNum(d.total_pins));
      set("stat-snapshots", fmtNum(d.total_snapshots));
      set("stat-installs", fmtNum(d.installs_7d));
      set("stat-installs-24h", fmtNum(d.installs_24h));
      set("stat-latest", timeAgo(d.latest_seen));
      const dot = document.getElementById("stat-live-dot");
      if (dot) {
        dot.className = (d.installs_24h > 0 ? "dot-live" : "dot-idle");
      }
    } catch (err) {
      // ignore silently
    }
  }

  function startStatsRefresh() {
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = setInterval(() => {
      if (document.visibilityState === "visible") refreshStats();
    }, STATS_REFRESH_MS);
  }

  function mountStatsBar(hostId) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.outerHTML = `
      <div class="stats-bar">
        <div class="stats-bar-inner">
          <span class="stat"><span id="stat-live-dot" class="dot-idle"></span><strong id="stat-installs-24h">—</strong> active today</span>
          <span class="stat stat-sep"></span>
          <span class="stat"><strong id="stat-installs">—</strong> installs · 7d</span>
          <span class="stat"><strong id="stat-pins">—</strong> unique pins</span>
          <span class="stat"><strong id="stat-snapshots">—</strong> snapshots</span>
          <span class="stat stat-right">Last activity <strong id="stat-latest">—</strong></span>
        </div>
      </div>
    `;
    refreshStats();
    startStatsRefresh();
  }

  function renderTopbar(activePage) {
    const user = getUser();
    const email = getEmail();
    const admin = isAdmin();
    const avatar = user?.imageUrl
      ? `<img src="${user.imageUrl}" alt="">`
      : "";

    const links = [
      { id: "trending", label: "Trending", href: "/trending.html" },
      { id: "niches", label: "Niches", href: "/niches.html" },
      { id: "insights", label: "Insights", href: "/insights.html" },
    ];
    if (admin) links.push({ id: "dashboard", label: "Ops", href: "/dashboard.html" });

    return `
      <div class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="/trending.html">
            <span class="brand-dot"></span>
            Pintwist
          </a>
          <nav class="nav-links">
            ${links
              .map(
                (l) => `<a class="nav-link ${l.id === activePage ? "active" : ""}" href="${l.href}">${l.label}</a>`
              )
              .join("")}
          </nav>
          <div class="user-block">
            ${avatar}
            <span>${email || ""}</span>
            <button class="btn-signout" type="button" id="pintwist-signout">Sign out</button>
          </div>
        </div>
      </div>
    `;
  }

  // Client-side image download. Pinterest's i.pinimg.com sends
  // Access-Control-Allow-Origin: *, so we can fetch → blob → save without
  // a backend proxy. Falls back to opening in a new tab if CORS ever tightens.
  async function downloadPinImage(url, pinId) {
    if (!url) return false;
    try {
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const ext = (url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "jpg").toLowerCase();
      const a = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = "pintwist_" + (pinId || "pin") + "." + ext;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      return true;
    } catch (err) {
      console.warn("downloadPinImage failed, opening in new tab:", err);
      window.open(url, "_blank", "noopener");
      return false;
    }
  }

  // Friendly error HTML for API failures. Returns the string to inject into
  // your error container. Pairs with the per-API rate limiting added in v1.6.2:
  // 429 gets a "slow down" message; other statuses get a generic retry nudge.
  function renderApiError(res, label) {
    const thing = label || "data";
    if (res.status === 429) {
      return `<div class="error">Slow down — too many requests. Auto-retrying in a few seconds.</div>`;
    }
    if (res.status === 403) {
      return `<div class="error">Access denied. You may not have permission to view ${thing}.</div>`;
    }
    if (res.status >= 500) {
      return `<div class="error">Server hiccup loading ${thing} (HTTP ${res.status}). Retrying shortly.</div>`;
    }
    return `<div class="error">Couldn't load ${thing} (HTTP ${res.status}). Try again in a moment.</div>`;
  }

  window.Pintwist = window.Pintwist || {};
  window.Pintwist.auth = {
    init,
    isSignedIn,
    getUser,
    getEmail,
    isAdmin,
    getSessionToken,
    apiFetch,
    downloadCsv,
    gate,
    signOut,
    renderTopbar,
    mountStatsBar,
    renderApiError,
    downloadPinImage,
    ADMIN_EMAIL,
  };
})();
