import { describe, it, expect } from 'vitest';
import { C } from './loadContent';
import { catalogPinKey, catalogScanKey } from '../catalog-utils';

// These exercise the ACTUAL functions from js/content.js (loaded via the harness),
// so a future de-minify/rename that changes behavior will fail here.

describe('applyFilters — date filter hides out-of-range pins (date-filter bug)', () => {
  it('hides dated out-of-range pins; keeps in-range and undated pins visible', () => {
    // setCache (a real content.js fn) stamps timestamp so getCached treats these as fresh.
    const base = { saves: 10, comments: 0, repins: 0, reactions: 0, shares: 0 };
    C.setCache('pin-recent', { ...base, createdAt: '2026-06-10T00:00:00Z' });
    C.setCache('pin-old', { ...base, createdAt: '2019-01-01T00:00:00Z' });
    C.setCache('pin-undated', { ...base, createdAt: null });

    document.body.innerHTML = `
      <input id="filter-saves-min" value="0"><input id="filter-saves-max" value="999999999">
      <input id="filter-comments-min" value="0"><input id="filter-comments-max" value="999999999">
      <input id="filter-repins-min" value="0"><input id="filter-repins-max" value="999999999">
      <input id="filter-reactions-min" value="0"><input id="filter-reactions-max" value="999999999">
      <input id="filter-shares-min" value="0"><input id="filter-shares-max" value="999999999">
      <input id="filter-date-min" value="2026-06-01"><input id="filter-date-max" value="2026-06-20">
      <div id="pintwist-match-count"></div>
      <div id="pintwist-sorted-container">
        <div class="pinterest--block" data-pin-id="pin-recent"></div>
        <div class="pinterest--block" data-pin-id="pin-old"></div>
        <div class="pinterest--block" data-pin-id="pin-undated"></div>
      </div>`;

    C.applyFilters();

    const card = (id: string) => document.querySelector(`[data-pin-id="${id}"]`) as HTMLElement;
    expect(card('pin-old').style.display).toBe('none'); // 2019 → out of June range → hidden
    expect(card('pin-recent').style.display).not.toBe('none'); // June 10 → in range → visible
    expect(card('pin-undated').style.display).not.toBe('none'); // no date → not excluded by date
  });
});

describe('isPinimgUrl (result-thumbnail host allowlist — codex finding 2)', () => {
  it('accepts https *.pinimg.com only', () => {
    expect(C.isPinimgUrl('https://i.pinimg.com/474x/ab/cd/ef.jpg')).toBe(true);
    expect(C.isPinimgUrl('https://pinimg.com/x.jpg')).toBe(true);
    expect(C.isPinimgUrl('https://s.pinimg.com/x.jpg')).toBe(true);
  });
  it('rejects non-pinimg hosts, non-https, and junk', () => {
    expect(C.isPinimgUrl('https://evil.example/x.jpg')).toBe(false);
    expect(C.isPinimgUrl('http://i.pinimg.com/x.jpg')).toBe(false); // not https
    expect(C.isPinimgUrl('https://i.pinimg.com.evil.io/x.jpg')).toBe(false); // lookalike
    expect(C.isPinimgUrl('not a url')).toBe(false);
    expect(C.isPinimgUrl('')).toBe(false);
    expect(C.isPinimgUrl(null)).toBe(false);
  });
});

describe('content.js — real function behavior', () => {
  it('loaded the content script and exposed functions', () => {
    expect(typeof C.escapeAttr).toBe('function');
    expect(typeof C.formatNumber).toBe('function');
    expect(typeof C.pintwistCsvCell).toBe('function');
    expect(typeof C.isPinimgUrl).toBe('function');
  });

  describe('escapeAttr', () => {
    it('escapes HTML-significant characters', () => {
      expect(C.escapeAttr(`<a href="x" & 'y'>`)).toBe(
        '&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;'
      );
    });
    it('returns empty string for falsy input', () => {
      expect(C.escapeAttr('')).toBe('');
      expect(C.escapeAttr(null)).toBe('');
      expect(C.escapeAttr(undefined)).toBe('');
    });
  });

  describe('formatNumber', () => {
    it('formats thousands and millions, trims .0', () => {
      expect(C.formatNumber(999)).toBe('999');
      expect(C.formatNumber(1000)).toBe('1K');
      expect(C.formatNumber(1500)).toBe('1.5K');
      expect(C.formatNumber(1_000_000)).toBe('1M');
      expect(C.formatNumber(2_300_000)).toBe('2.3M');
    });
  });

  describe('getDaysAgo', () => {
    it('labels recent dates', () => {
      const now = Date.now();
      expect(C.getDaysAgo(now)).toBe('TODAY');
      expect(C.getDaysAgo(now - 2 * 864e5)).toBe('2D');
      expect(C.getDaysAgo(now - 60 * 864e5)).toBe('2MO');
    });
  });

  describe('adjustColorBrightness', () => {
    it('darkens/lightens a hex color deterministically', () => {
      expect(C.adjustColorBrightness('#ffffff', -100)).toBe('#000000');
      expect(C.adjustColorBrightness('#000000', 100)).toBe('#ffffff');
      expect(C.adjustColorBrightness('#808080', 0)).toBe('#808080');
    });
  });

  describe('pintwistCsvCell — formula-injection safe', () => {
    it('prefixes a quote on cells starting with = + - @', () => {
      expect(C.pintwistCsvCell('=1+1')).toBe(`'=1+1`); // leading quote neutralizes the formula; no comma/quote so not wrapped
      expect(C.pintwistCsvCell('=HYPERLINK("x"),y')).toBe(`"'=HYPERLINK(""x""),y"`); // neutralized AND wrapped (has comma+quote)
    });
    it('neutralizes dangerous leading chars', () => {
      for (const bad of ['=cmd', '+cmd', '-cmd', '@cmd']) {
        expect(
          C.pintwistCsvCell(bad).startsWith("'") || C.pintwistCsvCell(bad).startsWith(`"'`)
        ).toBe(true);
      }
    });
    it('leaves safe text alone', () => {
      expect(C.pintwistCsvCell('hello')).toBe('hello');
      expect(C.pintwistCsvCell(42)).toBe('42');
      expect(C.pintwistCsvCell('a,b')).toBe('"a,b"');
    });
  });

  describe('pintwistMergeCatalogRows — dedup by pin_id', () => {
    it('keeps one row per pin and increments seen_count', () => {
      const merged = C.pintwistMergeCatalogRows(
        [{ pin_id: 'A', saves: 5, search_term: 'cats', scanned_at: '2024-01-01' }],
        [{ pin_id: 'A', saves: 9, search_term: 'dogs', scanned_at: '2024-01-02' }]
      );
      const a = merged.filter((r: any) => r.pin_id === 'A');
      expect(a).toHaveLength(1);
      expect(a[0].saves).toBe(9); // latest wins
      expect(a[0].search_term).toContain('cats');
      expect(a[0].search_term).toContain('dogs'); // terms merged
      expect(a[0].seen_count).toBeGreaterThanOrEqual(1);
    });
    it('adds distinct pins', () => {
      const merged = C.pintwistMergeCatalogRows([{ pin_id: 'A' }], [{ pin_id: 'B' }]);
      expect(merged.map((r: any) => r.pin_id).sort()).toEqual(['A', 'B']);
    });
  });

  describe('pintwistRowsToCsv', () => {
    it('emits a header row then one line per row', () => {
      const csv = C.pintwistRowsToCsv([{ pin_id: 'A', saves: 5 }]);
      const lines = csv.split('\r\n');
      expect(lines[0]).toContain('pin_id');
      expect(lines[0]).toContain('saves');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('A');
    });
  });

  // The dedup key is implemented twice (content.js mirror vs catalog-utils.js module).
  // This guards them against drifting — if the same pin keys differently across the
  // two paths, a pin can split into duplicate catalog rows.
  describe('catalog pin-key parity (content.js mirror vs catalog-utils module)', () => {
    const rows = [
      { pin_id: '2179320694619222', title: '70 and Spectacular', description: 'Soft tee' },
      { title: '70 and Spectacular', description: 'Soft tee' }, // name+desc path
      { pin_url: 'https://www.pinterest.com/pin/1436930443575729/' }, // pin-url path
      { image_url: 'https://i.pinimg.com/564x/ab/cd/ef/HASH.jpg' }, // image-filename path
      { imageUrl: 'https://i.pinimg.com/236x/ab/cd/ef/HASH.jpg' }, // camelCase fallback
      // volatile ~88-char token pin_id -> keyed by the design image, not the token (token-split fix)
      {
        pin_id: 'AdnYvmd5FYd_volatile_token',
        image_url: 'https://i.pinimg.com/736x/aa/bb/cc/f734502ac1ad.png',
      },
      {},
    ];
    it('produces identical keys on both code paths', () => {
      for (const r of rows) {
        expect(C.pintwistCatalogPinKey(r)).toBe(catalogPinKey(r));
      }
    });

    // pintwistScanKey (scan store) MUST equal catalogScanKey (catalog-page union) — incl. the
    // pin_url id-extraction. They diverged (content.js skipped it), so a pin_url-only row keyed
    // differently in the two stores → count/grid disagreement. (audit M-NEW-1)
    it('scan-key parity: pintwistScanKey === catalogScanKey (incl. pin_url extraction)', () => {
      const scanRows = [
        ...rows,
        { pin_url: 'https://www.pinterest.com/pin/987654321/' }, // id only in pin_url
        { url: 'https://pinterest.com/pin/55/', title: 'x' },
        { source_url: '/pin/42/' },
      ];
      for (const r of scanRows) {
        expect(C.pintwistScanKey(r)).toBe(catalogScanKey(r));
      }
    });
  });

  // A row with no id and a too-short/empty title keys to '' — it must NOT be silently dropped
  // from the (precious) catalog on merge. (audit M-NEW-2)
  describe('pintwistMergeCatalogRows — never drops identityless rows', () => {
    it('keeps a row with no id and a 1-char title', () => {
      const weak = { title: 'x', saves: 7, image_url: 'https://i.pinimg.com/x.jpg' };
      const merged = C.pintwistMergeCatalogRows([], [weak]);
      expect(merged.length).toBe(1);
      expect(merged[0].saves).toBe(7);
    });
    it('keeps weak rows already in the store across a re-merge (no vanish)', () => {
      const weak = { title: 'y', image_url: 'https://i.pinimg.com/y.jpg' };
      const first = C.pintwistMergeCatalogRows([], [weak]);
      const second = C.pintwistMergeCatalogRows(first, [{ pin_id: 'Z' }]);
      expect(second.some((r: any) => r.image_url === 'https://i.pinimg.com/y.jpg')).toBe(true);
      expect(second.some((r: any) => r.pin_id === 'Z')).toBe(true);
    });
  });
});
