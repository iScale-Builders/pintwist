import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// PinTwist is free and gates nothing: donations are the only funding, and
// everything iScaleLabs gives away carries a ReadyPixl attribution. Both live in
// popup.html, which no other test covers — so a refactor that drops either link,
// or renames the sponsor image without moving the file, fails here rather than
// silently shipping a popup with a broken <img> or no funding surface at all.
describe('popup funding and sponsor surfaces', () => {
  const root = process.cwd();
  const popup = readFileSync(resolve(root, 'popup.html'), 'utf8');

  it('links to Buy Me a Coffee', () => {
    expect(popup).toContain('https://buymeacoffee.com/josequiles');
    expect(popup).toContain('Buy me a coffee');
  });

  it('links to the ReadyPixl sponsor with its call to action', () => {
    expect(popup).toContain('https://readypixl.com');
    expect(popup).toContain('Sponsored by');
    expect(popup).toContain('Click Here for Free Bulk Upscaler and Bulk Image Editing!');
  });

  it('opens both links in a new tab without leaking the opener', () => {
    for (const href of ['https://buymeacoffee.com/josequiles', 'https://readypixl.com']) {
      const tag = popup.slice(popup.indexOf(`href="${href}"`));
      const anchor = tag.slice(0, tag.indexOf('>'));
      expect(anchor, `${href} must open in a new tab`).toContain('target="_blank"');
      expect(anchor, `${href} must set rel="noopener noreferrer"`).toContain(
        'rel="noopener noreferrer"'
      );
    }
  });

  it('references a sponsor image that exists on disk', () => {
    const src = popup.match(/src="(brands\/[\w.-]+)"/)?.[1];
    expect(src, 'popup.html must reference a brands/ sponsor image').toBeTruthy();
    expect(existsSync(resolve(root, src!)), `${src} is referenced but missing`).toBe(true);
  });
});
