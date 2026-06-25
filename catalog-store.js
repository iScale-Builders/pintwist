// Storage layer for the catalog's IMPORT rows: chooses the backend (IndexedDB, falling back
// to chrome.storage.local), performs the one-time legacy->IndexedDB migration, and load/save.
// Extracted from catalog.js so this data-loss-sensitive logic is unit-testable (catalog.js
// itself is DOM-bound and runs on load). The page keeps the in-memory catalog state; this
// module only persists/loads.

import { CATALOG_IMPORTS_KEY, catalogScanKey, mergeCatalogRows } from './catalog-utils.js';
import { catalogDbAvailable, countImports, getAllImports, replaceImports } from './catalog-db.js';

const CATALOG_MIGRATED_KEY = 'pintwist_catalog_idb_migrated_v1';

// True once IndexedDB is confirmed usable. Falls back to chrome.storage.local otherwise (and
// downgrades for the rest of the session if IndexedDB starts failing mid-use).
let useDb = false;

// Call once at startup before loadImports/saveImports.
export async function initImportsBackend() {
  useDb = await catalogDbAvailable();
  return useDb;
}

// For UI/debug: which backend is active.
export function importsBackendIsDb() {
  return useDb;
}

async function readLegacyImports() {
  const r = await chrome.storage.local.get({ [CATALOG_IMPORTS_KEY]: [] });
  return Array.isArray(r[CATALOG_IMPORTS_KEY]) ? r[CATALOG_IMPORTS_KEY] : [];
}

// Load the imports. On IndexedDB, migrate the legacy chrome.storage.local copy in exactly
// ONCE — gated by a persisted done-flag, NOT by "is IndexedDB empty". Gating on emptiness was
// a data-loss bug: if IndexedDB were ever evicted, the next open would re-run the migration
// and resurrect the frozen pre-migration rows over everything imported since. After a confirmed
// migrate we set the flag and drop the legacy copy (the user's CSV files are the real backup).
export async function loadImports() {
  if (!useDb) return readLegacyImports();
  try {
    const flag = await chrome.storage.local.get({ [CATALOG_MIGRATED_KEY]: false });
    if (!flag[CATALOG_MIGRATED_KEY]) {
      // Only import legacy rows if IndexedDB isn't already populated (avoids clobbering an
      // existing IDB catalog on a machine where the flag was somehow lost).
      if ((await countImports()) === 0) {
        const legacy = await readLegacyImports();
        if (legacy.length)
          await replaceImports(
            mergeCatalogRows([], legacy, { keyFn: catalogScanKey }),
            catalogScanKey
          );
      }
      await chrome.storage.local.set({ [CATALOG_MIGRATED_KEY]: true });
      await chrome.storage.local.remove(CATALOG_IMPORTS_KEY);
    }
    return await getAllImports();
  } catch (e) {
    console.warn(
      'PinTwist catalog: IndexedDB unavailable, using local storage:',
      (e && e.message) || e
    );
    useDb = false;
    return readLegacyImports();
  }
}

// Persist the full imports set. Prefers IndexedDB; if an IndexedDB write fails, downgrades to
// chrome.storage.local for the rest of the session and writes there (so a save is never lost
// silently to a transient IDB error). Throws only if the storage.local write also fails (e.g.
// quota) — the caller surfaces that.
export async function saveImports(rows) {
  if (useDb) {
    try {
      await replaceImports(rows, catalogScanKey);
      return true;
    } catch (e) {
      console.warn(
        'PinTwist catalog: IndexedDB save failed, falling back to local:',
        (e && e.message) || e
      );
      useDb = false;
    }
  }
  await chrome.storage.local.set({ [CATALOG_IMPORTS_KEY]: rows });
  return true;
}
