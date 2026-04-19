# Pintwist Dashboard

Generates a static HTML report of ingestion health and cross-user trend signals. No server, no deploy — a Node script that queries Supabase and writes one HTML file you open in your browser.

## Setup (once)

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Grab the service role key from the [Supabase dashboard → Settings → API](https://supabase.com/dashboard/project/tzuvthfkdguxisquxlnb/settings/api) (labeled "service_role secret"). Paste into `.env` as `SUPABASE_SERVICE_ROLE_KEY=...`.
3. Install deps (from the pintwist repo root):
   ```bash
   npm install @supabase/supabase-js
   ```
   (likely already installed as part of the project)

## Generate a report

From the pintwist repo root:
```bash
node dashboard/build-report.mjs
```

Or with env vars inline:
```bash
SUPABASE_URL=https://tzuvthfkdguxisquxlnb.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node dashboard/build-report.mjs
```

Output: `dashboard/report.html`. Open it in any browser.

## What's in the report

1. **Now** — last 24 hours: snapshot count, unique installs, total pins/snapshots all-time, top 10 highest-save pins from the last day.
2. **Trending** — last 7 days: top 25 pins ranked by cross-user reach (distinct install_ids that saw the pin). This is the signal that only a multi-user dataset can produce.
3. **Niches** — last 7 days: top 25 search terms by pin volume, with max and average saves. Shows what topics are being researched.

## Security

- The service role key has full DB access. Keep `.env` local; never commit it.
- The generated `report.html` contains aggregate data (no PII, no install_ids). Safe to share internally, but treat it as sensitive since it reveals cross-user trend positions.
- All queries are read-only.

## Rerun cadence

There's no background job — you run the script when you want fresh data. Useful times:
- Start of day: see what the overnight ingestion captured
- Before a design session: pull top niches + trending pins
- Weekly: snapshot the state for retrospective analysis

For automated refresh, wrap in a cron or systemd timer later. For now manual is fine.

## Upgrading later

If you eventually want a hosted dashboard with live data:
- Move `build-report.mjs` into a Next.js app at `dashboard/` as a server component
- Deploy to Vercel with env vars
- Add simple password protection (Vercel Password Protection or a shared-secret header)

Pattern to follow: `workspace/apps/iscale-etsy/public-website/` (static HTML + API routes).
