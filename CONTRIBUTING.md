# Contributing to PinTwist

Thank you for considering a contribution. PinTwist is open source, but it is
maintainer-led: contributions are welcome when they fit the product direction,
quality bar, license obligations, and public-repo safety rules.

## Before You Start

Open an issue before starting work when the change is large, changes product
direction, changes the extension's permissions or data handling, affects
licensing/branding, changes the build pipeline, or adds a dependency.

Small fixes can go straight to a pull request.

## Contribution Terms

By contributing, you confirm that:

- you have the right to submit the contribution;
- your contribution is submitted under this repository's license (Apache-2.0);
- your contribution does not include secrets, private data, or code copied from
  a source that cannot be redistributed here;
- you understand that maintainers may edit, reject, or close contributions that
  do not fit the project.

We use Developer Certificate of Origin style sign-off. Please sign commits with:

```bash
git commit -s -m "Describe the change"
```

## Local Setup

```bash
git clone https://github.com/iScale-Builders/pintwist.git
cd pintwist
corepack pnpm install
corepack pnpm run build
```

Load `dist/` from `chrome://extensions` with Developer mode enabled.

## Source Of Truth (build outputs)

Some files in `js/` are build outputs — editing them directly will be overwritten
by the next build. Edit the source, then run `corepack pnpm run build`.

| Edit this (source) | Generates (do not edit) |
| --- | --- |
| `js/content.js` | `dist/js/content.js` (minified) |
| `src/background.js` | `js/background.js`, `dist/js/background.js` |
| `src/popup.js` | `popup.js`, `dist/popup.js` |
| `catalog-utils.js` | `js/pintwist-catalog-shared.js` |

The version in `package.json` is the source of truth and `build.cjs` syncs it into
`manifest.json`.

## Required Checks

Before opening a pull request, run:

```bash
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm run build
node --check dist/js/content.js
node --check dist/js/background.js
node --check dist/popup.js
```

Do not add a check to the pull request description unless it actually passed.

## Product Standards

- Keep PinTwist local-only, with no backend.
- Do not add accounts, third-party authentication, a remote backend, telemetry,
  ingest, or the cookies permission.
- Keep user data local unless the user explicitly exports it.
- Keep the existing visual system and interaction patterns unless the issue or
  pull request explicitly proposes a design change.
- Do not present mock or fake data as real.

## Safety Rules

Do not commit:

- `.env` files, tokens, credentials, or real secrets;
- local runtime state, logs, or machine-specific config;
- `AGENTS.md`, `CLAUDE.md`, `ROUTER.md`, `memory/`, `tasks/`, or private
  workspace/agent bridge files;
- private iScaleLabs planning docs, production data, screenshots with private
  data, or internal operating process.

## License And Attribution

This project is distributed under the Apache License, Version 2.0.

iScaleLabs and PinTwist names, logos, icons, and brand assets are not licensed
for reuse just because the code is public. See `NOTICE.md` and `TRADEMARKS.md`.

## Pull Request Expectations

Pull requests should include:

- a clear summary;
- why the change is needed;
- screenshots or screen recordings for UI changes;
- the checks you ran;
- any risks or follow-up work.

Maintainers may request changes, squash commits, edit wording, or close pull
requests that are stale, unsafe, too broad, off-direction, or not worth the
maintenance cost.

## Reporting Bugs And Security Issues

Use GitHub issues for normal bugs and feature requests.

Report security issues privately by following `SECURITY.md`.
