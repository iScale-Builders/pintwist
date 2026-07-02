# Changelog

## 1.0.3 — Post-audit hardening

Small correctness, reliability, and quality fixes from an independent security & code
review. No change to permissions, data handling, or the local-only design.

- **Reliability:** rate-limit backoff in the background worker no longer risks the MV3
  service worker being killed mid-wait (a search could hang); capped the bulk-fetch
  fallback concurrency so it can't hammer an endpoint that just rate-limited us.
- **Data safety:** a catalog save that fell back to local storage after an IndexedDB
  write failure is now merged back on the next open, instead of being silently dropped
  when IndexedDB recovers.
- **Hardening (defense-in-depth):** pin metric values are coerced to numbers before they
  reach any HTML, and the automation number inputs escape their attribute values.
- **Cleanup:** removed dead dark-mode code from the popup (dark/light lives on the catalog
  page); removed a write-only storage key; unified the default theme color; fixed a
  timezone-related off-by-one in the catalog's "last N days" date presets; modernized CSV
  encoding; quieted a spurious message-port warning; tightened lint to zero warnings.
- **Docs:** documented the optional automation queue (pacing + backs off on rate
  limits / security checks); cross-platform command fences in the README.

## 1.0.2 — Catalog dedup fix

- Fixed the catalog showing one design as several separate cards. Some Pinterest pins (ads and aggregated results) carry a volatile id token that changes per search term, so the same design was being split into a separate card per keyword. Those copies now collapse into a single card (keeping their scrape history), while genuinely distinct pins still keep their own metrics.

## 1.0.1 — Pre-release cleanup

Internal code cleanup ahead of the public release. No user-facing behavior changes.

- Removed dead code (orphaned functions and unused constants) and two stray debug logs.
- Corrected the README (the on-page UI is the toolbar; the old "rail" layout was removed).
- Added repository metadata and tightened linting.

## 1.0.0 — Initial public release

PinTwist — a local-only Chrome extension for Pinterest research.

- **On-page metrics.** Overlays public pin metrics (saves, comments, reactions, repins, shares, last activity) directly on Pinterest pages, and lets you sort and filter pins by any of them.
- **Local catalog.** Accumulate scans and import CSVs into one local catalog, deduped per pin, with filtering, sorting, a "group by design" view, and CSV export.
- **Local-only.** Everything runs on your machine using your own Pinterest session — no account, no server, nothing leaves the browser.
