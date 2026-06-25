import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contentScript = readFileSync(resolve(process.cwd(), 'js', 'content.js'), 'utf8');
const runtimeBackgroundScript = readFileSync(resolve(process.cwd(), 'js', 'background.js'), 'utf8');
const backgroundScript = readFileSync(resolve(process.cwd(), 'src', 'background.js'), 'utf8');
const popupHtml = readFileSync(resolve(process.cwd(), 'popup.html'), 'utf8');
const contentCss = readFileSync(resolve(process.cwd(), 'css', 'style.css'), 'utf8');

// The source is auto-formatted (Prettier), so structural code assertions are matched on a
// whitespace/quote/semicolon-insensitive copy — they verify the code is PRESENT, not its
// exact formatting (which Prettier owns). CSS-in-template-literal strings are byte-preserved
// by Prettier, so those assertions still match the raw source.
const sq = (s: string) => s.replace(/\s+/g, '').replace(/['"]/g, '').replace(/;/g, '');
const contentScriptSq = sq(contentScript);

describe('content script performance hotfix', () => {
  it('uses the background bulk pin endpoint instead of one message per pin batch item', () => {
    expect(contentScriptSq).toContain(sq('action: "fetchBulkPins"'));
    expect(contentScript).toContain('fetchBulkWithRuntimeBulk');
  });

  it('runs as a local-only free extension without auth or remote ingest', () => {
    expect(contentScriptSq).toContain(sq('async function checkAuth(){return true}'));
    // The inert "observation" cluster (a no-op stub + an unused pin-metrics payload
    // builder) was removed entirely — stronger proof of no telemetry than
    // shipping a no-op. Assert it's fully gone.
    expect(contentScript).not.toContain('recordPinObservation');
    expect(contentScript).not.toContain('buildObservation');
    expect(contentScript).not.toContain('PINTWIST_CHECK_AUTH');
    expect(contentScript).not.toContain('Not authenticated');
    expect(backgroundScript).not.toContain('INGEST_SUPABASE_URL');
    expect(backgroundScript).not.toContain('chrome.cookies');
    expect(backgroundScript).not.toContain('recordPinObservation');
    expect(backgroundScript).not.toContain('recordPinObservations');
    expect(backgroundScript).not.toContain('PINTWIST_CHECK_AUTH');
  });

  it('renders sorted results from shadow PinTwist cards and releases captured nodes', () => {
    expect(contentScript).toContain('createResultCard');
    expect(contentScript).toContain('pintwist-result-card');
    expect(contentScript).toContain('releasePinterestResources');
    expect(contentScript).toContain('installShadowResultsSurface');
    expect(contentScript).toContain('ensurePintwistShadowRoot');
    expect(contentScript).toContain("host.attachShadow({ mode: 'open' })");
    expect(contentScript).toContain('installPintwistDocumentLookup');
    // sort_all lives in a different IIFE from the shadow helpers, so it must reach
    // them via the window bridge (bare calls would throw — regression guard).
    expect(contentScript).toContain('__pintwistEnsurePillShadow');
    expect(contentScript).toContain('pintwist-host');
    // The "Back to live" button was removed (a plain refresh returns to the live page);
    // guard that it stays gone, along with its reload-remount sessionStorage flag.
    expect(contentScript).not.toContain('pintwist-back-live');
    expect(contentScript).not.toContain('pintwist_backlive_remount');
    expect(contentScript).not.toContain('document.open()');
    expect(contentScript).not.toContain('document.write(');
    expect(contentScript).not.toContain('installLeanDocument');
    expect(contentScript).not.toContain('createLeanCard');
    expect(contentScript).toContain('pintwist-results-surface-style');
    expect(contentScript).toContain('pintwist-results-grid');
    expect(contentScript).toContain('displayImageUrl');
    expect(contentScript).toContain('/474x/');
    expect(contentScript).toContain('dataset.pintwistCardCount');
    expect(contentScript).toContain('pintwist-empty-results');
    expect(contentScript).toContain('State.insertedNodes = []');
  });

  it('gates the destructive CSV export+reset on a trusted user click', () => {
    // The export/reset buttons live in an open shadow root on the Pinterest page, so a
    // page script could dispatch a synthetic click. Every handler that calls the
    // export-and-reset path must bail on untrusted events (Codex security finding).
    expect(contentScript).toContain('e.isTrusted');
    // Both destructive entry points are the catalog export and the download-csv buttons.
    expect(contentScript).toContain("getElementById('pintwist-catalog-export')");
    expect(contentScript).toContain("getElementById('pintwist-download-csv-btn')");
  });

  it('keeps sorted filters inside the rail instead of a page overlay', () => {
    expect(contentScript).toContain(
      'shellBar.insertBefore(shellFilter, shellFilterToggle.nextSibling)'
    );
    expect(contentScript).toContain(
      '#pintwist-resort-bar>#pintwist-filter-bar.pintwist-filter-expanded'
    );
    expect(contentScript).toContain('position:static!important');
    expect(contentScript).toContain('overflow:visible!important');
    expect(contentScript).not.toContain('max-height:min(46vh,420px)!important');
    expect(contentScript).toContain('aria-label="Pin filters"');
  });

  it('caps live overlay DOM work for normal Pinterest scrolling', () => {
    expect(contentScript).toContain('LIVE_OVERLAY_LIMIT');
    expect(contentScript).toContain('pruneLiveOverlays');
    expect(contentScript).toContain('isNearViewport');
  });

  it('bounds long-lived in-memory caches used during Pinterest browsing', () => {
    expect(contentScript).toContain('MAX_METRICS_CACHE');
    expect(contentScript).toContain('enforceMemoryCaps');
    expect(contentScript).toContain('trimMapToLimit(State.metricsCache');
    expect(contentScript).toContain('trimSetToLimit(State.loadedIDs');
    expect(backgroundScript).not.toContain('INGEST_SESSION_SEEN_CAP');
    expect(backgroundScript).not.toContain('ingestPruneSessionSeen');
  });

  it('keeps local automation enabled for the open-source extension', () => {
    expect(contentScriptSq).toContain(sq('window.__pintwistAutomationMount = async function()'));
    expect(contentScript).toContain('runOnceForCurrentPage');
  });

  it('accumulates observed pins locally for export without remote ingest', () => {
    expect(contentScriptSq).toContain(sq('const PINTWIST_CATALOG_KEY = "pintwist_catalog_rows"'));
    expect(contentScript).toContain('function pintwistCatalogRow');
    expect(contentScript).toContain('function pintwistMergeCatalogRows');
    expect(contentScript).toContain('function pintwistFlushCatalogRows');
    expect(contentScript).toContain('function pintwistRowsToCsv');
    expect(contentScript).toContain(
      'pintwistQueueCatalogRows([pintwistCatalogRow(pinID, metrics)])'
    );
    expect(contentScript).toContain('display_image_url');
    expect(contentScript).toContain('seen_count');
    expect(contentScript).not.toContain('INGEST_SUPABASE_URL');
  });

  it('uses always-visible resort buttons instead of a hidden sorted-view dropdown', () => {
    expect(contentScript).toContain('pintwist-sort-grid');
    expect(contentScript).toContain('pintwist-sort-choice');
    expect(contentScript).toContain('aria-pressed');
    expect(contentScript).toContain('setActiveSort');
    expect(contentScript).toContain('Last activity');
  });

  it('uses the same glass sort button controls before and after sorting', () => {
    expect(contentScript).toContain('pintwistGlassSortGridHTML');
    expect(contentScript).toContain('pintwist-unified-glass');
    expect(contentScript).toContain('pintwist-section-title');
    expect(contentScript).toContain('pintwist-initial-sort-grid');
    expect(contentScript).toContain('runInitialSortFromRail');
    expect(contentScript).toContain('initialSortStarting = false');
    expect(contentScriptSq).toContain(
      sq('bindInitialSortGrid(document.getElementById("pintwist-initial-sort-grid"), bar)')
    );
    expect(contentScript).toContain('await runInitialSortFromRail(selected, bar)');
    expect(contentScript).toContain('await runInitialSortFromRail(metric, bar)');
    expect(contentScript).toContain(
      'min-height:34px!important;height:34px!important;background:var(--pt-field)!important'
    );
    expect(contentScript).toContain(
      'grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important'
    );
    expect(contentScript).toContain('color:var(--pintwist-primary,#F0002D)!important');
    expect(contentScript).toContain('pintwistLogoHTML');
    expect(contentScript).toContain('images/logo-wordmark.png');
    expect(contentScript).toContain('pintwist-logo-wordmark--themed');
    expect(contentScript).toContain('background:var(--pintwist-primary,#F0002D)!important');
    expect(contentScript).toContain('-webkit-mask-image:var(--pintwist-logo-url)!important');
    expect(contentScript).toContain('performanceHotfixVersion');
    expect(contentScript).toContain('performanceHotfixLogoHTML');
  });

  it('shares the modern glass visual language between popup and rail', () => {
    expect(contentScript).toContain('pintwist-glass-rail-style');
    expect(contentScript).toContain('--pt-rail-bg:rgba(13,13,20,.96)');
    expect(contentScript).toContain(':root.pintwist-theme-light');
    expect(contentScript).toContain('pintwist_theme_mode');
    expect(contentScript).toContain('updateThemeMode');
    expect(contentScript).toContain('applyThemeMode');
    expect(contentScript).toContain('--pt-green:var(--pintwist-primary,#4ade80)');
    expect(contentScript).toContain('--pt-blue:#60a5fa');
    expect(contentScript).toContain('--pt-secondary-bg:');
    expect(contentScript).toContain('--pt-disabled-bg:');
    expect(contentScript).toContain('--pt-danger-bg:');
    expect(contentScript).toContain('color-scheme:light!important');
    expect(contentCss).toContain('Final contrast sweep');
    expect(contentCss).toContain('--pt-secondary-bg:');
    expect(contentCss).toContain('--pt-disabled-bg:');
    expect(contentCss).toContain('-webkit-text-fill-color: var(--pt-text');
    expect(contentCss).toContain(':root.pintwist-theme-light #pintwist-sorted-container');
    expect(contentScript).toContain(':root.pintwist-theme-light #pintwist-sorted-container');
    expect(contentScript).toContain('font-family:var(--pt-font-body)');
    expect(contentScript).toContain('color:var(--pt-text)!important');
    expect(popupHtml).toContain('pin-glass-popup');
    expect(popupHtml).toContain('theme-mode-light');
    expect(popupHtml).toContain('mode-dark');
    expect(popupHtml).toContain('mode-light');
    expect(popupHtml).toContain('--pt-rail-bg: rgba(13,13,20,0.96)');
    expect(popupHtml).toContain('--pt-disabled-bg:');
    expect(popupHtml).toContain('background: var(--pt-disabled-bg)');
    expect(popupHtml).toContain('background: var(--pt-green)');
    expect(popupHtml).not.toContain('fonts.googleapis.com');
  });

  it('removes the old popup UI style picker', () => {
    expect(popupHtml).not.toContain('ui-style-selector');
    expect(popupHtml).not.toContain('UI Style');
  });

  it('keeps free rail controls readable with local automation controls', () => {
    expect(contentScript).toContain('#pintwist-filter-bar .filter-input');
    expect(contentScript).toContain('#pintwist-filter-bar .date-preset-chip');
    expect(contentScript).toContain('color:#dbeafe!important');
    expect(contentScript).toContain('button:disabled');
    expect(contentScript).toContain('input:not([type="checkbox"]):not([type="hidden"])');
    expect(contentScript).toContain('#pintwist-auto-body');
  });

  it('shares light UI tokens and leaves Clear queue neutral across pre/post scan', () => {
    expect(contentScript).toContain('function pintwistLightThemeTokenCss');
    expect(contentScript).toContain("${pintwistLightThemeTokenCss(':root.pintwist-theme-light')}");
    expect(contentScript).toContain("${pintwistLightThemeTokenCss(':host')}");
    expect(contentScript).toContain(
      '${s}#pintwist-auto-body #pintwist-auto-clear{background:transparent!important'
    );
    expect(contentScript).not.toContain(
      '#pintwist-resort-bar #pintwist-auto-off,#pintwist-resort-bar #pintwist-auto-clear'
    );
    expect(contentScript).not.toContain('Stop + Clear queue = red');
  });
});
