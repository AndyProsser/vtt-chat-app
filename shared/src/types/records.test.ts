import { describe, expect, it } from 'vitest';

import {
  canReadSummary,
  DM_ONLY_SUMMARY_KINDS,
  SUMMARY_KINDS,
  SUMMARY_LABELS,
  summaryLabel,
  summaryRank,
} from './records.js';

describe('the records vocabulary', () => {
  it('labels every kind, and shows an unknown one as it is', () => {
    for (const kind of SUMMARY_KINDS) expect(SUMMARY_LABELS[kind]).toBeTruthy();
    expect(summaryLabel('notes')).toBe('Scribe’s notes');
    expect(summaryLabel('odd')).toBe('odd');
  });
  it('ranks the tale first, the Game Master’s working material last, unknown kinds after', () => {
    expect([...SUMMARY_KINDS].sort((a, b) => summaryRank(b) - summaryRank(a))).toEqual([
      'notes',
      'dm-only',
      'character',
      'chapter',
      'session',
    ]);
    expect(summaryRank('odd')).toBeGreaterThan(summaryRank('notes'));
  });
  it('keeps the brief and the scribe’s notes from players', () => {
    expect(DM_ONLY_SUMMARY_KINDS).toEqual(['dm-only', 'notes']);
    expect(canReadSummary('dm', false)).toBe(false);
    expect(canReadSummary('dm', true)).toBe(true);
    expect(canReadSummary('members', false)).toBe(true);
  });
});
