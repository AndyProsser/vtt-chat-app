import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { woff2Only } from './woff2Only.js';

const require = createRequire(import.meta.url);
const fontsourceCss = (pkg: string, file: string) =>
  readFileSync(require.resolve(`${pkg}/package.json`).replace('package.json', file), 'utf8');

const plugin = woff2Only();

describe('woff2Only', () => {
  it('runs before Vite reads the CSS', () => {
    expect(plugin.enforce).toBe('pre');
  });

  it('drops the .woff fallback from a Fontsource face and keeps the .woff2', () => {
    const css = fontsourceCss('@fontsource/alegreya-sc', 'latin-500.css');
    expect(css).toMatch(/\.woff\)/); // the input really carries both
    const out = plugin.transform(css, '/repo/node_modules/@fontsource/alegreya-sc/latin-500.css');
    expect(out).not.toMatch(/\.woff\)/);
    expect(out).toMatch(/alegreya-sc-latin-500-normal\.woff2\) format\('woff2'\)/);
    expect(out).toMatch(/;\s*\}$/); // still a closed declaration, no dangling comma
  });

  it('leaves a variable-font face (woff2 only) unchanged', () => {
    const css = fontsourceCss('@fontsource-variable/inter', 'wght.css');
    expect(plugin.transform(css, '/repo/node_modules/@fontsource-variable/inter/wght.css')).toBe(
      css,
    );
  });

  it('leaves any other stylesheet alone', () => {
    const css = "@font-face { src: url(a.woff2) format('woff2'), url(a.woff) format('woff'); }";
    expect(plugin.transform(css, '/repo/web/src/styles/own.css')).toBeNull();
  });

  it('ignores files that are not CSS', () => {
    expect(plugin.transform('x', '/repo/node_modules/@fontsource/forum/index.js')).toBeNull();
  });
});
