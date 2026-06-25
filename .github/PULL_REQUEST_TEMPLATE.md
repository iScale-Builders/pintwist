## Summary

<!-- What changed? Keep this concise. -->

## Why

<!-- What problem does this solve? Link the issue if one exists. -->

## Screenshots / Video

<!-- Required for UI changes. Remove if not applicable. -->

## Verification

<!-- Check only what you actually ran. -->

- [ ] Edited source files (not build outputs) and ran `corepack pnpm run build`
- [ ] `corepack pnpm run typecheck`
- [ ] `corepack pnpm test`
- [ ] Bumped `package.json` version + added a `CHANGELOG.md` entry if shipped files changed

## Safety Checklist

- [ ] No secrets, `.env` files, private data, or local runtime state
- [ ] No private workspace/agent bridge files (`AGENTS.md`, `memory/`, `tasks/`, etc.)
- [ ] No mock data presented as real
- [ ] No new permissions, network egress, or telemetry (PinTwist stays local-only)
- [ ] Signed off with `git commit -s` (DCO)
- [ ] iScaleLabs/PinTwist brand rules respected (`TRADEMARKS.md`)

## Notes For Maintainers

<!-- Risks, follow-ups, or review areas. -->
