import { describe, expect, it } from 'vitest';

import { counter, isShared, nearLimit, NOTE_LIMITS, validateNote } from './noteForm.js';

describe('validateNote', () => {
  it('accepts a title and a body, trimming the title and keeping the body as written', () => {
    const r = validateNote({ title: '  The riddle ', body: '  # Speak\n\nfriend  ' });
    expect(r.errors).toEqual({});
    expect(r.payload).toEqual({ title: 'The riddle', text: '  # Speak\n\nfriend  ' });
  });
  it('needs both, and the server limits (200 and 20,000) hold exactly', () => {
    expect(validateNote({ title: ' ', body: 'x' }).errors.title).toBeDefined();
    expect(validateNote({ title: 'x', body: ' \n ' }).errors.body).toBeDefined();
    expect(validateNote({ title: 'x'.repeat(200), body: 'x' }).errors).toEqual({});
    expect(validateNote({ title: 'x'.repeat(201), body: 'x' }).errors.title).toBeDefined();
    expect(validateNote({ title: 'x', body: 'x'.repeat(NOTE_LIMITS.body) }).errors).toEqual({});
    expect(
      validateNote({ title: 'x', body: 'x'.repeat(NOTE_LIMITS.body + 1) }).errors.body,
    ).toBeDefined();
  });
});

describe('counter', () => {
  it('formats and warns in the last tenth', () => {
    expect(counter(1204, 20000)).toBe('1,204 / 20,000');
    expect(nearLimit(17_999, 20_000)).toBe(false);
    expect(nearLimit(18_000, 20_000)).toBe(true);
  });
});

describe('isShared', () => {
  it('is false for a draft and for an older server that sends no visibility', () => {
    expect(isShared({ visibility: 'dm' })).toBe(false);
    expect(isShared({})).toBe(false);
    expect(isShared({ visibility: 'all' })).toBe(true);
    expect(isShared({ visibility: 'some' })).toBe(true);
  });
});
