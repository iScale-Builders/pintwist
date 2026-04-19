# Pintwist Website + Dashboard — Build Plan

Reference architecture: `workspace/apps/iscale-etsy/public-website/` + `workspace/apps/iscale-etsy/api/`. Static HTML + Vercel serverless functions + Clerk auth. No framework, no build step for the site itself.

## Scope

A Vercel-deployed website that shows Pintwist's aggregated Pinterest data with the same UX pattern as iscale-etsy's shop: search, filter chips, sort, card-based layout, pagination. Plus an internal dashboard for ops and insights.

## Pages

| Page | URL | Auth | Purpose |
|---|---|---|---|
| Landing | `/` → redirect to `/trending.html` | public | Entry point, SEO optimized |
| Trending | `/trending.html` | public (see note) | MAIN view: trending pins, filterable, sortable |
| Niches | `/niches.html` | public | Top search terms / niche breakdown |
| Insights | `/insights.html` | signed-in | Cross-niche analysis, deeper queries |
| Dashboard | `/dashboard.html` | signed-in + admin | Ops: ingest health, DB size, active installs |
| Maintenance | `/maintenance.html` | public | Shown during outages |

**Public vs gated for `/trending.html`?** Two options:

- **Public (like iscale-etsy):** SEO traffic → sign-up → install extension. Free marketing channel. Data is not sensitive (just Pinterest pin IDs + public metrics).
- **Gated:** requires sign-in. More exclusive; less discoverable but feels "premium."

Recommend public — iscale-etsy proved the model and the data isn't PII. Flag if you want to gate it instead.

## API routes (Vercel serverless)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/trending` | GET | Paginated pins: `?niche=&min_saves=&max_saves=&days=7&sort=reach\|saves\|velocity&cursor=` |
| `/api/niches` | GET | Aggregate search terms + their pin stats |
| `/api/insights` | GET | Cross-niche analysis, requires auth |
| `/api/health` | GET | DB size, active installs, write rate. Admin only. |

All use Supabase service role key server-side (not exposed to the browser). RLS stays denying direct table access; only the API proxies data.

## Auth

Clerk integration copied from iscale-etsy's `auth.js`. Same iScaleLabs account, same publishable key, same sign-in redirect to `iscalelabs.com/extension-sign-in` (already used by the extension).

- Anonymous users: can view public pages
- Signed-in users: can view insights
- Admin users: can view dashboard (check email allowlist server-side)

## UX patterns (mirror iscale-etsy)

- **Search bar** at top: searches within pin titles, descriptions, search terms
- **Filter chips** for quick pivots: "Last 24h", "Last 7d", "Last 30d", "High saves (>10K)", "Rising"
- **Sort dropdown**: "Top saves", "Most observed", "Highest velocity", "Newest"
- **Card grid**: one card per pin with image, metrics, source link to Pinterest
- **Pagination**: cursor-based, infinite scroll
- **Pinterest-themed palette**: Pinterest red `#E60023` as accent, white backgrounds, dark text (inverse of iscale-etsy's Etsy orange)

## Data caveats (data is thin on day 1)

At launch, only one install (you) has been contributing. The site will look empty until the extension is distributed.

Options:
1. Launch site + extension to small group simultaneously → dogfood with your own browsing + their first day of browsing
2. Populate with seed queries from your existing browsing data (already 600+ pins captured) → shows non-empty tables day 1
3. Show "Low data mode — invite friends to see real trends" banner when reach < 5 across pins

Recommend #2: seed with current browsing → cross-user signal fills in over time. Honest "seed data" banner explains reach numbers.

## Build phases

### Phase A — Scaffold + trending MVP (~3-4 hours)

- Repo layout: `public-website/` + `api/`
- `vercel.json` config
- `styles.css` (Pinterest palette, shared)
- `index.html` → redirect to trending
- `trending.html` with search, filter chips, sort, card grid, pagination
- `/api/trending` endpoint
- Clerk auth.js (for signed-in states, even if trending is public)
- Maintenance page

**Definition of done:** deployed to Vercel, `/trending.html` loads, search/filter/sort work, cards link to Pinterest, paginated.

### Phase B — Niches + insights (~2 hours)

- `niches.html` page
- `insights.html` page (requires sign-in)
- `/api/niches` endpoint
- `/api/insights` endpoint

**Definition of done:** niches page shows top search terms with volumes and max saves; insights shows cross-niche overlap.

### Phase C — Dashboard + ops (~1-2 hours)

- `dashboard.html` (admin only)
- `/api/health` endpoint with auth check
- Basic charts (pure CSS bar charts, no chart library)
- DB size + retention window + cron status

**Definition of done:** dashboard gated behind admin email, shows real-time ingest health.

### Phase D — Polish (~2 hours)

- SEO meta tags per page, OG cards
- Custom fonts (match iscale-etsy's Graphik or pick Pinterest-appropriate)
- Loading states, empty states, error states
- Mobile responsive
- Favicon, OG image
- robots.txt, sitemap.xml

**Definition of done:** Lighthouse score > 90, mobile-friendly, looks professional.

**Total: ~8-10 hours of focused work.**

## Decisions needed before building

1. **Domain?** iscale-etsy uses `shop.iscalelabs.com`. Pintwist candidates: `pintwist.iscalelabs.com`, `trends.iscalelabs.com`, `pins.iscalelabs.com`. Or keep at default `pintwist.vercel.app` for now.
2. **`/trending.html` public or gated?** Recommend public.
3. **Seed data behavior?** Show your 600+ personal browsing snapshots as trending until more installs contribute, or show empty state? Recommend show-with-banner.
4. **Admin allowlist?** Which Clerk user emails get dashboard access? Just you, or a list?
5. **Phase order?** Recommend A → D → B → C (polish before more features so phase A looks professional if we ship early).
6. **Deployment target?** Same Vercel org as iscale-etsy, or separate?
7. **Color palette?** Pinterest red accent confirmed, or match Pintwist's existing pink `#F48FB1`?

## What this replaces / supersedes

- `dashboard/build-report.mjs` — keep for ops emergency fallback, but the hosted dashboard is primary
- `dashboard/report.html` — supersedes once Phase C lands

Do NOT delete the static dashboard yet — it's a useful fallback if Vercel is down.

## Out of scope (for now)

- Mobile app / PWA
- User accounts beyond Clerk (no per-user data yet)
- Search term request forms (iscale-etsy has `request-term.js` — defer)
- Saved filters / favorites
- Email digests / notifications
- Browser push notifications
