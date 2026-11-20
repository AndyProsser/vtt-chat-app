import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../public/old-browser.js', import.meta.url), 'utf8');

/** A pretend browser: `old` names what is missing. Returns what the script did. */
function run(old: {
  structuredClone?: boolean;
  colorMix?: boolean;
  modules?: boolean;
  ok?: boolean;
}) {
  const appended: unknown[] = [];
  const el = () => ({ style: { cssText: '' }, appendChild() {}, setAttribute() {} });
  const window: Record<string, unknown> = {
    sessionStorage: { getItem: () => (old.ok ? '1' : null), setItem() {} },
    CSS: { supports: (_p: string, v: string) => !(v.startsWith('color-mix') && old.colorMix) },
    location: { reload() {} },
  };
  if (!old.structuredClone) window.structuredClone = () => undefined;
  window.window = window;
  const document = {
    createElement: (tag: string) =>
      tag === 'script' ? (old.modules ? {} : { noModule: true }) : el(),
    createTextNode: () => ({}),
    getElementById: () => el(),
    body: { appendChild: (n: unknown) => appended.push(n) },
    addEventListener() {},
  };
  // `'noModule' in element` is how the script asks about modules.
  runInNewContext(source, { window, document, Object, Array, ...window });
  return { shown: appended.length > 0, flag: window.__vttOldBrowser === true };
}

describe('old-browser.js', () => {
  it('stays out of the way in a modern browser', () => {
    expect(run({})).toEqual({ shown: false, flag: false });
  });

  it.each([
    ['no structuredClone', { structuredClone: true }],
    ['no color-mix', { colorMix: true }],
    ['no ES modules', { modules: true }],
  ])('shows the notice and stops the app when there is %s', (_name, old) => {
    expect(run(old)).toEqual({ shown: true, flag: true });
  });

  it('does nothing once the visitor chose to open it anyway', () => {
    expect(run({ colorMix: true, ok: true })).toEqual({ shown: false, flag: false });
  });

  it('is written in plain old JavaScript', () => {
    expect(source).not.toMatch(/=>|\bconst\b|\blet\b|`/);
  });
});
