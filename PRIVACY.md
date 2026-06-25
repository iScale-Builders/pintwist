# Privacy

PinTwist is local-only.

- No account is required.
- No third-party authentication is included.
- No remote backend is called.
- No telemetry or pin-observation ingest is included.
- No cookies permission is requested.
- Pinterest metric requests are made from the active Pinterest page/session so
  the extension can render overlays, sorting, filtering, and CSV exports.
- Scraped/captured rows are stored locally in the current Chrome profile:
  live-scanned pins in `chrome.storage.local`, and CSV-imported catalog pins in a
  local IndexedDB database. Both stay on your device.
- Users can export accumulated rows to CSV and can clear local catalog rows.

This open-source edition has no backend data-contribution path. Your data stays
on your machine unless you export it yourself.
