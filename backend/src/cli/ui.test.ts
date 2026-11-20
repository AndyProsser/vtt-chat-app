import { describe, expect, it } from 'vitest';

import { createUi, duration, plainUi, visibleLength } from './ui.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

describe('createUi', () => {
  it('is rich on a terminal and plain when piped or asked for --plain', () => {
    expect(createUi({ isTTY: true, env: {} })).toMatchObject({ color: true, unicode: true });
    expect(createUi({ isTTY: false, env: {} })).toMatchObject({ color: false, unicode: false });
    expect(createUi({ isTTY: true, env: {}, plain: true })).toMatchObject({
      color: false,
      unicode: false,
    });
  });

  it('honours NO_COLOR (graphics stay) and FORCE_COLOR (no terminal needed)', () => {
    expect(createUi({ isTTY: true, env: { NO_COLOR: '1' } })).toMatchObject({
      color: false,
      unicode: true,
    });
    expect(createUi({ isTTY: false, env: { FORCE_COLOR: '1' } })).toMatchObject({
      color: true,
      unicode: true,
    });
    expect(createUi({ isTTY: false, env: { FORCE_COLOR: '0' } })).toMatchObject({ color: false });
    expect(createUi({ isTTY: true, env: { VTT_ADMIN_PLAIN: '1' } })).toMatchObject({
      color: false,
      unicode: false,
    });
  });
});

describe('table', () => {
  it('aligns columns by what shows on screen, ignoring colour escapes', () => {
    const ui = createUi({ isTTY: true, env: {} });
    const lines = ui.table([
      [ui.good('ok'), 'a', 'end'],
      ['failure', 'bbb', 'end'],
    ]);
    const where = lines.map((l) => l.replace(ANSI, '').indexOf('end'));
    expect(where[0]).toBe(where[1]);
  });

  it('does not pad the last column', () => {
    expect(plainUi().table([['a', 'b']])).toEqual(['  a  b']);
  });
});

describe('bar', () => {
  it('fills by share, in ASCII when plain', () => {
    expect(plainUi().bar(0.5, 10)).toBe('[#####.....]  50%');
    expect(plainUi().bar(2, 4)).toBe('[####] 100%');
  });

  it('is the same width on screen in colour', () => {
    const ui = createUi({ isTTY: true, env: {} });
    expect(visibleLength(ui.bar(0.95, 10))).toBe(visibleLength(plainUi().bar(0.95, 10)) - 2);
  });
});

describe('duration', () => {
  it('shows the two largest units', () => {
    expect(duration(40)).toBe('40s');
    expect(duration(125 * 60)).toBe('2h 5m');
    expect(duration(3 * 86_400 + 4 * 3600 + 59)).toBe('3d 4h');
  });
});
