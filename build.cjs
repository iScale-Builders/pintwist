const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

async function build() {
  // ===== DEV BUILD (readable, for local development) =====
  // Background service worker (bundle src/background.js -> js/background.js)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'background.js')],
    bundle: false,
    outfile: path.join(ROOT, 'js', 'background.js'),
    format: 'esm',
    target: 'chrome120',
    minify: false,
    sourcemap: false,
  });

  // Build popup script
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'popup.js')],
    bundle: true,
    outfile: path.join(ROOT, 'popup.js'),
    format: 'iife',
    target: 'chrome120',
    minify: false,
    sourcemap: false,
  });

  // Shared catalog identity/merge utilities, bundled as the `PintwistCatalog` global
  // so the content script can use them instead of a hand-copied mirror.
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'catalog-utils.js')],
    bundle: true,
    outfile: path.join(ROOT, 'js', 'pintwist-catalog-shared.js'),
    format: 'iife',
    globalName: 'PintwistCatalog',
    target: 'chrome120',
    minify: false,
    sourcemap: false,
  });

  console.log('Dev build complete: background.js + popup.js + pintwist-catalog-shared.js');

  // ===== DIST BUILD (minified, for distribution) =====
  // Clean dist
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'css'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'images'), { recursive: true });

  // Minify background service worker (src/background.js -> dist/js/background.js)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'background.js')],
    bundle: false,
    outfile: path.join(DIST, 'js', 'background.js'),
    format: 'esm',
    target: 'chrome120',
    minify: true,
    sourcemap: false,
  });

  // Bundle + minify popup
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'popup.js')],
    bundle: true,
    outfile: path.join(DIST, 'popup.js'),
    format: 'iife',
    target: 'chrome120',
    minify: true,
    sourcemap: false,
  });

  // Bundle + minify the shared catalog utilities (PintwistCatalog global) for dist.
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'catalog-utils.js')],
    bundle: true,
    outfile: path.join(DIST, 'js', 'pintwist-catalog-shared.js'),
    format: 'iife',
    globalName: 'PintwistCatalog',
    target: 'chrome120',
    minify: true,
    sourcemap: false,
  });

  // Minify content script for dist only (NOT obfuscated — the Chrome Web Store
  // bans obfuscated code; minification is allowed). js/content.js stays readable
  // during development; the shipped copy is whitespace/syntax-minified.
  // format:'esm' (not 'iife') so it isn't wrapped in a function — the content
  // script relies on top-level/global declarations (window.sort_all, the
  // PintwistCatalog delegation, the decorator reassignments).
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'js', 'content.js')],
    bundle: false,
    outfile: path.join(DIST, 'js', 'content.js'),
    format: 'esm',
    target: 'chrome120',
    minify: true,
    sourcemap: false,
  });
  console.log('content.js minified (not obfuscated) for dist');

  // Minify CSS
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'css', 'style.css')],
    outfile: path.join(DIST, 'css', 'style.css'),
    bundle: true,
    minify: true,
    sourcemap: false,
  });

  // Version SSOT: package.json is the single source of truth.
  // Sync it into manifest.json (root + dist) so a bump only touches package.json.
  // content.js reads chrome.runtime.getManifest().version at runtime — no literal there.
  {
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const manifestPath = path.join(ROOT, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // version_name is what Chrome DISPLAYS (chrome://extensions, our pill). Keep it locked
    // to the package version so a `version`-only bump (e.g. a sed on "version") can never
    // freeze the displayed label again — that's exactly how it can get stuck on an old
    // label while `version` advances.
    const expectedVersionName = `${pkgVersion}`;
    const hasVersionName = 'version_name' in manifest;
    if (
      manifest.version !== pkgVersion ||
      (hasVersionName && manifest.version_name !== expectedVersionName)
    ) {
      manifest.version = pkgVersion;
      if (hasVersionName) manifest.version_name = expectedVersionName;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
      console.log(
        `manifest.json version synced -> ${pkgVersion}${hasVersionName ? ` (${expectedVersionName})` : ''}`
      );
    }
  }

  // Copy static files
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
  fs.copyFileSync(path.join(ROOT, 'popup.html'), path.join(DIST, 'popup.html'));
  fs.copyFileSync(path.join(ROOT, 'popup-catalog.js'), path.join(DIST, 'popup-catalog.js'));
  fs.copyFileSync(path.join(ROOT, 'catalog.html'), path.join(DIST, 'catalog.html'));
  fs.copyFileSync(path.join(ROOT, 'catalog.css'), path.join(DIST, 'catalog.css'));
  fs.copyFileSync(path.join(ROOT, 'catalog.js'), path.join(DIST, 'catalog.js'));
  fs.copyFileSync(path.join(ROOT, 'catalog-utils.js'), path.join(DIST, 'catalog-utils.js'));
  fs.copyFileSync(path.join(ROOT, 'catalog-db.js'), path.join(DIST, 'catalog-db.js'));
  fs.copyFileSync(path.join(ROOT, 'catalog-store.js'), path.join(DIST, 'catalog-store.js'));

  // Copy images
  const images = fs.readdirSync(path.join(ROOT, 'images'));
  images.forEach((img) => {
    fs.copyFileSync(path.join(ROOT, 'images', img), path.join(DIST, 'images', img));
  });

  // Update popup.html in dist to reference minified popup.js (same path, already correct)

  const distSize = getDirSize(DIST);
  console.log(`Dist build complete: ${DIST}`);
  console.log(`Dist size: ${(distSize / 1024).toFixed(0)} KB`);
  console.log('Load dist/ as unpacked extension for distribution.');
}

function getDirSize(dir) {
  let size = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
