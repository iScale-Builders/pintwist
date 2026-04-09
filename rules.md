# rules.md

This file is law for workspace folder structure.

If any other workspace doc conflicts with this file, this file wins.

## App location law

- Apps may exist in only one location:
  - `workspace/apps/<app-name>/`
- Do not create app copies, execution copies, mirrors, or alternate live app folders anywhere else.

## Runtime location law

- Every app keeps its runtime files inside its own folder:
  - `workspace/apps/<app-name>/runtime/`
- Runtime files may include machine-local databases, browser profiles, caches, temp files, logs, exports, lock files, sessions, and service state.
- Do not place runtime files outside the owning app folder.

## Execution law

- Machines run apps from their local workspace path under `workspace/apps/<app-name>/`.
- The NAS is the one shared brain for all memories, skills, and knowledge. For app execution, the NAS is not a live runtime — apps run from the local machine.
- Runtime files remain machine-local even though they live under the app's `runtime/` folder on the owning machine.

## Forbidden patterns

- `~/.openclaw/local-apps/`
- top-level app folders outside `workspace/apps/`
- separate execution copies outside the owning app folder
- app-specific runtime folders outside `workspace/apps/<app-name>/runtime/`

## Migration rule

- If an app or its runtime exists outside `workspace/apps/<app-name>/`, move it into the canonical app folder.
- If runtime data exists outside `workspace/apps/<app-name>/runtime/`, move it into that app's `runtime/` folder.
- Do not preserve conflicting layouts as parallel long-term structures.

