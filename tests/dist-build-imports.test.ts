import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Regression guard: a previous change added an `import` to catalog.js without updating build.cjs
// to copy that file into dist/ — the import 404'd and a failed static import aborts the ENTIRE
// catalog module (default view and all). This asserts every local module catalog.js imports is
// referenced by build.cjs (copied into dist/), so "import a new file but forget the build" fails
// in CI instead of in the browser.
describe('build.cjs ships every module catalog.js imports', () => {
  const root = process.cwd();
  const catalogSrc = readFileSync(resolve(root, 'catalog.js'), 'utf8');
  const buildSrc = readFileSync(resolve(root, 'build.cjs'), 'utf8');
  const imports = [...catalogSrc.matchAll(/from\s+['"]\.\/([\w.-]+\.js)['"]/g)].map((m) => m[1]);

  it('catalog.js has local module imports', () => {
    expect(imports.length).toBeGreaterThan(0);
  });

  it.each(imports)('build.cjs references %s (so it lands in dist/)', (file) => {
    const referenced = buildSrc.includes(`'${file}'`) || buildSrc.includes(`"${file}"`);
    expect(
      referenced,
      `${file} is imported by catalog.js but build.cjs never references it → it won't be in dist/`
    ).toBe(true);
  });
});
