import { describe, expect, it } from 'vitest';

import { formatCode, isExpired, secondsLeft } from './linkCode.js';

describe('formatCode', () => {
  it('groups in fours with a dash', () => {
    expect(formatCode('ABCD2345')).toBe('ABCD-2345');
  });
  it('leaves an already grouped code alone and upper-cases', () => {
    expect(formatCode('abcd-2345')).toBe('ABCD-2345');
  });
});

describe('secondsLeft / isExpired', () => {
  it('counts down and rounds up', () => {
    expect(secondsLeft(10_000, 4_500)).toBe(6);
    expect(secondsLeft(10_000, 9_999)).toBe(1);
  });
  it('never goes negative', () => {
    expect(secondsLeft(10_000, 20_000)).toBe(0);
  });
  it('expires exactly at the deadline', () => {
    expect(isExpired(10_000, 9_999)).toBe(false);
    expect(isExpired(10_000, 10_000)).toBe(true);
  });
});
