import { describe, it, expect } from 'vitest';
import { C } from './loadContent';

// PHASE-0 SAFETY NET — "final-binding" guards.
//
// content.js uses a late-binding decorator pattern: a base `function foo(){...}` is
// declared, then a later IIFE reassigns `foo = function(){ ...originalFoo()... }`. The
// LAST assignment wins, and a refactor that drops/reorders a reassignment silently
// reverts behavior to the base (this is the root cause of the recurring regression
// class — e.g. a previously dropped setupResortBar glass decorator).
//
// These tests assert the BEHAVIOR of the decorated layer through the harness, not the
// source text, so they survive renames/reformatting but fail loudly if a decorator
// stops being the final binding.

describe('content.js final-binding decorators are live (perf-hotfix layer)', () => {
  it('fetchBulk routes through the bulk runtime endpoint, not per-pin messages', async () => {
    // Base fetchBulk sends one { action: "fetchPinData" } message per pin; the
    // perf-hotfix decorator replaces it with a single { action: "fetchBulkPins" }
    // batch call. If the decorator were dropped, the first action would be fetchPinData.
    const calls: any[] = [];
    const realSend = C.chrome.runtime.sendMessage;
    C.chrome.runtime.sendMessage = (msg: any, cb?: any) => {
      calls.push(msg);
      const res = { success: true, results: {} };
      if (typeof msg === 'function') return void msg(res);
      if (typeof cb === 'function') return void cb(res);
      return Promise.resolve(res);
    };
    try {
      await C.fetchBulk(['111', '222']);
    } finally {
      C.chrome.runtime.sendMessage = realSend;
    }
    const actions = calls.map((m) => m && m.action).filter(Boolean);
    // The decorator's signature is a bulk-FIRST call. (A per-pin fetchPinData may follow
    // as the legitimate fallback when the bulk reply has no results — that's the base
    // path used as a fallback, not the dropped-decorator regression. The regression we
    // guard against is fetchPinData being FIRST, i.e. the decorator never ran.)
    expect(actions[0]).toBe('fetchBulkPins');
    expect(actions).toContain('fetchBulkPins');
  });

  it('toggleOverlays(false) removes live overlay nodes, not just hides them', () => {
    // Base toggleOverlays only flips display; the decorator additionally REMOVES the
    // overlay DOM under each pin when hiding outside the sorted view (memory-cap work).
    document.body.innerHTML = `
      <div data-test-pin-id="1"><div class="pintwist-metrics-overlay"></div></div>`;
    expect(document.querySelectorAll('.pintwist-metrics-overlay').length).toBe(1);
    C.toggleOverlays(false);
    expect(document.querySelectorAll('.pintwist-metrics-overlay').length).toBe(0);
  });

  it('exposes the decorated functions as the resolved global bindings', () => {
    // Cheap structural backstop: the decorated names must still resolve to functions.
    for (const name of [
      'fetchBulk',
      'toggleOverlays',
      'clearState',
      'startSortingProcess',
      'setupResortBar',
      'processPinsBulk',
    ]) {
      expect(typeof C[name], `${name} should be a function`).toBe('function');
    }
  });

  it('setupResortBar resolves to the shadow renderer, not the dropped glass decorator', () => {
    // setupResortBar was reassigned twice (glass decorator, then the Shadow-DOM renderer);
    // the glass one was overwritten and its reassignment removed. Guard that the
    // resolved binding is the shadow renderer (binds the resort sort-choice buttons), so a
    // future reorder can't silently make a glass/base version win again.
    const src = C.setupResortBar.toString();
    expect(src).toContain('pintwist-sort-choice');
    expect(src).not.toContain('injectGlassRailStyle'); // the removed glass-decorator marker
  });
});
