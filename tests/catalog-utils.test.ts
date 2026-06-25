import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  catalogSummary,
  catalogScanKey,
  createCatalogMerger,
  groupByDesign,
  formatCompactNumber,
  isPinterestHost,
  PINTEREST_HOST_SUFFIXES,
  mergeCatalogRows,
  parseCsvText,
} from '../catalog-utils.js';

// The Pinterest registrable hosts the manifest actually grants (host_permissions),
// minus the pinimg CDN which isn't a pinterest page host. e.g. "*://*.pinterest.co.in/*"
// -> "pinterest.co.in".
function manifestPinterestSuffixes(): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'manifest.json'), 'utf8')
  );
  return (manifest.host_permissions as string[])
    .map((p) => p.replace(/^\*:\/\/\*\./, '').replace(/\/\*$/, ''))
    .filter((host) => host.startsWith('pinterest.'))
    .sort();
}

describe('isPinterestHost (pin-link host allowlist)', () => {
  it('allowlist exactly matches the manifest host_permissions (no drift)', () => {
    expect([...PINTEREST_HOST_SUFFIXES].sort()).toEqual(manifestPinterestSuffixes());
  });

  it('accepts every Pinterest host the manifest supports, plus subdomains', () => {
    for (const sfx of manifestPinterestSuffixes()) {
      expect(isPinterestHost(sfx)).toBe(true); // e.g. pinterest.co.in
      expect(isPinterestHost('www.' + sfx)).toBe(true);
      expect(isPinterestHost('BR.' + sfx.toUpperCase())).toBe(true); // case-insensitive
    }
    // The specific regression: real Pinterest India was being rejected.
    expect(isPinterestHost('pinterest.co.in')).toBe(true);
  });

  it('rejects fake TLDs, lookalikes, and non-pinterest hosts', () => {
    for (const h of [
      'pinterest.evil', // fake single-label TLD (was wrongly accepted)
      'pinterest.foo',
      'pinterest.com.evil',
      'pinterest.com.evil.io',
      'pinterest.evil.com',
      'evilpinterest.com',
      'notpinterest.com',
      'pinterest.co.in.evil', // lookalike of the now-supported co.in
      'pinimg.com', // CDN, not a pinterest page host
      'evil.com',
      '',
    ]) {
      expect(isPinterestHost(h)).toBe(false);
    }
  });

  it('background.js keeps the same allowlist (no copy drift)', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/background.js'), 'utf8');
    const block = src.match(/const PINTEREST_HOST_SUFFIXES = \[([\s\S]*?)\];/);
    expect(block).not.toBeNull();
    const bgSuffixes = Array.from((block as RegExpMatchArray)[1].matchAll(/'([^']+)'/g))
      .map((m) => m[1])
      .sort();
    expect(bgSuffixes).toEqual(manifestPinterestSuffixes());
  });
});

describe('catalog CSV utilities', () => {
  it('parses quoted PinTwist CSV rows', () => {
    const csv = [
      'search_term,pin_id,title,saves,comments,repins,reactions,shares,image_url',
      '"boho art",123,"A ""quoted"" title",1.2K,4,5,6,7,https://i.pinimg.com/a.jpg',
    ].join('\r\n');

    expect(parseCsvText(csv)).toEqual([
      expect.objectContaining({
        search_term: 'boho art',
        pin_id: '123',
        title: 'A "quoted" title',
        saves: 1200,
        comments: 4,
        repins: 5,
        reactions: 6,
        shares: 7,
        total_engagement: 1222,
        image_url: 'https://i.pinimg.com/a.jpg',
      }),
    ]);
  });

  it('imports the date from both the new last_activity column and the legacy pin_created_at column', () => {
    // Honesty rename: the pin-date CSV column is now `last_activity`.
    // New exports must round-trip, and legacy CSVs with `pin_created_at` must still import.
    const newCsv = [
      'search_term,pin_id,saves,last_activity',
      'boho,123,10,2026-06-20T10:16:27Z',
    ].join('\r\n');
    const legacyCsv = [
      'search_term,pin_id,saves,pin_created_at',
      'boho,123,10,2015-04-10T00:00:00Z',
    ].join('\r\n');

    expect(parseCsvText(newCsv)[0].pin_created_at).toBe('2026-06-20T10:16:27Z');
    expect(parseCsvText(legacyCsv)[0].pin_created_at).toBe('2015-04-10T00:00:00Z');
  });

  it('merges duplicate pins by pin id and keeps newer useful fields', () => {
    const rows = mergeCatalogRows(
      [{ pin_id: '123', title: 'Old', saves: 10, image_url: '' }],
      [{ pin_id: '123', title: 'New', saves: 20, comments: 2, image_url: 'img.jpg' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pin_id: '123',
      title: 'New',
      saves: 20,
      comments: 2,
      image_url: 'img.jpg',
      total_engagement: 22,
    });
  });

  it('builds a deduped scrape history and keeps only true rescrapes', () => {
    const [pin] = mergeCatalogRows(
      [],
      [
        { pin_id: '9', saves: 100, comments: 1, scanned_at: '2026-06-01T00:00:00Z' },
        { pin_id: '9', saves: 100, comments: 1, scanned_at: '2026-06-02T00:00:00Z' }, // identical -> not a true rescrape
        { pin_id: '9', saves: 120, comments: 1, scanned_at: '2026-06-03T00:00:00Z' }, // changed -> true rescrape
      ]
    );
    expect(pin.history).toHaveLength(2);
    expect(pin.history.map((h) => h.saves)).toEqual([100, 120]);
    expect(pin.saves).toBe(120); // latest snapshot at top level
    expect(pin.seen_count).toBe(3); // every sighting counted
    expect(pin.first_seen_at).toBe('2026-06-01T00:00:00Z');
    expect(pin.last_seen_at).toBe('2026-06-03T00:00:00Z');
    expect(pin.last_changed_at).toBe('2026-06-03T00:00:00Z');
  });

  it('drops all-zero failed reads from history once a pin has real engagement', () => {
    // A pin observed across many scans where some reads failed (all-zero before
    // the pin data loaded). Those zero reads must not count as rescrapes, and the
    // top-level metrics must reflect the last REAL value, not a trailing zero.
    const [pin] = mergeCatalogRows(
      [],
      [
        {
          pin_id: '7',
          saves: 0,
          comments: 0,
          repins: 0,
          reactions: 0,
          shares: 0,
          scanned_at: '2026-06-01T00:00:00Z',
        },
        { pin_id: '7', saves: 120, comments: 3, scanned_at: '2026-06-02T00:00:00Z' },
        {
          pin_id: '7',
          saves: 0,
          comments: 0,
          repins: 0,
          reactions: 0,
          shares: 0,
          scanned_at: '2026-06-03T00:00:00Z',
        }, // failed read
        { pin_id: '7', saves: 120, comments: 3, scanned_at: '2026-06-04T00:00:00Z' }, // same real value again
        {
          pin_id: '7',
          saves: 0,
          comments: 0,
          repins: 0,
          reactions: 0,
          shares: 0,
          scanned_at: '2026-06-05T00:00:00Z',
        }, // failed read
      ]
    );
    expect(pin.history).toHaveLength(1); // one real state, zeros dropped, identical collapsed
    expect(pin.history[0].saves).toBe(120);
    expect(pin.saves).toBe(120); // a trailing zero-read does not clobber known metrics
    expect(pin.seen_count).toBe(5); // every sighting still counted
  });

  it('keeps a single entry for a genuinely zero-engagement pin', () => {
    const [pin] = mergeCatalogRows(
      [],
      [
        {
          pin_id: '8',
          saves: 0,
          comments: 0,
          repins: 0,
          reactions: 0,
          shares: 0,
          scanned_at: '2026-06-01T00:00:00Z',
        },
        {
          pin_id: '8',
          saves: 0,
          comments: 0,
          repins: 0,
          reactions: 0,
          shares: 0,
          scanned_at: '2026-06-02T00:00:00Z',
        },
      ]
    );
    expect(pin.history).toHaveLength(1);
  });

  it('accumulates scrape history across multiple imports of the same pin', () => {
    const first = mergeCatalogRows(
      [],
      [{ pin_id: '9', saves: 100, scanned_at: '2026-06-01T00:00:00Z' }]
    );
    const merged = mergeCatalogRows(first, [
      { pin_id: '9', saves: 130, scanned_at: '2026-06-05T00:00:00Z' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].history.map((h) => h.saves)).toEqual([100, 130]);
    expect(merged[0].saves).toBe(130);
  });

  it('merges the same pin across CDN image sizes when there is no pin_id', () => {
    // Same image served at different sizes (and no id/url) must be one pin, not three.
    const merged = mergeCatalogRows(
      [],
      [
        {
          search_term: 'funny teacher shirts',
          image_url: 'https://i.pinimg.com/236x/ab/cd/ef/HASH.jpg',
          saves: 1,
        },
        {
          search_term: 'western shirt ideas',
          image_url: 'https://i.pinimg.com/564x/ab/cd/ef/HASH.jpg',
          saves: 1,
        },
        {
          search_term: 'funny shirt',
          image_url: 'https://i.pinimg.com/originals/ab/cd/ef/HASH.jpg',
          saves: 1,
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].seen_count).toBe(3);
  });

  it('merges by name + description when ids and image files differ (same design, distinct pins)', () => {
    const merged = mergeCatalogRows(
      [],
      [
        {
          pin_id: '2179320694619222',
          title: '70 and Spectacular Birthday Shirt',
          description: 'Soft cotton tee',
          image_url: 'https://i.pinimg.com/originals/0b/6c/bc/AAA.jpg',
          saves: 1,
        },
        {
          pin_id: 'Ad1_GYfTiQfFm322',
          title: '70 and Spectacular Birthday Shirt',
          description: 'Soft cotton tee',
          image_url: 'https://i.pinimg.com/originals/b9/ed/7c/BBB.jpg',
          saves: 1,
        },
        {
          pin_id: '1436930443575729',
          title: '70 and Spectacular Birthday Shirt | Color: Black | Size: L',
          description: 'Soft cotton tee',
          image_url: 'https://i.pinimg.com/originals/bb/16/04/CCC.jpg',
          saves: 2,
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].seen_count).toBe(3);
  });

  it('keeps same-name pins separate when descriptions differ word-for-word', () => {
    const merged = mergeCatalogRows(
      [],
      [
        {
          pin_id: '111',
          title: 'Funny Shirt',
          description: 'A teacher appreciation tee',
          saves: 1,
        },
        {
          pin_id: '222',
          title: 'Funny Shirt',
          description: 'A totally different listing about cats',
          saves: 1,
        },
      ]
    );
    expect(merged).toHaveLength(2);
  });

  it('summarizes catalog rows across every metric', () => {
    const summary = catalogSummary([
      {
        search_term: 'shirt',
        saves: 10,
        repins: 1,
        comments: 2,
        reactions: 3,
        shares: 4,
        total_engagement: 15,
      },
      {
        search_term: 'shirt',
        saves: 20,
        repins: 5,
        comments: 0,
        reactions: 1,
        shares: 4,
        total_engagement: 30,
      },
      {
        search_term: 'png',
        saves: 5,
        repins: 0,
        comments: 1,
        reactions: 0,
        shares: 2,
        total_engagement: 8,
      },
    ]);

    expect(summary).toEqual({
      pins: 3,
      terms: 2,
      saves: 35,
      repins: 6,
      comments: 3,
      reactions: 4,
      shares: 10,
      engagement: 53,
    });
  });

  it('formats compact numbers', () => {
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(1200)).toBe('1.2K');
    expect(formatCompactNumber(2000000)).toBe('2M');
  });

  it('keeps catalog theme and pagination controls wired', () => {
    const root = process.cwd();
    const html = fs.readFileSync(path.join(root, 'catalog.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'catalog.css'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'catalog.js'), 'utf8');

    expect(html).toContain('per-page-select');
    expect(html).toContain('catalog-pagination');
    expect(css).toContain('--pt-bg: rgba(13, 13, 20, 0.96)');
    expect(css).toContain(':root[data-theme-mode="light"]');
    expect(css).toContain('--pt-bg: #f8fafc');
    expect(css).toContain('background: var(--theme-color)');
    expect(css).toContain('.catalog-controls select option');
    expect(css).toContain('--pt-text: #f8fafc');
    expect(css).toContain('--pt-secondary-bg:');
    expect(css).toContain('--pt-disabled-bg:');
    expect(css).toContain('--pt-danger-bg:');
    expect(css).toContain('background: var(--pt-disabled-bg)');
    expect(css).toContain('color: var(--pt-secondary-text)');
    expect(css).toContain('color: var(--pt-danger-text)');
    expect(css).toContain('color: var(--pt-text)');
    expect(css).toContain('opacity: 1');
    expect(js).toContain('hydrateTheme');
    expect(js).toContain('pintwist_theme_mode');
    expect(js).toContain('normalizeThemeMode');
    expect(js).toContain('pintwist_catalog_per_page');
    expect(js).toContain('pageSlice(rows)');
  });
});

describe('createCatalogMerger (streaming import dedup)', () => {
  const mk = (pin, saves, scanned, extra) => ({
    search_term: 'x',
    pin_id: pin,
    pin_url: `https://www.pinterest.com/pin/${pin}/`,
    title: 't' + pin,
    description: 'd' + pin,
    saves: String(saves),
    comments: '0',
    repins: '0',
    reactions: '0',
    shares: '0',
    scanned_at: scanned,
    ...(extra || {}),
  });

  it('streaming ingest in batches equals one-shot mergeCatalogRows', () => {
    const rows = [
      mk('100', 10, '2026-06-01T00:00:00Z'),
      mk('100', 20, '2026-06-02T00:00:00Z'), // same pin, later scrape
      mk('200', 5, '2026-06-01T00:00:00Z'),
      mk('300', 7, '2026-06-03T00:00:00Z'),
    ];
    const oneShot = mergeCatalogRows([], rows);
    const m = createCatalogMerger();
    m.ingest(rows.slice(0, 1)).ingest(rows.slice(1, 3)).ingest(rows.slice(3));
    const streamed = m.finalize();
    expect(streamed.length).toBe(oneShot.length);
    const byPin = (arr) => Object.fromEntries(arr.map((r) => [r.pin_id, r]));
    const a = byPin(streamed);
    const b = byPin(oneShot);
    for (const id of Object.keys(b)) {
      expect(a[id].saves).toBe(b[id].saves);
      expect(a[id].history.length).toBe(b[id].history.length);
    }
  });

  it('dedupes the same pin across batches into one row with combined history', () => {
    const m = createCatalogMerger();
    m.ingest([mk('100', 10, '2026-06-01T00:00:00Z')]);
    m.ingest([mk('100', 25, '2026-06-05T00:00:00Z')]);
    const out = m.finalize();
    expect(out.length).toBe(1);
    expect(out[0].saves).toBe(25); // latest snapshot wins
    expect(out[0].history.length).toBe(2); // two distinct scrapes recorded
    expect(out[0].seen_count).toBe(2);
  });

  it('maxObservations bounds per-pin history but keeps the latest metrics + true seen_count', () => {
    const capped = createCatalogMerger({ maxObservations: 5 });
    // 40 distinct scrapes of one pin (saves climbs each time)
    for (let i = 1; i <= 40; i++) {
      capped.ingest([mk('100', i, `2026-06-${String(i).padStart(2, '0')}T00:00:00Z`)]);
    }
    const out = capped.finalize();
    expect(out.length).toBe(1);
    expect(out[0].history.length).toBeLessThanOrEqual(5); // history bounded
    expect(out[0].saves).toBe(40); // latest metrics preserved despite the cap
    expect(out[0].seen_count).toBe(40); // true scrape count, not the capped length
  });
});

describe('pin_id-keyed dedup (data integrity — metrics belong to a pin_id)', () => {
  it('keeps same-design pins with different pin_ids SEPARATE, each with its own metrics', () => {
    // Two distinct Pinterest pins of the same design (identical title+desc) but different
    // pin_ids and very different save counts. They must NOT be pooled — each pin owns its
    // metrics. (Merging by title+desc would wrongly collapse them and mix the numbers.)
    const rows = [
      {
        pin_id: '111',
        title: 'Funny Cat',
        description: 'meme',
        saves: 1500,
        scanned_at: '2026-06-20T00:00:00Z',
      },
      {
        pin_id: '222',
        title: 'Funny Cat',
        description: 'meme',
        saves: 50,
        scanned_at: '2026-06-21T00:00:00Z',
      },
    ];
    const out = mergeCatalogRows([], rows, { keyFn: catalogScanKey });
    expect(out).toHaveLength(2); // two pins, not one merged "design"
    const byId = Object.fromEntries(out.map((r) => [r.pin_id, r]));
    expect(byId['111'].saves).toBe(1500); // each pin keeps its own count
    expect(byId['222'].saves).toBe(50);
    expect(byId['111'].history).toHaveLength(1); // clean per-pin history, not cross-pin
    expect(byId['222'].history).toHaveLength(1);
  });

  it('still accumulates a real per-pin history across scrapes of the SAME pin_id', () => {
    const [pin] = mergeCatalogRows(
      [],
      [
        { pin_id: '111', title: 'X', saves: 100, scanned_at: '2026-06-01T00:00:00Z' },
        { pin_id: '111', title: 'X', saves: 140, scanned_at: '2026-06-05T00:00:00Z' },
      ],
      { keyFn: catalogScanKey }
    );
    expect(pin.history.map((h) => h.saves)).toEqual([100, 140]); // one pin's true climb
    expect(pin.saves).toBe(140);
  });

  it('falls back to title+desc only when a row has no pin_id', () => {
    const rows = [
      {
        title: 'No Id Design',
        description: 'd',
        image_url: 'https://i.pinimg.com/a.jpg',
        saves: 10,
        scanned_at: '2026-06-01T00:00:00Z',
      },
      {
        title: 'No Id Design',
        description: 'd',
        image_url: 'https://i.pinimg.com/a.jpg',
        saves: 12,
        scanned_at: '2026-06-02T00:00:00Z',
      },
    ];
    const out = mergeCatalogRows([], rows, { keyFn: catalogScanKey });
    expect(out).toHaveLength(1); // no pin_id -> dedup by title+desc so they don't scatter
  });
});

describe('catalogScanKey — volatile token rows collapse by design, not split per keyword', () => {
  it('keys a non-numeric token pin_id by the design image, not the token', () => {
    // Ad / aggregated pins carry an ~88-char base64 token that changes per search context.
    const a = {
      pin_id: 'AdnYvmd5FYd51feEPrfLotKpdEBMLvaHf2AZ-chnsBXHWY9n82RbWTxCC',
      image_url: 'https://i.pinimg.com/736x/aa/bb/cc/f734502ac1ad.png',
      search_term: 'baking shirts',
    };
    const b = {
      pin_id: 'AXYgNVzWJNeCSkYR4BpT-hiQDdD6Rk_ebl2tpRYSs-_r0miF2Jis-different',
      image_url: 'https://i.pinimg.com/736x/aa/bb/cc/f734502ac1ad.png',
      search_term: 'canning shirts',
    };
    expect(catalogScanKey(a)).toBe('img:f734502ac1ad.png');
    // same picture, different volatile tokens -> SAME key (so they merge, not split)
    expect(catalogScanKey(a)).toBe(catalogScanKey(b));
  });

  it('still keys a real numeric pin_id by that id (unchanged behavior)', () => {
    expect(catalogScanKey({ pin_id: '253046072800286939' })).toBe('pin:253046072800286939');
  });

  it('merges the same design seen under many keywords (different tokens) into ONE row', () => {
    const rows = [
      {
        pin_id: 'TOKENaaaa',
        image_url: 'https://i.pinimg.com/x/d/e/f.png',
        saves: 1,
        shares: 1,
        search_term: 'baking shirts',
        scanned_at: '2026-06-25T01:00:00Z',
      },
      {
        pin_id: 'TOKENbbbb',
        image_url: 'https://i.pinimg.com/x/d/e/f.png',
        saves: 1,
        shares: 1,
        search_term: 'canning shirts',
        scanned_at: '2026-06-25T01:01:00Z',
      },
      {
        pin_id: 'TOKENcccc',
        image_url: 'https://i.pinimg.com/x/d/e/f.png',
        saves: 2,
        shares: 1,
        search_term: 'dental hygienist shirts',
        scanned_at: '2026-06-25T01:02:00Z',
      },
    ];
    const out = mergeCatalogRows([], rows, { keyFn: catalogScanKey });
    expect(out).toHaveLength(1); // one design, not three cards
    expect(out[0].seen_count).toBe(3); // all three copies folded into the one card
  });

  it('does NOT merge two real numeric pins of the same design (their stats stay separate)', () => {
    const rows = [
      {
        pin_id: '111',
        title: 'Same Design',
        description: 'd',
        saves: 10,
        scanned_at: '2026-06-25T00:00:00Z',
      },
      {
        pin_id: '222',
        title: 'Same Design',
        description: 'd',
        saves: 99,
        scanned_at: '2026-06-25T00:00:00Z',
      },
    ];
    const out = mergeCatalogRows([], rows, { keyFn: catalogScanKey });
    expect(out).toHaveLength(2); // numeric ids are trusted; "group by design" handles display merging
  });
});

describe('groupByDesign (design-level view aggregation)', () => {
  it('collapses same-design pins (diff pin_ids) to one row = the best copy + a copy count', () => {
    const pins = [
      { pin_id: '1', title: 'Cat Shirt', description: 'd', saves: 100, total_engagement: 100 },
      { pin_id: '2', title: 'Cat Shirt', description: 'd', saves: 900, total_engagement: 900 },
      { pin_id: '3', title: 'Cat Shirt', description: 'd', saves: 50, total_engagement: 50 },
    ];
    const out = groupByDesign(pins);
    expect(out).toHaveLength(1);
    expect(out[0].pin_id).toBe('2'); // representative = highest-engagement copy
    expect(out[0].saves).toBe(900); // its OWN metrics, not pooled/averaged
    expect(out[0].design_copies).toBe(3); // demand signal: 3 distinct pins
    expect(out[0].design_total_saves).toBe(1050); // 100+900+50 summed across copies
  });

  it('keeps genuinely different designs separate', () => {
    const out = groupByDesign([
      { pin_id: '1', title: 'Cat Shirt', description: 'a', saves: 10, total_engagement: 10 },
      { pin_id: '2', title: 'Dog Mug', description: 'b', saves: 20, total_engagement: 20 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('a single-copy design reports design_copies = 1', () => {
    const out = groupByDesign([
      { pin_id: '1', title: 'Lone Design', description: 'd', saves: 5, total_engagement: 5 },
    ]);
    expect(out[0].design_copies).toBe(1);
  });
});

describe('seen_count integrity on re-merge', () => {
  it('preserves the true seen_count when re-ingesting an already-finalized row', () => {
    // A finalized row: 50 real sightings collapsed to 2 history entries. Re-merging it must
    // keep seen_count=50, not shrink it to the history length (the decay bug).
    const finalized = {
      pin_id: '1',
      title: 'X',
      saves: 120,
      seen_count: 50,
      history: [
        {
          scanned_at: '2026-06-01T00:00:00Z',
          saves: 100,
          comments: 0,
          repins: 0,
          reactions: 0,
          shares: 0,
          total_engagement: 100,
        },
        {
          scanned_at: '2026-06-05T00:00:00Z',
          saves: 120,
          comments: 0,
          repins: 0,
          reactions: 0,
          shares: 0,
          total_engagement: 120,
        },
      ],
    };
    const out = mergeCatalogRows([], [finalized]);
    expect(out[0].seen_count).toBe(50);
    expect(out[0].saves).toBe(120);
  });
});
