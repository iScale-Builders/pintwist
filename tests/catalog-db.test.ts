import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  catalogDbAvailable,
  countImports,
  getAllImports,
  replaceImports,
  clearImports,
} from '../catalog-db.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const key = (r: any) => r.pin_id;

describe('catalog-db (IndexedDB import store)', () => {
  beforeEach(async () => {
    await replaceImports([], key); // clean slate before each test
  });

  it('reports available with a working IndexedDB', async () => {
    expect(await catalogDbAvailable()).toBe(true);
  });

  it('round-trips rows: replace, then getAll + count', async () => {
    await replaceImports(
      [
        { pin_id: '1', saves: 10 },
        { pin_id: '2', saves: 20 },
      ],
      key
    );
    expect(await countImports()).toBe(2);
    const all = await getAllImports();
    const byId = Object.fromEntries(all.map((r) => [r.pin_id, r]));
    expect(byId['1'].saves).toBe(10);
    expect(byId['2'].saves).toBe(20);
  });

  it('dedupes by key — one record per key, last write wins', async () => {
    await replaceImports(
      [
        { pin_id: '1', saves: 10 },
        { pin_id: '1', saves: 99 },
      ],
      key
    );
    expect(await countImports()).toBe(1);
    const all = await getAllImports();
    expect(all[0].saves).toBe(99);
  });

  it('replace is a full swap — old rows are gone', async () => {
    await replaceImports([{ pin_id: '1' }, { pin_id: '2' }], key);
    await replaceImports([{ pin_id: '3' }], key);
    const all = await getAllImports();
    expect(all.map((r) => r.pin_id)).toEqual(['3']);
  });

  it('clearImports empties the store', async () => {
    await replaceImports([{ pin_id: '1' }], key);
    await clearImports();
    expect(await countImports()).toBe(0);
  });

  it('stores rows even when keyFn returns empty (falls back through url/image/positional)', async () => {
    await replaceImports(
      [
        { pin_url: 'https://www.pinterest.com/pin/55/' },
        { image_url: 'https://i.pinimg.com/x.jpg' },
        {}, // no identity at all -> positional key, still stored, no collision
      ],
      () => ''
    );
    expect(await countImports()).toBe(3);
  });
});

describe('catalog-db replaceImports atomicity', () => {
  it('rejects (does not hang) when keying/putting throws synchronously', async () => {
    const throwingKey = () => {
      throw new Error('boom');
    };
    await expect(replaceImports([{ pin_id: '1' }], throwingKey)).rejects.toThrow('boom');
    // The store must still be usable afterward (transaction was aborted, not wedged).
    await replaceImports([{ pin_id: '2', saves: 5 }], (r) => r.pin_id);
    expect(await countImports()).toBe(1);
  });
});
