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

  window.Pintwist = window.Pintwist || {};
  window.Pintwist.auth = {
    init,
    isSignedIn,
    getUser,
    getEmail,
    isAdmin,
    getSessionToken,
    apiFetch,
    gate,
    signOut,
    renderTopbar,
    mountStatsBar,
    ADMIN_EMAIL,
  };
})();
