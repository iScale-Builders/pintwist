# Pintwist — Full Plan

Canonical plan for turning Pintwist from a local-only overlay extension into a fleet-powered Pinterest trend intelligence tool. Supersedes `PLAN_BACKEND.md` and `PLAN_PHASE1_FIXES.md`.

---

## 1. Product vision

Pintwist is a free Chrome extension that overlays public metrics (saves, comments, creation date) on every Pinterest pin the user views. It has two audiences:

- **Users**: anyone doing Pinterest research — POD sellers, niche researchers, designers. They get the overlay for free.
- **Us**: by collecting anonymous pin observations across all users, Pintwist becomes a fleet sensor that detects trends Pinterest's own algorithm is amplifying. This data is our moat.

The value exchange is explicit and transparent: free tool in exchange for anonymous pin data. Users see it upfront, opt out any time, and nothing identifying them is ever collected.

The long game (out of scope for this plan, stated for context): cross-reference Pintwist's Pinterest signals with iscale-etsy's Etsy sales data, the Amazon scraper's low-BSR recent uploads, and social media velocity. An AI layer synthesizes these into ranked "design these products next" recommendations. Pintwist is one of four sensors feeding that system.

---

## 2. Scale profile

- **Launch target:** a few hundred DAU
- **Design ceiling:** 5,000 DAU
- **Migration trigger:** 8,000+ DAU → rearchitect snapshot storage

| DAU | Snapshots/day | Monthly rows | Storage/month | Stays on |
|---|---|---|---|---|
| 500 | ~150k | ~4.5M | ~1 GB | Supabase Pro ($25) |
| 1,000 | ~300k | ~9M | ~2 GB | Pro |
| 3,000 | ~900k | ~27M | ~6 GB | Pro + monthly partitioning |
| 5,000 | ~1.5M | ~45M | ~9 GB | Pro + 14-day retention |
| 8,000+ | ~2.4M+ | 72M+ | 14 GB+ | Migrate snapshots → Timescale or Clickhouse |

Cost today: **$10/mo** (Supabase project creation fee, already committed). Moving to Pro tier adds **$25/mo** when DB or egress crosses Free limits.

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Chrome extension (content.ts running on pinterest.com)         │
│   ├─ overlays metrics on pins (existing)                        │
│   ├─ install_id (UUID, chrome.storage.local)                    │
│   ├─ in-memory send buffer (dedup, 50-pin cap)                  │
│   ├─ offline queue (chrome.storage.local, 500-pin cap)          │
│   └─ privacy toggle (first-launch modal + popup checkbox)       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ batch POST every 10s / on close
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Edge Function /functions/v1/ingest (verify_jwt=true)           │
│   ├─ validate: install_id, batch size, pin_id regex             │
│   ├─ atomic rate limit: bump_rate_limit rpc                     │
│   ├─ clean: source_url → Pinterest-only, metrics → safe ints    │
│   ├─ upsert pins (dedup within batch)                           │
│   └─ insert pin_snapshots                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ service role
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Postgres (Supabase project: pintwist, us-west-1)               │
│   ├─ pins                       ← identity + observation_count  │
│   ├─ pin_snapshots              ← time-series, 30-day rolling   │
│   ├─ pin_daily                  ← permanent aggregate           │
│   ├─ ingest_rate_limits         ← minute buckets, cron cleanup  │
│   ├─ trigger: snapshots → bump pin observation_count            │
│   └─ pg_cron: nightly rollup, retention, rate-limit cleanup     │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Admin dashboard (Next.js, service role, server-only)           │
│   ├─ trending pins (velocity over pin_daily)                    │
│   ├─ ingest health (writes/hour, active installs, errors)       │
│   └─ data export (CSV/JSON for AI layer input)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Data model

### `pins` — identity

```sql
create table public.pins (
  pin_id text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  image_url text,
  is_video boolean,
  pin_created_at timestamptz,
  observation_count integer not null default 0
);
```

One row per unique Pinterest pin. `observation_count` is maintained by trigger on `pin_snapshots`.

### `pin_snapshots` — time-series observations

```sql
create table public.pin_snapshots (
  id bigint generated always as identity primary key,
  pin_id text not null references public.pins(pin_id) on delete cascade,
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

create index pin_snapshots_pin_seen_idx on public.pin_snapshots (pin_id, seen_at desc);
create index pin_snapshots_seen_idx on public.pin_snapshots (seen_at desc);
create index pin_snapshots_install_seen_idx on public.pin_snapshots (install_id, seen_at desc);
```

Every time an extension overlays a pin, one row lands here (subject to in-session dedup and rate limiting). Raw data retained 30 days, then aggregated into `pin_daily` and dropped.

### `pin_daily` — permanent aggregate

```sql
create table public.pin_daily (
  pin_id text not null,
  day date not null,
  unique_observers integer not null default 0,
  observation_count integer not null default 0,
  max_saves integer,
  min_saves integer,
  avg_saves numeric,
  top_source_urls text[],
  primary key (pin_id, day)
);

create index pin_daily_day_idx on public.pin_daily (day desc);
```

Permanent. Small. Powers dashboards, trend queries, and data export to downstream systems.

### `ingest_rate_limits` — minute buckets

```sql
create table public.ingest_rate_limits (
  install_id uuid not null,
  window_start timestamptz not null,
  batch_count integer not null default 0,
  primary key (install_id, window_start)
);

create index ingest_rate_limits_window_idx on public.ingest_rate_limits (window_start);
```

Throwaway. Cleaned every 10 minutes by `pg_cron`.

### Trigger: auto-bump observation count

```sql
create function public.bump_pin_observation() returns trigger
language plpgsql as $$
begin
  update public.pins
     set observation_count = observation_count + 1,
         last_seen = greatest(last_seen, new.seen_at)
   where pin_id = new.pin_id;
  return null;
end;
$$;

create trigger pin_snapshots_bump_observation
after insert on public.pin_snapshots
for each row execute function public.bump_pin_observation();
```

### Atomic rate-limit function

```sql
create function public.bump_rate_limit(
  p_install_id uuid,
  p_window_start timestamptz,
  p_limit integer
) returns table(allowed boolean, current_count integer)
language plpgsql
security definer
as $$
declare v_count integer;
begin
  insert into public.ingest_rate_limits (install_id, window_start, batch_count)
  values (p_install_id, p_window_start, 1)
  on conflict (install_id, window_start)
  do update set batch_count = public.ingest_rate_limits.batch_count + 1
  returning public.ingest_rate_limits.batch_count into v_count;

  return query select (v_count <= p_limit), v_count;
end;
$$;

revoke all on function public.bump_rate_limit(uuid, timestamptz, integer) from public;
grant execute on function public.bump_rate_limit(uuid, timestamptz, integer) to service_role;
```

Replaces the racy "SELECT then UPSERT" pattern. Single atomic statement, `RETURNING` gives us the post-increment count in one round trip.

### RLS

All four tables have RLS enabled with **no policies** = no access for anon or authenticated roles. All writes go through the Edge Function using service role (which bypasses RLS). Analytics/dashboard queries use service role server-side.

---

## 5. Edge Function contract

**Endpoint:** `POST /functions/v1/ingest`
**Auth:** `Authorization: Bearer <anon_key>` + `apikey: <anon_key>` headers (validated by Supabase gateway; function itself uses service role internally)

### Request body

```ts
{
  install_id: "550e8400-e29b-41d4-a716-446655440000",  // UUID v4
  batch: [
    {
      pin_id: "123456789012345",       // required, Pinterest numeric ID
      saves: 850,
      reactions: 12,
      shares: 3,
      repins: 4,
      comments: 7,
      pin_created_at: "2026-04-10T...", // ISO, Pinterest's creation date
      image_url: "https://i.pinimg.com/originals/.../abc.jpg",
      is_video: false,
      source_url: "https://www.pinterest.com/search/pins/?q=boho+wall+art",
      search_terms: "boho wall art",    // parsed client-side
      seen_at: "2026-04-19T..."         // ISO, when the overlay rendered
    },
    ...
  ]
}
```

### Response

**200 OK** — `{ accepted: number, rejected: [{ pin_id, reason }...] }`
**400** — `{ error: "invalid_json" | "invalid_install_id" | "empty_batch" | "batch_too_large" }`
**401** — gateway rejected anon key
**405** — non-POST method
**429** — `{ error: "rate_limited", retry_after: 60 }`
**500** — `{ error: "db_error", stage: "pins" | "snapshots" }`

### Server-side rules

| Rule | Limit | Behavior |
|---|---|---|
| Batch size | ≤ 100 pins | Reject whole batch if exceeded |
| Rate limit | 10 batches / install_id / minute | 429 |
| `pin_id` format | `/^[0-9]{6,20}$/` | Reject individual pin, continue batch |
| `install_id` format | UUID v4 | Reject whole batch |
| `source_url` host | `*.pinterest.com` over HTTPS | Null the field, keep the pin |
| Integer metrics | 0 ≤ n ≤ 1,000,000,000 | Null if out of range |
| String lengths | image_url ≤ 512, source_url ≤ 2048, search_terms ≤ 512 | Truncate |

### Policies

- **Fail-open on rate-limit infra error.** If the `bump_rate_limit` rpc returns an error, accept the batch and log. Better to absorb some legit data than drop it over an infra blip.
- **Null invalid `source_url`, don't reject the pin.** Privacy guard without losing useful pin metrics.
- **In-batch pin dedup** before upserting `pins`.

---

## 6. Client (extension) design

### install_id

Generated on first extension launch (`crypto.randomUUID()`), persisted in `chrome.storage.local`. Never tied to user identity. Used for:
- Rate limiting (per-install bucket)
- Session reconstruction (`install_id + day` grouping)
- Cross-user signal ("40 different installs saw this pin this week")

### Send buffer + flush

- In-memory `Map<pin_id, PinSubmission>` of pins overlaid since last flush
- **In-session dedup:** same `pin_id` won't send twice within the session. Session resets after 1h idle.
- **Flush triggers:**
  - Every 10s via `setInterval`
  - When buffer reaches 50 pins
  - On `visibilitychange` → `hidden` (tab close / switch) via `navigator.sendBeacon`
- **Payload cap:** 50 pins per batch (well below the server's 100-pin limit, leaves headroom)

### Offline queue

- If fetch fails (offline, server 5xx, CORS error), push batch to `chrome.storage.local` under `pintwist_offline_queue`
- On next flush, drain offline queue first, then current buffer
- Cap: 500 pins total in persistent queue. Overflow → oldest pins dropped, log a telemetry event.

### Privacy UI

- **First-launch modal:** shown on extension install. Copy in section 7. Two buttons: "Accept and continue" (sets `dataSharing = true`), "Use without data sharing" (sets `dataSharing = false`). Modal doesn't block the extension — it still works locally either way.
- **Popup toggle:** "Share anonymous pin data" checkbox, always visible, reflects `chrome.storage.local.dataSharing`.
- When `dataSharing = false`: buffer/flush logic short-circuits. Nothing leaves the device. Not even the offline queue drains.

### Changes to existing code

- `src/content.ts` — add `sendToIngest(metrics, context)` call after the overlay renders at ~line 510. Gate on `dataSharing`.
- `src/popup.ts` — add the toggle, wire to `chrome.storage.local`.
- `popup.html` — render the toggle + a "Learn more" link opening the privacy doc.
- `manifest.json` — add the ingest endpoint to `host_permissions`, add `storage` permission if not already there.
- New file: `src/ingest.ts` — all buffer/flush/queue logic.
- New file: `src/privacy-modal.ts` + HTML — first-launch modal.
- New file: `src/constants/config.ts` — Supabase URL + anon key constants.

---

## 7. Privacy / trust

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

---

## 8. Operations

### Retention

- **`pin_snapshots`:** 30 days rolling. At ≥ 2 GB table size, migrate to monthly partitioning so retention becomes a partition drop.
- **`pin_daily`:** permanent. It's tiny.
- **`ingest_rate_limits`:** cleaned every 10 min by `pg_cron`, rows older than 5 min dropped.
- **`pins`:** permanent. One row per unique pin ever seen.

### Scheduled jobs (pg_cron)

```sql
create extension if not exists pg_cron with schema extensions;

-- Every 10 min: drop stale rate-limit rows
select cron.schedule(
  'cleanup_ingest_rate_limits',
  '*/10 * * * *',
  $$delete from public.ingest_rate_limits where window_start < now() - interval '5 minutes'$$
);

-- Nightly at 02:00 UTC: aggregate yesterday's snapshots into pin_daily
select cron.schedule(
  'rollup_pin_daily',
  '0 2 * * *',
  $$
  insert into public.pin_daily (pin_id, day, unique_observers, observation_count, max_saves, min_saves, avg_saves, top_source_urls)
  select
    pin_id,
    (seen_at at time zone 'utc')::date as day,
    count(distinct install_id),
    count(*),
    max(saves),
    min(saves),
    avg(saves),
    array(select unnest(array_agg(source_url)) limit 10)
  from public.pin_snapshots
  where seen_at >= (now() - interval '1 day')::date
    and seen_at <  now()::date
  group by pin_id, day
  on conflict (pin_id, day) do update set
    unique_observers = excluded.unique_observers,
    observation_count = excluded.observation_count,
    max_saves = excluded.max_saves,
    min_saves = excluded.min_saves,
    avg_saves = excluded.avg_saves,
    top_source_urls = excluded.top_source_urls;
  $$
);

-- Nightly at 03:00 UTC: drop snapshots older than 30 days
select cron.schedule(
  'retain_pin_snapshots',
  '0 3 * * *',
  $$delete from public.pin_snapshots where seen_at < now() - interval '30 days'$$
);
```

### Monitoring

Internal admin dashboard shows:

- **Ingest health:** requests/minute, accepted/rejected, 4xx/5xx rates, batch size p50/p95
- **DB size:** `pin_snapshots` row count and GB, `pins` row count, `pin_daily` row count
- **Usage:** active installs today / 7d / 30d, unique pins today / 7d / 30d
- **Trending:** top pins by save-velocity over last 7 days (the actual product signal)

Alerts (Phase 3, low priority):

- Error rate > 2% over 5 min
- DB > 80% of plan capacity
- 429 rate > 10% (sign of a misbehaving client or an abusive install_id)
- pg_cron job failed

### Backups

Supabase Pro includes daily PITR backups automatically. No action needed.

---

## 9. Security model

### Threat: anon key extraction

The anon key ships in every extension zip. Assume it's public. Defenses:

- **All writes go through the Edge Function**, not direct table inserts. The function is the chokepoint.
- **Atomic rate limit by install_id**: abuser can generate fresh install_ids to bypass, but each install gets 10 batches/min max. Flooding 10k install_ids/min means generating 10k UUIDs/min + 10k network connections/min — not impossible but raises the cost of attack well above the value of the harm.
- **RLS denies anon role** on all tables. Extracted anon key can't `SELECT` anything — not pins, not snapshots, not aggregate data. The extension is write-only by design.
- **Service role key never leaves the Edge Function.** Stored in Supabase platform env, not in any client.

### Threat: leaked service role key

Service role has full DB access. Mitigations:

- Stored only in Supabase platform environment, never in source, never in .env files committed
- Admin dashboard hosted server-side only; the service role never reaches the browser
- Rotate if a dashboard deployment ever exposes it

### Threat: malicious extension user

Someone modifies the extension to send fake data (inflated save counts, wrong pin_ids, spam).

- `pin_id` must match `/^[0-9]{6,20}$/` — fake IDs are still valid-format Pinterest IDs, but we have no way to distinguish a real from a fake one
- Partial mitigation: at query time, trust `pin_daily.unique_observers` more than `max_saves`. A pin with 1000 observers across many install_ids is real; a pin with 1 observer and 100k saves is suspect
- Detection job (Phase 3): flag install_ids with anomalously high unique-pin rates or outlier save-count distributions

### Threat: Pinterest changes the overlay API

Extension breaks. Ingestion drops. Not a security issue, but an operational one. Smoke test on every extension release against a live Pinterest page catches this early.

---

## 10. Build phases

### Phase 1 — Backend foundation — **mostly complete, fixes pending**

✅ Supabase project `pintwist` in us-west-1 ($10/mo)
✅ Schema: `pins`, `pin_snapshots`, `pin_daily`, `ingest_rate_limits` + indexes + trigger
✅ RLS enabled on all tables, no policies
✅ Edge Function `/functions/v1/ingest` deployed (verify_jwt=true)
✅ Smoke test harness (6/6 pass)

**Pending Phase 1 fixes before Phase 2:**
- ⏳ Atomic rate-limit function (`00002_rate_limit_fn.sql`)
- ⏳ `source_url` Pinterest-only validator in Edge Function
- ⏳ Save applied schema to `supabase/migrations/00001_init.sql`
- ⏳ `pg_cron` + rate-limit cleanup job (`00003_cron_cleanup.sql`)
- ⏳ Add concurrent rate-limit smoke test
- ⏳ Redeploy Edge Function, re-run tests

### Phase 2 — Extension wiring — *next*

- `src/ingest.ts`: buffer, flush, offline queue
- `src/content.ts`: hook `sendToIngest` after overlay renders
- install_id generation + storage
- Privacy modal + popup toggle
- Config constants (Supabase URL + anon key)
- Manifest updates (host_permissions, storage)
- Rebuild and test on live Pinterest

**Definition of done:** install extension, browse Pinterest, confirm rows landing in `pin_snapshots`. Toggle off = zero writes. Offline = queue accumulates, drains on reconnect.

### Phase 3 — Operations

- Nightly `rollup_pin_daily` cron
- Nightly `retain_pin_snapshots` 30-day cron
- Admin dashboard (Next.js, server-side service role)
- Trending pins query page
- Ingest health page
- Data export (CSV/JSON) for future AI layer
- Alerts (email via Supabase or a simple cron + Edge Function webhook)

**Definition of done:** dashboard shows real data after 7 days of ingestion. Rollup runs nightly without failure. Can export a niche slice on demand.

### Phase 4 — Ship

- Load test Edge Function (simulate 300 rps burst across many install_ids)
- Verify 30-day retention deletion works end-to-end with test data
- Package extension zip
- Write distribution README (load-unpacked instructions)
- Soft launch to ~20 users
- Watch first-week metrics before wider rollout

**Definition of done:** 20 users active for one week, ingestion stable, no alerts triggered, dashboard usable.

---

## 11. Scale ceilings & migration triggers

| Trigger | Action |
|---|---|
| `pin_snapshots` exceeds 2 GB | Migrate to monthly partitioning (no schema break) |
| DAU exceeds 3,000 | Shorten raw retention to 14 days |
| DAU exceeds 8,000 | Migrate `pin_snapshots` to Timescale or Clickhouse, keep `pin_daily` in Postgres |
| 429 rate > 20% sustained | Lower client flush frequency or raise server limit, investigate |
| Egress > 80% of plan | Review dashboard query patterns, add caching |

Each is a design change, not an emergency. Revisit when a trigger fires.

---

## 12. Future: cross-source intelligence

Out of scope for this plan, but the backend should make this possible without re-architecture:

- **Ingest from iscale-etsy** into a parallel `etsy_listings` or direct cross-join via a shared `trends` rollup table
- **Ingest Amazon scraper** low-BSR + recent-upload signals similarly
- **Social source** (TikTok/IG hashtag velocity via a third extension or API feed)
- **AI synthesis layer** consumes `pin_daily` + `etsy_daily` + `amazon_daily` via service-role queries, outputs ranked design recommendations

What this implies for the current plan:

- `pin_daily` is the stable contract. Keep its schema clean and slow to change.
- Data export from the admin dashboard produces JSON/CSV that matches what the AI layer will consume
- Embeddings + LLM tagging for cross-vocabulary entity resolution — planned separately when at least two sources are feeding data

---

## 13. Open decisions

Listed once, answer and we proceed.

1. **Fail-open vs fail-closed on rate-limit infra error?** Fail-open means a Postgres blip lets a batch through; fail-closed means we reject it. Leaning fail-open.

2. **Invalid `source_url`: null the field or reject the pin?** Nulling is friendlier; rejecting is louder about bugs. Leaning null.

3. **Rate-limit cleanup cadence?** Every 10 min / older than 5 min (plan default), every minute / 2 min (tighter), or every hour / 30 min (looser)? 10/5 feels balanced.

4. **Global rate limit as a backstop?** Currently only per-install_id. Add a global 10k req/min limit? Defer to Phase 3 with monitoring — don't add now.

5. **Admin dashboard hosting?** New Vercel project, same account as iscale-etsy's dashboard, or something else? Deferred until Phase 3.

6. **Distribution channel long-term?** Continuing unpacked-zip forever, or eventually publishing to Chrome Web Store for auto-updates? No decision needed for Phase 2–3, but affects Phase 4 rollout plan.

---

## 14. What's actually committed vs still plan

**Committed / live in Supabase:**
- Project created
- Schema applied (v1)
- Edge Function deployed (v1)
- Smoke test passing

**Not yet done (in order of dependency):**
1. Phase 1 fixes (rate-limit fn, source_url validator, migrations to repo, cron cleanup)
2. Phase 2 extension work
3. Phase 3 operations
4. Phase 4 ship

---

## 15. Repo layout after this plan is executed

```
workspace/apps/pintwist/
├── PLAN.md                                    ← this file
├── AGENTS.md, CLAUDE.md, README.md, etc.      ← existing
├── src/
│   ├── content.ts                             ← add sendToIngest hook
│   ├── popup.ts                               ← add toggle
│   ├── ingest.ts                              ← NEW: buffer + flush + queue
│   ├── privacy-modal.ts                       ← NEW
│   ├── background.ts                          ← existing, unchanged
│   └── constants/
│       └── config.ts                          ← NEW: supabase URL + anon key
├── supabase/
│   ├── migrations/
│   │   ├── 00001_init.sql                     ← schema
│   │   ├── 00002_rate_limit_fn.sql            ← atomic rate limit
│   │   └── 00003_cron_cleanup.sql             ← pg_cron setup
│   └── functions/
│       └── ingest/
│           └── index.ts                       ← Edge Function
├── tests/
│   └── ingest/
│       ├── smoke.mjs                          ← existing
│       └── concurrent_rate_limit.mjs          ← NEW Phase 1 fix test
├── dashboard/                                  ← Phase 3
│   └── ...Next.js app
└── popup.html, manifest.json, etc.            ← existing
```
