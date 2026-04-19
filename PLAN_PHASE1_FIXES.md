# Pintwist Phase 1 — Pre-Phase-2 Fixes

Four issues found in the initial Phase 1 build that should close before wiring the extension. Plan below. Approve, adjust, or reject each section.

## Summary of issues

| # | Issue | Severity | Lands in |
|---|---|---|---|
| 1 | Rate-limit check is racy (SELECT-then-UPSERT) | High — exploitable under concurrent load | DB function + Edge Function |
| 2 | `source_url` accepts any string; privacy leak risk if extension misfires off-Pinterest | High — breaks privacy promise | Edge Function |
| 3 | Applied schema not saved as a versioned migration file in the repo | Medium — reproducibility | Repo only |
| 4 | `ingest_rate_limits` grows unbounded with no cleanup | Medium — unbounded growth | pg_cron + extension |

---

## Fix #1 — Atomic rate limit

### Problem

Current flow in `supabase/functions/ingest/index.ts`:

```
1. SELECT batch_count FROM ingest_rate_limits WHERE install_id AND window_start
2. if batch_count >= 10 → 429
3. UPSERT row with batch_count + 1
```

Two concurrent batches from the same `install_id` can both read count=5, both pass the check, both write count=6. Effective limit under concurrent load is **10 × concurrency**.

### Fix

Move the check + increment into a single atomic SQL statement inside a Postgres function. The function does one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` and returns `(allowed, current_count)`.

### New migration `00002_rate_limit_fn.sql`

```sql
create function public.bump_rate_limit(
  p_install_id uuid,
  p_window_start timestamptz,
  p_limit integer
) returns table(allowed boolean, current_count integer)
language plpgsql
security definer
as $$
declare
  v_count integer;
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

`security definer` + restricted grant: only service role can call it, bypassing RLS cleanly.

### Edge Function change (`supabase/functions/ingest/index.ts`)

Replace the SELECT-then-UPSERT block with one RPC call:

```ts
const { data: rl, error: rlErr } = await supabase
  .rpc("bump_rate_limit", {
    p_install_id: payload.install_id,
    p_window_start: windowStart,
    p_limit: RATE_LIMIT_MAX_BATCHES,
  })
  .single();

if (rlErr) {
  console.error("rate_limit rpc error:", rlErr);
  // Fail open on rate-limit infra error — better to accept a batch than drop legit data
} else if (rl && !rl.allowed) {
  return jsonResponse(
    { error: "rate_limited", retry_after: RATE_LIMIT_WINDOW_SEC },
    429,
  );
}
```

Trade-off: the atomic bump happens *before* we know if pins/snapshots inserts will succeed. If inserts fail, we've consumed a rate-limit slot. This is fine — the client will retry and get a 500, not a 429, and the retry also consumes a slot. Worst case: slightly *lower* effective limit during failures. Never *higher*.

Also: delete the separate bump UPSERT at the end of the handler (rolled into the rpc).

---

## Fix #2 — `source_url` validation

### Problem

Edge Function accepts any `source_url` ≤ 2048 chars. If the extension ever overlays on a non-Pinterest page (bug, misinjection, maliciously modified build), we'd log the user's browsing history. Breaks the privacy promise in the first-launch modal.

### Fix

In `cleanString` or a dedicated validator, enforce host is `*.pinterest.com` over HTTPS. If not, null the field out silently (keep the rest of the pin data — it's still useful).

### Edge Function change

Add helper near top:

```ts
function cleanPinterestUrl(s: unknown): string | null {
  const str = cleanString(s, 2048);
  if (!str) return null;
  try {
    const u = new URL(str);
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)pinterest\.com$/i.test(u.hostname)) return null;
    return str;
  } catch {
    return null;
  }
}
```

Use in the snapshot row build:

```ts
source_url: cleanPinterestUrl(p.source_url),
```

Leave `search_terms` and other fields as-is.

### Additional guard at extension layer (Phase 2)

In `content.ts` before adding a pin to the send buffer: assert `location.hostname.endsWith("pinterest.com")`. Defense in depth.

---

## Fix #3 — Versioned migrations in the repo

### Problem

The initial schema was applied via MCP `apply_migration` but not saved as a file. The DB exists; the repo can't reproduce it. A fresh dev or staging environment can't be spun up from source.

### Fix

Save two files under `supabase/migrations/`:

- `00001_init.sql` — the schema already in production (pins, pin_snapshots, pin_daily, ingest_rate_limits, indexes, trigger, RLS)
- `00002_rate_limit_fn.sql` — the new rate-limit function from Fix #1

These match the MCP migration names so `supabase db pull` would line up if we wire up the CLI later.

No DB change — files only.

---

## Fix #4 — Rate-limit cleanup cron

### Problem

`ingest_rate_limits` only needs rows for ~60 seconds (the current window). Nothing deletes old rows. At 500 DAU × ~1440 windows/day = up to 720k rows/day accumulating forever. Indexes slow. Waste.

### Fix

Enable `pg_cron` extension (standard on Supabase Pro) and schedule a cleanup every 10 minutes. Rows older than 5 minutes are safe to drop — long past any active rate-limit window.

### New migration `00003_cron_cleanup.sql`

```sql
create extension if not exists pg_cron with schema extensions;

grant usage on schema cron to postgres;

select cron.schedule(
  'cleanup_ingest_rate_limits',
  '*/10 * * * *',
  $$delete from public.ingest_rate_limits where window_start < now() - interval '5 minutes'$$
);
```

Verify with:

```sql
select jobname, schedule, active from cron.job;
```

### Future (Phase 3)

Same pattern will handle:
- `pin_snapshots` 30-day retention
- Nightly rollup into `pin_daily`

Out of scope for Phase 1 fixes, but the `pg_cron` extension landing here sets up that infra.

---

## Updated final state (after all four fixes)

**Schema:** unchanged except new `bump_rate_limit` function + `pg_cron` extension + cleanup job.

**Edge Function:** atomic rate limit via RPC, Pinterest-only `source_url`, no separate end-of-handler UPSERT.

**Repo:** `supabase/migrations/` has three files tracking the full DB state.

**Tests:** same smoke test should pass unchanged. Will add one new test:

- Concurrent rate-limit test: fire 15 batches in parallel, expect exactly 10 to succeed and 5 to be 429'd. Proves atomic behavior.

---

## Rollout order

1. Write both new migration files to repo
2. Apply `00002_rate_limit_fn.sql` to DB
3. Apply `00003_cron_cleanup.sql` to DB (enables pg_cron)
4. Also write `00001_init.sql` retroactively to repo (no DB change)
5. Update `supabase/functions/ingest/index.ts` with atomic RPC + Pinterest-URL validator
6. Redeploy Edge Function
7. Re-run full smoke test (should still pass)
8. Add concurrent rate-limit test, run it
9. Verify `cron.job` has the cleanup scheduled
10. Truncate test data again

---

## Open questions for reviewer

1. **Fail-open vs fail-closed on rate-limit infra error?** Plan has fail-open (accept batch). Alternative: fail-closed (return 503) if `bump_rate_limit` rpc errors. Fail-open keeps data flowing during transient issues; fail-closed prevents accidental over-ingest during bugs. Leaning fail-open.

2. **`source_url` validation: null vs reject?** Plan nulls invalid URLs and still accepts the pin. Alternative: reject the whole pin. Nulling is friendlier; rejecting is louder about bugs. Leaning null.

3. **Cleanup interval.** Plan is every 10 min for rows older than 5 min. Could do every minute / older than 2 min (tighter) or every hour / older than 30 min (looser). 10/5 feels balanced.

4. **Should we also add a global rate limit now?** The plan I wrote earlier mentioned "global: 10k req/min" as a backstop. Not in this fix plan — adds complexity. Defer to Phase 3 when we have monitoring to see if it's needed.
