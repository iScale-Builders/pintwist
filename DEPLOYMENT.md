# Pintwist Web — Deployment Guide

Target: `https://pintwist.iscalelabs.com` on Vercel (same org as iscale-etsy).

## Repo layout

```
workspace/apps/pintwist/
├── public-website/      ← static site (served as root)
│   ├── index.html       redirects to /trending.html
│   ├── trending.html
│   ├── maintenance.html
│   ├── styles.css
│   ├── auth.js
│   └── trending.js
├── api/                 ← Vercel serverless functions (auto-routed)
│   ├── package.json
│   ├── trending.js      GET /api/trending
│   └── _lib/
│       └── auth.js      shared Clerk + Supabase helpers
└── vercel.json          routing + headers
```

## One-time setup

### 1. Create Vercel project

From the pintwist repo root (`workspace/apps/pintwist/`):

```bash
vercel link
```

Pick the existing iScaleLabs org (same org as iscale-etsy). Name the project `pintwist-web`.

### 2. Set environment variables on Vercel

In the Vercel dashboard → Project → Settings → Environment Variables, add the following for **Production, Preview, and Development**:

| Variable | Value | Where to get it |
|---|---|---|
| `SUPABASE_URL` | `https://tzuvthfkdguxisquxlnb.supabase.co` | Already known |
| `SUPABASE_SERVICE_ROLE_KEY` | *(secret)* | Supabase dashboard → Settings → API → service_role |
| `CLERK_SECRET_KEY` | *(secret)* | Clerk dashboard → API Keys → Secret keys |
| `CLERK_PUBLISHABLE_KEY` | `pk_live_Y2xlcmsuaXNjYWxlbGFicy5jb20k` | Same key the extension uses |
| `PINTWIST_ADMIN_EMAIL` | `contact@iscalelabs.com` | Optional; defaults to this value |

**Never** put the service role key or Clerk secret in client-side code. Both belong only in Vercel's env, read by the serverless functions.

### 3. Connect the custom domain

In Vercel → Project → Settings → Domains, add `pintwist.iscalelabs.com`. Follow Vercel's DNS instructions (usually a CNAME pointing at `cname.vercel-dns.com`). Propagation takes ~5-60 minutes.

### 4. Update Clerk allowed origins

In Clerk dashboard → Frontend instance → **Paths & URLs**, add `https://pintwist.iscalelabs.com` to:
- **Home URL** (one of them, or the primary)
- **Allowed origins** for CORS

This lets Clerk's session cookie flow across the iscalelabs.com subdomains.

### 5. First deploy

```bash
cd workspace/apps/pintwist
vercel --prod
```

Vercel detects:
- `public-website/` as the static output directory (via `vercel.json`)
- `api/*.js` as serverless functions, using `api/package.json` for deps

First build installs `@clerk/backend` and `@supabase/supabase-js` for the functions. Takes ~60 seconds.

## Verifying the deploy

1. Open `https://pintwist.iscalelabs.com/` → should redirect to `/trending.html`
2. If not signed in to iScaleLabs, you'll see the sign-in card. Click sign-in → redirects to iscalelabs.com → complete auth → back to the trending page.
3. Signed in: you should see the top nav, filters, and the pin grid loading.
4. The first API call hits `/api/trending?sort=reach&days=7`. Open browser DevTools → Network to confirm it returns 200.

### If you see only a spinner

Open the browser console. Common causes:
- `Clerk not loaded`: the Clerk script failed. Check CSP `script-src` allows `clerk.iscalelabs.com`.
- `401 unauthorized` on `/api/trending`: session token isn't being attached. Check `authorization: Bearer ...` in the request headers.
- `500 db_error`: service role key missing or wrong. Verify env vars in Vercel.

### If the trending page shows "No pins match these filters"

That's expected if the 7-day window has no data matching your filter. Drop to 30 days + min-saves = Any to widen the query. If still empty, check the DB directly via the Supabase MCP (`select count(*) from pin_snapshots`).

## Local dev

Vercel's CLI gives a local dev server with the same routing:

```bash
cd workspace/apps/pintwist
vercel dev
```

This serves `public-website/` at http://localhost:3000 with `/api/*` routed to the serverless functions. You still need the env vars — Vercel pulls them from the linked project, or you can put them in `.env.local`:

```
SUPABASE_URL=https://tzuvthfkdguxisquxlnb.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
CLERK_SECRET_KEY=...
CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuaXNjYWxlbGFicy5jb20k
```

## Security notes

- **Service role key**: server-only. Vercel env var. Never in `public-website/`.
- **Clerk session tokens**: short-lived (default 60s), auto-refreshed by the Clerk browser SDK. Safe to attach to fetch requests.
- **CSP**: each HTML file has its own Content-Security-Policy meta tag restricting script sources to `self` + `clerk.iscalelabs.com`. Tightening further once deployed is worth the review.
- **CORS**: API routes don't set `Access-Control-Allow-Origin` — they're same-origin. If you ever need them from another origin, add explicit CORS handling.
- **RLS**: all DB access still goes through Postgres RLS. Serverless functions use service role which bypasses RLS — they must enforce auth themselves (see `api/_lib/auth.js`).

## What's deployed vs what's still pending

All four phases complete, awaiting first production deploy:

- ✅ Phase A: landing redirect, trending page (search + filter chips + sort + card grid + pagination), `/api/trending`, Clerk auth, maintenance page
- ✅ Phase D: SEO + OG meta tags, Inter font, favicons, 480px mobile breakpoint, noindex robots.txt, 404 page
- ✅ Phase B: niches page (sortable table, min-volume chips, click-through to trending), insights page (cross-niche, momentum, velocity), `/api/niches`, `/api/insights`
- ✅ Phase C: admin ops dashboard with auto-refresh every 30s, hourly bar chart, cron status, `/api/health`
