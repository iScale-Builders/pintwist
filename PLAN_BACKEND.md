# Pintwist Backend — Data Collection Plan

Canonical plan for adding Supabase-backed pin data collection to Pintwist.

## Goal

Every pin the extension overlays sends its metrics to a Supabase database so Pintwist becomes a fleet-powered trend-detection tool. Users get the overlay for free; the aggregate dataset powers future trend features and cross-referencing with iscale-etsy and Amazon scraper data.

## Scale profile

- Launch: a few hundred DAU
- Design headroom: 5k DAU
- ~150k snapshots/day at 500 DAU = ~1 GB/month
- Fits Supabase Pro ($25/mo) comfortably. Partitioning deferred until ~2 GB.

## Architecture

```
extension  →  batch queue  →  flush every 10s  →  Edge Function
                                                      ↓
                                          validate + rate-limit
                                                      ↓
                                    pins (upsert) + pin_snapshots (insert)
                                                      ↓
                                         nightly rollup → pin_daily
                                         30-day raw retention
```

### Why Edge Function, not direct anon insert

The anon key ships inside every extension = public. Direct inserts = anyone can extract the key and flood the DB. Edge Function is the chokepoint for rate limiting, schema validation, and batch unpacking. Non-negotiable.

## Schema

```sql
-- Pin identity (one row per unique pin)
create table pins (
  pin_id text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  image_url text,
  is_video boolean,
  pin_created_at timestamptz,
  observation_count integer default 0
);

-- Time-series observations
create table pin_snapshots (
  id bigint generated always as identity primary key,
  pin_id text not null references pins(pin_id),
  seen_at timestamptz not null default now(),
  install_id uuid not null,
  source_url text,
  search_terms text,
  saves integer,
  reactions integer,
  shares integer,
  repins integer,
  comments integer
);

create index on pin_snapshots (pin_id, seen_at desc);
create index on pin_snapshots (seen_at desc);
create index on pin_snapshots (install_id, seen_at desc);

-- Permanent daily rollup
create table pin_daily (
  pin_id text,
  day date,
  unique_observers integer,
  observation_count integer,
  max_saves integer,
  min_saves integer,
  avg_saves numeric,
  top_source_urls text[],
  primary key (pin_id, day)
);
```

At ~2 GB in `pin_snapshots`, migrate to monthly partitioning for cheap retention drops. Schema above is compatible with that future migration.

## Identity

- `install_id`: UUID v4 generated on first extension launch, stored in `chrome.storage.local`
- Not tied to user identity — used only for rate limiting, session reconstruction, and cross-user signal ("40 installs saw this pin")
- Opt-out toggle in popup. Default on with first-launch disclosure.

## Client batching

- In-memory buffer of overlaid pins
- Dedup within session: same `pin_id` won't send twice in one session (1h idle resets session)
- Flush triggers: every 10s, OR buffer hits 50 pins, OR tab closes (use `sendBeacon`)
- Offline queue: failed batches persist to `chrome.storage.local`, cap 500 pins, retry on next flush
- Payload: `{ install_id, batch: [{ pin_id, metrics, source_url, seen_at }...] }`

## Edge Function

1. **Validate** — pin_id format, metric ranges, batch size ≤ 100
2. **Rate limit** — per install_id: 10 batches/min. Global: 10k req/min.
3. **Upsert pins** — `on conflict do update set last_seen = now(), observation_count = observation_count + 1`
4. **Insert snapshots** — single multi-row insert per batch
5. **Return** — `{ accepted: n, rejected: [{ reason, pin_id }...] }`

## RLS / security

- `pins`, `pin_snapshots`, `pin_daily`: no anon access at all (not even SELECT)
- All writes routed through Edge Function using service role
- Dashboard uses service role, server-side only
- Service role key NEVER exposed to extension

## Retention & rollup

- Nightly scheduled function: aggregate prior day's `pin_snapshots` into `pin_daily`
- `pin_snapshots` retention: 30 days (rolling DELETE for now, partition DROP after partitioning migration)
- `pin_daily`: permanent, cheap

## Privacy

### First-launch modal

> **Pintwist collects anonymous pin data**
>
> To power trend detection for all users, Pintwist saves the public metrics (saves, comments, date) of pins you view, along with the Pinterest search or board URL. Nothing else is collected.
>
> - ✅ Pin IDs and their public metrics
> - ✅ Pinterest search/board page you're on
> - ❌ Your identity, account, or login info
> - ❌ Anything outside of pinterest.com
> - ❌ Images, private boards, or personal pins
>
> A random install ID is generated on your device so we can count unique users without identifying you. You can turn off data collection any time in the extension popup.
>
> [Accept and continue] [Use without data sharing]

### Popup toggle

> **Share anonymous pin data** ⓘ
> Helps Pintwist detect trends faster. [Learn more]

### README privacy section

> ## Privacy
>
> Pintwist is free because users contribute anonymous pin data that powers the trend-detection features everyone benefits from.
>
> **What we collect:** public Pinterest pin metrics (save count, comment count, reaction count, creation date), the Pinterest URL you're viewing, and a random install ID generated on your device.
>
> **What we never collect:** your Pinterest account info, login tokens, private boards, personal pins, images themselves, or any data from sites other than pinterest.com.
>
> **Opt out:** toggle "Share anonymous pin data" off in the extension popup at any time. With the toggle off, Pintwist works locally and sends nothing.
>
> **Data retention:** individual observations are kept for 30 days, then aggregated into daily rollups. Your install ID is never linked to your identity.

## Observability

- Edge Function logs: latency, batch size, reject reasons
- Supabase dashboard for DB size, query times, connection count
- Internal admin dashboard (service role, drawing inspiration from iscale-etsy): writes/hour, unique pins/day, active installs, top trending pins
- Alerts: error rate > 2%, DB > 80% capacity, rate-limit rejects spiking

## Scaling decision points

| DAU | Action |
|---|---|
| 0–1k | Supabase Free / Pro, monitor |
| 1k–3k | Pro with current single-table schema |
| 3k–8k | Add monthly partitioning, shorten raw retention to 14d |
| 8k+ | Move snapshots to Timescale or Clickhouse, keep `pin_daily` in Postgres |

## Build phases

### Phase 1 — Foundation
- New Supabase project
- Schema + RLS policies
- Edge Function skeleton with validation + rate limit
- Local test harness

### Phase 2 — Extension wiring
- `install_id` generation + storage
- Buffer + flush logic in `content.ts`
- Offline queue + retry
- Privacy modal + popup opt-out toggle

### Phase 3 — Operations
- Nightly rollup scheduled function
- Retention cleanup scheduled function
- Admin dashboard (Next.js, iscale-etsy pattern)
- Monitoring + alerts

### Phase 4 — Ship
- Load test Edge Function (simulate 300 rps burst)
- Package and distribute new extension zip
- Watch first-day metrics

## Decisions locked

1. **Supabase project:** new, dedicated to Pintwist (not shared with iscale-etsy)
2. **Dashboard:** new app, drawing inspiration from iscale-etsy's dashboard pattern
3. **Privacy copy:** drafted above, revise as needed before launch
4. **Scale target:** few hundred DAU launch, 5k DAU design ceiling; Timescale migration deferred

## Open items

- Confirm which Supabase organization to create the project in
- Pick project name (`pintwist` or `pintwist-prod`?)
- Confirm deployment target for admin dashboard (Vercel? same as iscale-etsy?)
