import { describe, it, expect } from 'vitest';
import { C } from './loadContent';
import { mergeCatalogRows, catalogScanKey } from '../catalog-utils';

// PHASE-0 SAFETY NET — merge-engine parity.
//
// The catalog merge logic exists twice: content.js's `pintwistMergeCatalogRows` (live
// scan path) and catalog-utils' shared `mergeCatalogRows` (import/catalog-page path).
// Phase 2 of the modularization deletes content's copy and delegates to the shared one
// keyed by `catalogScanKey`. This test pins the CONTRACT that delegation must preserve,
// so drift between the two engines is caught before the swap (and after it).

const row = (over: Record<string, any>) => ({
  pin_id: '',
  pin_url: '',
  title: '',
  description: '',
  image_url: 'https://i.pinimg.com/474x/a/b/c.jpg',
  saves: 0,
  comments: 0,
  repins: 0,
  reactions: 0,
  shares: 0,
  total_engagement: 0,
  scanned_at: '2026-06-21T00:00:00.000Z',
  ...over,
});

// Project a merged row set to the identity-keyed fields the two engines AGREE ON today:
// the dedup key set and the final (last-write-wins) metrics + engagement. History
// internals and row ordering are engine-private, so they're excluded. seen_count and
// search_term are KNOWN to diverge — see the it.todo block below; they are the contract
// Phase 2 must reconcile before content delegates to the shared engine.
function project(rows: any[]) {
  const out: Record<string, any> = {};
  for (const r of rows) {
    const key = catalogScanKey(r);
    out[key] = {
      saves: Number(r.saves) || 0,
      comments: Number(r.comments) || 0,
      repins: Number(r.repins) || 0,
      reactions: Number(r.reactions) || 0,
      shares: Number(r.shares) || 0,
      total_engagement: Number(r.total_engagement) || 0,
    };
  }
  return out;
}

function bothEngines(existing: any[], incoming: any[]) {
  const content = C.pintwistMergeCatalogRows(existing, incoming);
  const shared = mergeCatalogRows(existing, incoming, { keyFn: catalogScanKey });
  return { content: project(content), shared: project(shared) };
}

describe('catalog merge parity — content.js vs shared catalog-utils', () => {
  it('dedupes the same pin_id seen across terms into one row', () => {
    const existing = [
      row({ pin_id: '100', search_term: 'wall art', saves: 10, total_engagement: 10 }),
    ];
    const incoming = [
      row({ pin_id: '100', search_term: 'boho art', saves: 25, total_engagement: 25 }),
      row({ pin_id: '200', search_term: 'boho art', saves: 5, total_engagement: 5 }),
    ];
    const { content, shared } = bothEngines(existing, incoming);
    expect(Object.keys(content).sort()).toEqual(Object.keys(shared).sort());
    expect(content).toEqual(shared);
  });

  it('takes the latest observation as the live metrics (last-write-wins)', () => {
    const existing = [row({ pin_id: '300', saves: 100, total_engagement: 100 })];
    const incoming = [row({ pin_id: '300', saves: 140, total_engagement: 140 })];
    const { content, shared } = bothEngines(existing, incoming);
    expect(content).toEqual(shared);
    const key = catalogScanKey(row({ pin_id: '300' }));
    expect(content[key].saves).toBe(140);
  });

  it('agrees on final metrics across multiple sightings of one pin in a batch', () => {
    const existing = [row({ pin_id: '400', search_term: 'a', saves: 1, total_engagement: 1 })];
    const incoming = [
      row({ pin_id: '400', search_term: 'b', saves: 2, total_engagement: 2 }),
      row({ pin_id: '400', search_term: 'c', saves: 3, total_engagement: 3 }),
    ];
    const { content, shared } = bothEngines(existing, incoming);
    expect(content).toEqual(shared);
    expect(content[catalogScanKey(row({ pin_id: '400' }))].saves).toBe(3);
  });

  // KNOWN DIVERGENCES (documented, not yet reconciled) — the two engines do NOT agree on:
  //   1. seen_count: content seeds the existing row WITHOUT counting it and +1 per incoming
  //      observation; shared counts every ingested row (existing seed included). So for
  //      "existing(1) + incoming(2)" content reports 2, shared reports 3.
  //   2. search_term: content UNIONS all terms a pin was seen under ("a | b | c"); shared
  //      keeps only the latest row's term ("c").
  // Phase 2 (delegate content's merge to PintwistCatalog.mergeCatalogRows) MUST resolve
  // both before the swap, or the live-scan catalog's seen_count + keyword tags change.
  // Convert these to real assertions once the shared engine adopts the content semantics
  // (or vice-versa, depending on which is chosen as correct).
  it.todo('Phase 2: reconcile seen_count counting between the two merge engines');
  it.todo('Phase 2: reconcile search_term union ("a | b | c") vs latest-only');

  it('keys identityless rows by content surrogate without dropping them', () => {
    // No pin_id, no title/desc — must survive (keyed by image_url), in both engines.
    const incoming = [
      row({ image_url: 'https://i.pinimg.com/474x/z/z/z.jpg', saves: 7, total_engagement: 7 }),
    ];
    const { content, shared } = bothEngines([], incoming);
    expect(Object.keys(content).length).toBe(1);
    expect(Object.keys(shared).length).toBe(1);
    expect(content).toEqual(shared);
  });
});
