// IndexedDB-backed storage for the catalog's IMPORT rows.
//
// chrome.storage.local stores the whole catalog as a single JSON value and re-serializes
// the entire array on every write — fine for a few thousand pins, but it doesn't scale
// (whole-array rewrites + load-everything-into-memory). IndexedDB stores one record per
// pin, so writes are per-record and the store can hold far more.
//
// Scope: this module owns the IMPORT store only (the catalog page's own data). The scan-
// accumulation store stays in chrome.storage.local because the content script runs on the
// Pinterest origin and can't reach the extension page's IndexedDB; the catalog page reads
// that small store from chrome.storage.local and unions it in for display.
//
// Keys are out-of-line: the caller passes the catalog identity key (catalogPinKey) at write
// time, so one pin = one record (re-importing overwrites rather than duplicating).

const DB_NAME = 'pintwist_catalog';
const DB_VERSION = 1;
const STORE = 'imports';

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('indexeddb_open_failed'));
  });
  return _dbPromise;
}

// True when IndexedDB is usable here (false in some private modes / very old browsers).
// Also best-effort asks the browser to persist our data so it isn't evicted under disk
// pressure — important since this is the user's accumulated research corpus.
export async function catalogDbAvailable() {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return false;
    await openDb();
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist();
      }
    } catch {
      /* persistence is best-effort */
    }
    return true;
  } catch {
    return false;
  }
}

export async function countImports() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).count();
    r.onsuccess = () => resolve(r.result || 0);
    r.onerror = () => reject(r.error);
  });
}

export async function getAllImports() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result : []);
    r.onerror = () => reject(r.error);
  });
}

// Replace the entire import store with `rows`, each keyed by keyFn(row). `rows` is the
// already-deduped finalized set (one record per identity), so clear + put-all in one
// transaction is correct and atomic. Falls back through pin_id/url/image, then a positional
// key, so a row with no usable identity still stores (and won't collide with another).
export async function replaceImports(rows, keyFn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('indexeddb_tx_aborted'));
    // A synchronous throw from store.put (e.g. a non-cloneable value) would otherwise escape
    // the executor after clear() already ran, leaving the promise forever-pending and the
    // store emptied. Catch it, abort the transaction, and reject so the caller can surface it.
    try {
      const store = t.objectStore(STORE);
      store.clear();
      (rows || []).forEach((row, i) => {
        const key =
          (keyFn && keyFn(row)) || row.pin_id || row.pin_url || row.image_url || 'row:' + i;
        store.put(row, key);
      });
    } catch (e) {
      try {
        t.abort();
      } catch {
        /* already aborting */
      }
      reject(e);
    }
  });
}

export async function clearImports() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).clear();
    t.oncomplete = () => resolve(true);
    t.onerror = () => reject(t.error);
  });
}
