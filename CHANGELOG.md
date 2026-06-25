# Changelog

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
