import { describe, expect, it } from 'vitest';

import { AWAY_MINUTE_CHOICES, awayMinutesLabel, micAvailable, STATUSES } from './status.js';
import { useStatusStore } from './statusStore.js';

describe('status', () => {
  it('starts offline, where every launch begins', () => {
    expect(useStatusStore.getState().status).toBe('offline');
  });
  it('keeps the same state object when the status has not changed', () => {
    const before = useStatusStore.getState();
    before.applyStatus('offline');
    expect(useStatusStore.getState()).toBe(before);
    before.applyStatus('away');
    expect(useStatusStore.getState().status).toBe('away');
    before.applyStatus('offline');
  });
  it('offers the microphone only while in voice', () => {
    expect(STATUSES.filter(micAvailable)).toEqual(['online', 'away']);
  });
  it('labels the automatic-away choices, with 0 as never', () => {
    expect(AWAY_MINUTE_CHOICES.map(awayMinutesLabel)).toEqual([
      'Never',
      'After 5 minutes',
      'After 10 minutes',
      'After 15 minutes',
      'After 30 minutes',
      'After 60 minutes',
    ]);
  });
});
