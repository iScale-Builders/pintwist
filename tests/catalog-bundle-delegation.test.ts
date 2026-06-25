import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as catalogUtils from '../catalog-utils';

// PHASE-0/2 SAFETY NET — PintwistCatalog delegation parity.
//
// content.js does not import catalog-utils; at runtime it calls the `PintwistCatalog`
// global, which ships as js/pintwist-catalog-shared.js (esbuild bundle of catalog-utils.js,
// loaded as a content script before content.js). As the modularization Phase 2 moves more
// merge/identity logic behind that global, a rename in catalog-utils — or a stale bundle —
// would make content.js call a function that no longer exists, with no compile error.
//
// This test extracts every PintwistCatalog.<name> content.js references and asserts the
// name resolves to a function BOTH in the catalog-utils source AND in the shipped bundle.

const root = process.cwd();
const contentSrc = readFileSync(resolve(root, 'js', 'content.js'), 'utf8');
const bundleSrc = readFileSync(resolve(root, 'js', 'pintwist-catalog-shared.js'), 'utf8');

// Names content.js calls off the global (e.g. `PintwistCatalog.catalogScanKey`).
const usedNames = Array.from(
  new Set(Array.from(contentSrc.matchAll(/PintwistCatalog\.([A-Za-z_]\w*)/g), (m) => m[1]))
);

// Evaluate the shipped UMD-ish bundle (`var PintwistCatalog = (() => {...})()`) in an
// isolated function scope and return the produced global object.
function loadBundleGlobal(): Record<string, unknown> {
  // eslint-disable-next-line no-new-func
  return new Function(`${bundleSrc}\n;return PintwistCatalog;`)() as Record<string, unknown>;
}

describe('PintwistCatalog delegation parity (content.js ↔ catalog-utils ↔ shipped bundle)', () => {
  it('content.js references at least one PintwistCatalog export (sanity)', () => {
    expect(usedNames.length).toBeGreaterThan(0);
  });

  it('every PintwistCatalog.* used by content.js exists as a function in catalog-utils source', () => {
    for (const name of usedNames) {
      expect(typeof (catalogUtils as any)[name], `catalog-utils missing ${name}`).toBe('function');
    }
  });

  it('the shipped bundle exposes those same names as functions (not stale)', () => {
    const bundle = loadBundleGlobal();
    for (const name of usedNames) {
      expect(typeof bundle[name], `shipped bundle missing ${name}`).toBe('function');
    }
  });

  it('bundle export surface matches the catalog-utils source export surface', () => {
    const bundle = loadBundleGlobal();
    const sourceFns = Object.keys(catalogUtils)
      .filter((k) => typeof (catalogUtils as any)[k] === 'function')
      .sort();
    const bundleFns = Object.keys(bundle)
      .filter((k) => typeof bundle[k] === 'function')
      .sort();
    expect(bundleFns).toEqual(sourceFns); // drift = source changed without rebuild
  });
});
