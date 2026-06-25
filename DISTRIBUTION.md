# PinTwist Distribution

Loadable extension folder:

```text
dist
```

This is the local-only build. Users install it without signing in.

## Privacy Surface

- Stores settings, scan cache, and Local Catalog rows in Chrome extension storage.
- Fetches Pinterest pin details only from Pinterest hosts allowed in `manifest.json`.
- Does not request `cookies`.
- Does not declare any account, auth, or backend hosts.
- Does not send pin observations or user data to a backend.

## Build

```powershell
corepack pnpm install
corepack pnpm run build
```

After building, load `dist` as an unpacked extension in Chrome.
