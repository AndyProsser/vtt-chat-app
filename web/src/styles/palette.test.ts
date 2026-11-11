import { describe, expect, it } from 'vitest';

// Read as text (Vite's ?raw), with paths relative to this file; no Node types needed.
import themes from '../../../tauri-client/panels-ui/src/lib/themes.ts?raw';
import statusCss from '../../../status/src/styles/palette.css?raw';
import webCss from './palette.css?raw';

const palettes = [
  { pkg: 'web', css: webCss },
  { pkg: 'status', css: statusCss },
];

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The `{ key: '#hex', ... }` body of one variant of the `default` theme in themes.ts. */
function variant(name: 'light' | 'dark'): Record<string, string> {
  const start = themes.indexOf("id: 'default'");
  const end = themes.indexOf("id: '", start + 10);
  const block = themes.slice(start, end);
  const open = block.indexOf(`${name}: {`);
  const body = block.slice(open, block.indexOf('}', open));
  return Object.fromEntries(
    [...body.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,8})'/g)].map((m) => [m[1]!, m[2]!.toLowerCase()]),
  );
}

/** The declarations of the first `:root { ... }` block at or after `from`. */
function declared(css: string, from: number): Record<string, string> {
  const open = css.indexOf(':root {', from);
  const body = css.slice(open, css.indexOf('}', open));
  return Object.fromEntries(
    [...body.matchAll(/--vtt-([\w-]+):\s*(#[0-9a-fA-F]{3,8});/g)].map((m) => [
      m[1]!,
      m[2]!.toLowerCase(),
    ]),
  );
}

describe('palette.css matches the desktop app Default theme', () => {
  for (const { pkg, css } of palettes) {
    for (const mode of ['light', 'dark'] as const) {
      it(`${pkg}: ${mode}`, () => {
        const expected = variant(mode);
        expect(Object.keys(expected)).toHaveLength(13);
        const from = mode === 'light' ? 0 : css.indexOf('prefers-color-scheme: dark');
        expect(from).toBeGreaterThanOrEqual(0);
        const actual = declared(css, from);
        for (const [key, hex] of Object.entries(expected)) {
          expect(actual[kebab(key)], `--vtt-${kebab(key)}`).toBe(hex);
        }
      });
    }
  }
});
