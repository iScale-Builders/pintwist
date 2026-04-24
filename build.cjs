const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

// Obfuscation settings for content.js — tuned to raise the cost of copying
// the Pinterest scraping logic without runtime penalties or CWS red flags.
// NO controlFlowFlattening (slow), NO debugProtection / selfDefending (CWS
// sometimes flags as "hiding malicious behavior").
const OBFUSCATOR_OPTS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: false,
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: false,
  shuffleStringArray: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayThreshold: 0.5,
  target: 'browser',
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const CLERK_KEY = 'pk_live_Y2xlcmsuaXNjYWxlbGFicy5jb20k';

async function build() {
  // ===== DEV BUILD (readable, for local development) =====
  // Background script — no Clerk, no bundling needed, just copy
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'background-auth.js')],
    bundle: false,
    outfile: path.join(ROOT, 'js', 'background.js'),
    format: 'esm',
    target: 'chrome120',
    minify: false,
    sourcemap: false,
  });

  // Bundle popup script (needs Clerk SDK)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'popup-auth.js')],
    bundle: true,
    outfile: path.join(ROOT, 'popup.js'),
    format: 'iife',
    target: 'chrome120',
    minify: false,
    sourcemap: false,
    define: {
      'process.env.CLERK_PUBLISHABLE_KEY': JSON.stringify(CLERK_KEY),
    },
  });

  console.log('Dev build complete: background.js + popup.js');

  // ===== DIST BUILD (minified, for distribution) =====
  // Clean dist
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(path.join(DIST, 'js'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'css'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'images'), { recursive: true });

  // Minify background (no Clerk, no bundling)
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'background-auth.js')],
    bundle: false,
    outfile: path.join(DIST, 'js', 'background.js'),
    format: 'esm',
    target: 'chrome120',
    minify: true,
    sourcemap: false,
  });

  // Bundle + minify popup
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'popup-auth.js')],
    bundle: true,
    outfile: path.join(DIST, 'popup.js'),
    format: 'iife',
    target: 'chrome120',
    minify: true,
    sourcemap: false,
    define: {
      'process.env.CLERK_PUBLISHABLE_KEY': JSON.stringify(CLERK_KEY),
    },
  });

  // Obfuscate + minify content script for dist only.
  // js/content.js stays readable during development; the shipped copy
  // in dist/js/content.js is obfuscated via javascript-obfuscator.
  // This is the one file worth protecting — it contains the Pinterest
  // scraping/overlay logic. background.js and popup.js stay plain minified.
  {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'content.js'), 'utf8');
    const obf = JavaScriptObfuscator.obfuscate(src, OBFUSCATOR_OPTS).getObfuscatedCode();
    fs.writeFileSync(path.join(DIST, 'js', 'content.js'), obf);
    console.log(`content.js obfuscated: ${src.length} -> ${obf.length} bytes`);
  }

  // Minify CSS
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'css', 'style.css')],
    outfile: path.join(DIST, 'css', 'style.css'),
    bundle: true,
    minify: true,
    sourcemap: false,
  });

  // Copy static files
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
  fs.copyFileSync(path.join(ROOT, 'popup.html'), path.join(DIST, 'popup.html'));

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
