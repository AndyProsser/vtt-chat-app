import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const value = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();

describe('typography tokens', () => {
  it('declares the body, heading and narrative font stacks', () => {
    expect(value('--vtt-font-body')).toBeDefined();
    expect(value('--vtt-font-head')).toBeDefined();
    expect(value('--vtt-font-narrative')).toBeDefined();
  });

  it('sets the body in Inter, headings in Cinzel and handouts in Cormorant Garamond', () => {
    expect(value('--vtt-font-body')).toMatch(/^'Inter Variable'/);
    expect(value('--vtt-font-head')).toMatch(/^'Cinzel'/);
    expect(value('--vtt-font-narrative')).toMatch(/^'Cormorant Garamond'/);
  });

  it('ends every stack in a generic family, so a font that fails to load still reads', () => {
    for (const name of ['--vtt-font-body', '--vtt-font-head', '--vtt-font-narrative']) {
      expect(value(name)).toMatch(/(sans-serif|serif)$/);
    }
  });
});
