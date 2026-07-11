# Changelog

## 1.0.5 — Hardening: trusted-input gates + import bounds

- **PinTwist controls now only react to real user input.** Every toolbar, automation,
  and settings handler checks `event.isTrusted`, so a Pinterest page script can't
  synthesize clicks or keypresses into the extension's UI (extends the existing guard on
  the destructive export button to all controls). The automation queue's own scheduled
  scan-start runs through an internal bypass that page scripts cannot reach — automation
  behavior is unchanged.
- **CSV import bounds.** Imports refuse files over 64 MB and batches over 512 MB with a
  clear message, and the unique-pin cap (500k) is now enforced inside the streaming
  merger mid-file — a single enormous CSV can no longer blow past it.
- **Build safety.** `build.cjs` copies only an explicit allowlist of image assets and
  fails closed if anything unexpected appears in `images/` — local scratch files can
  never ship into `dist/`.

## 1.0.4 — Catalog: repins group by image, copies panel

- **"Group by design" now catches Pinterest repins.** Every repin of an image gets a new
  pin id (usually with no or a different title), so the same picture used to stay as
  separate cards even in grouped view. Grouping now unions two signals: the image's
  content filename (identical across repins and size buckets) and the title+description
  identity — so repins, re-uploads, and titleless copies of one design all collapse into
  a single card.
- **New copies panel on grouped cards.** A "⧉ N pins" button lists every copy of the
  design with its own pin link, saves, and first→last seen dates — per-copy metrics stay
  separate (never pooled), matching how the per-pin scrape history already works.

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
