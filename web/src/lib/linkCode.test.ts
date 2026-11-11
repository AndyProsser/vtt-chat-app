import { describe, expect, it } from 'vitest';

import { LINK_CODE_TTL_MS } from '../consts/index.js';
import { deadlineFor, formatCode, formatCountdown, isExpired, secondsLeft } from './linkCode.js';

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

describe('deadlineFor', () => {
  it('is the client receive time plus the TTL minus a 5s safety margin', () => {
    expect(deadlineFor(1_000)).toBe(1_000 + LINK_CODE_TTL_MS - 5_000);
  });
});

describe('formatCountdown', () => {
  it('shows m:ss', () => {
    expect(formatCountdown(295)).toBe('4:55');
    expect(formatCountdown(65)).toBe('1:05');
    expect(formatCountdown(0)).toBe('0:00');
  });
});
