import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { LANGUAGE_FONTS } from '../consts/languageFonts.js';

const here = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const imported = here('./languages.ts') + here('./core.ts');
const require = createRequire(import.meta.url);

/** Fontsource names a package after the family: "Alegreya Sans SC" is `alegreya-sans-sc`. */
const slug = (family: string) => family.toLowerCase().replace(/\s+/g, '-');

const fontsourceFamilies = Object.entries(LANGUAGE_FONTS).filter(
  ([, f]) => f.family !== 'Inter Variable',
);

describe('the bundled language fonts', () => {
  it.each(fontsourceFamilies)(
    '%s: the font file its entry names exists and is imported',
    (_key, f) => {
      const file = `latin-${f.weight}${f.italic ? '-italic' : ''}.css`;
      const pkg = `@fontsource/${slug(f.family)}`;
      const path = `${pkg}/${file}`;
      expect(
        existsSync(require.resolve(`${pkg}/package.json`).replace('package.json', file)),
        path,
      ).toBe(true);
      expect(imported, `${path} is not imported`).toContain(`'${path}'`);
    },
  );

  it('imports nothing no language uses', () => {
    const wanted = new Set(
      fontsourceFamilies.map(
        ([, f]) =>
          `@fontsource/${slug(f.family)}/latin-${f.weight}${f.italic ? '-italic' : ''}.css`,
      ),
    );
    const extra = [...here('./languages.ts').matchAll(/'(@fontsource\/[^']+)'/g)]
      .map((m) => m[1]!)
      .filter((path) => !wanted.has(path));
    expect(extra).toEqual([]);
  });
});
