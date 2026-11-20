import { describe, expect, it } from 'vitest';

import {
  adminHost,
  formatGroupHelp,
  formatHelp,
  helpWidth,
  SERVER_SECTIONS,
  wrapWords,
} from './help.js';

const longestLine = (text: string): number => Math.max(...text.split('\n').map((l) => l.length));

describe('helpWidth', () => {
  it('takes COLUMNS, then the terminal, then 100, kept between 60 and 120', () => {
    expect(helpWidth('90', 200)).toBe(90);
    expect(helpWidth(undefined, 80)).toBe(80);
    expect(helpWidth('nonsense', undefined)).toBe(100);
    expect(helpWidth('20', undefined)).toBe(60);
    expect(helpWidth('300', undefined)).toBe(120);
  });
});

describe('wrapWords', () => {
  it('breaks only between words', () => {
    expect(wrapWords('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });

  it('keeps a bracketed option together', () => {
    expect(wrapWords('publish <dir> [--notes <text>]', 20)).toEqual([
      'publish <dir>',
      '[--notes <text>]',
    ]);
  });

  it('keeps a word longer than the width whole', () => {
    expect(wrapWords('a supercalifragilistic b', 5)).toEqual(['a', 'supercalifragilistic', 'b']);
  });
});

describe('formatHelp', () => {
  it.each([60, 80, 100, 120])('never runs past %i columns', (width) => {
    expect(longestLine(formatHelp(width, 'compose'))).toBeLessThanOrEqual(width);
  });

  it('lists every command, under its section title', () => {
    const text = formatHelp(100, undefined);
    for (const section of SERVER_SECTIONS) {
      expect(text).toContain(section.title);
      for (const command of section.commands) expect(text).toContain(command.usage);
    }
  });

  it('puts a long usage on its own line with the summary indented beneath', () => {
    const lines = formatHelp(100, undefined).split('\n');
    const at = lines.findIndex((l) => l.includes('updates publish <dir>'));
    expect(lines[at]?.trimEnd().endsWith('[--notes <text>]')).toBe(true);
    expect(lines[at + 1]).toMatch(/^ {40}publish a signed client release/);
  });

  it("adds the wrapper's machine commands only for the install that has them", () => {
    expect(formatHelp(100, 'compose')).toContain('voice-address <ip|name|auto>');
    expect(formatHelp(100, 'native')).toContain('journalctl -u vtt-backend -f');
    expect(formatHelp(100, undefined)).not.toContain('This machine');
  });
});

describe('formatGroupHelp', () => {
  it('shows one group, and nothing for a group that does not exist', () => {
    const text = formatGroupHelp('campaign', 100) ?? '';
    expect(text).toContain('campaign export <id> <file> [--accept-loss]');
    expect(text).not.toContain('user list');
    expect(formatGroupHelp('nope', 100)).toBeUndefined();
  });
});

describe('adminHost', () => {
  it('accepts compose and native only', () => {
    expect(adminHost('compose')).toBe('compose');
    expect(adminHost('native')).toBe('native');
    expect(adminHost('docker')).toBeUndefined();
  });
});
