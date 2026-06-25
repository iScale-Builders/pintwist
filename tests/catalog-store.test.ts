import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initImportsBackend,
  loadImports,
  saveImports,
  importsBackendIsDb,
} from '../catalog-store.js';
import { clearImports, countImports } from '../catalog-db.js';

const realIDB = globalThis.indexedDB;
const IMPORTS_KEY = 'pintwist_catalog_imports';
const MIGRATED = 'pintwist_catalog_idb_migrated_v1';

// Minimal in-memory chrome.storage.local mock (object-default get / set / remove).
let store: Record<string, unknown> = {};
function installChromeMock() {
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: (defaults: Record<string, unknown>) => {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(defaults || {})) out[k] = k in store ? store[k] : defaults[k];
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
          return Promise.resolve();
        },
        remove: (key: string | string[]) => {
          (Array.isArray(key) ? key : [key]).forEach((k) => delete store[k]);
          return Promise.resolve();
        },
      },
    },
  };
}

describe('catalog-store imports backend (migration + fallback)', () => {
  beforeEach(async () => {
    store = {};
    (globalThis as { indexedDB?: unknown }).indexedDB = realIDB;
    installChromeMock();
    await initImportsBackend();
    await clearImports();
  });

  it('migrates legacy storage.local imports into IndexedDB once, then drops the legacy copy', async () => {
    store[IMPORTS_KEY] = [{ pin_id: '1', title: 'A', saves: 5 }];
    const rows = await loadImports();
    expect(rows.map((r: { pin_id: string }) => r.pin_id)).toEqual(['1']);
    expect(await countImports()).toBe(1);
    expect(store[MIGRATED]).toBe(true);
    expect(IMPORTS_KEY in store).toBe(false); // legacy copy removed
  });

  it('does NOT re-migrate / resurrect after the flag is set, even if IndexedDB is emptied', async () => {
    store[IMPORTS_KEY] = [{ pin_id: '1', title: 'A' }];
    await loadImports(); // migrates, sets flag, removes legacy
    // Simulate IndexedDB eviction + a stale legacy copy reappearing.
    await clearImports();
    store[IMPORTS_KEY] = [
      { pin_id: '1', title: 'A' },
      { pin_id: '2', title: 'STALE' },
    ];
    const rows = await loadImports();
    expect(rows).toEqual([]); // flag set -> no migration -> empty IDB, NOT resurrected legacy
  });

  it('does not clobber an already-populated IndexedDB when the flag is unset', async () => {
    await saveImports([{ pin_id: '9', title: 'EXISTING', saves: 50 }]); // into IDB
    store[IMPORTS_KEY] = [{ pin_id: '1', title: 'LEGACY' }]; // legacy present, flag still unset
    const rows = await loadImports();
    expect(rows.map((r: { pin_id: string }) => r.pin_id)).toEqual(['9']); // kept IDB, ignored legacy
    expect(store[MIGRATED]).toBe(true);
  });

  it('falls back to chrome.storage.local when IndexedDB is unavailable', async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = undefined;
    await initImportsBackend();
    expect(importsBackendIsDb()).toBe(false);
    await saveImports([{ pin_id: '1', title: 'L' }]);
    expect((store[IMPORTS_KEY] as unknown[]).length).toBe(1); // wrote to storage.local
    const rows = await loadImports();
    expect(rows.map((r: { pin_id: string }) => r.pin_id)).toEqual(['1']); // read from storage.local
  });
});
