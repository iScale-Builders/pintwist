/**
 * Behavioral test harness: loads the REAL js/content.js into the jsdom test global
 * (with chrome + disruptive timers/observers mocked) so tests can call the actual
 * shipped functions instead of re-implementations. Top-level `function` declarations
 * leak to globalThis via indirect eval; we read them off `C` below.
 *
 * 'use strict' is stripped only for this in-memory test copy (the shipped file keeps it);
 * strict vs sloppy doesn't change the pure logic these tests exercise.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const g = globalThis as any;

// ---- in-memory chrome.* mock (callback AND promise forms) ----
const store: { local: Record<string, any>; sync: Record<string, any> } = { local: {}, sync: {} };
function area(bucket: Record<string, any>) {
  return {
    get(keys: any, cb?: any) {
      let res: Record<string, any> = {};
      if (keys == null) res = { ...bucket };
      else if (typeof keys === 'string') res = { [keys]: bucket[keys] };
      else if (Array.isArray(keys)) keys.forEach((k) => (res[k] = bucket[k]));
      else if (typeof keys === 'object')
        for (const k of Object.keys(keys)) res[k] = k in bucket ? bucket[k] : keys[k];
      if (typeof cb === 'function') return void cb(res);
      return Promise.resolve(res);
    },
    set(obj: Record<string, any>, cb?: any) {
      Object.assign(bucket, obj);
      if (typeof cb === 'function') return void cb();
      return Promise.resolve();
    },
    remove(keys: any, cb?: any) {
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete bucket[k]);
      if (typeof cb === 'function') return void cb();
      return Promise.resolve();
    },
  };
}
g.__pintwistStore = store;
g.chrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined,
    getManifest: () => ({ version: '1.0.0' }),
    getURL: (p: string) => 'chrome-extension://test/' + p,
    onMessage: { addListener() {} },
    sendMessage: (msg: any, cb?: any) => {
      if (typeof msg === 'function') return void msg({ success: true });
      if (typeof cb === 'function') return void cb({ success: true });
    },
  },
  storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
  tabs: {
    query: (_q: any, cb?: any) => (typeof cb === 'function' ? cb([]) : undefined),
    sendMessage() {},
    create() {},
  },
  downloads: { download() {} },
};

// ---- stub disruptive globals so the load-time IIFEs/bootstrap don't hang ----
g.MutationObserver = class {
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};
g.setTimeout = () => 0;
g.setInterval = () => 0;
if (!g.fetch) g.fetch = () => Promise.resolve({ json: () => Promise.resolve({}), ok: true });

// In the browser, catalog-utils ships as the `PintwistCatalog` global (a separate
// content script loaded before content.js). The harness evals content.js directly,
// so provide that global here from the module.
import * as PintwistCatalog from '../catalog-utils';
g.PintwistCatalog = PintwistCatalog;

const raw = readFileSync(resolve(process.cwd(), 'js', 'content.js'), 'utf8');
const code = raw.replace(/^\s*['"]use strict['"];?/, ''); // sloppy eval -> top-level fn decls leak to globalThis
(0, eval)(code);

// The live content-script functions are now on globalThis.
export const C = globalThis as any;
