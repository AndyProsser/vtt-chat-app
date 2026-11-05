import { describe, expect, it } from 'vitest';

import { useSpeakingStore } from './speakingStore.js';

describe('speakingStore', () => {
  it('starts with no one speaking', () => {
    expect(useSpeakingStore.getState().speakingIdentities.size).toBe(0);
  });

  it('applySpeakers replaces the set wholesale', () => {
    useSpeakingStore.getState().applySpeakers(['alice', 'bob']);
    expect(useSpeakingStore.getState().speakingIdentities).toEqual(new Set(['alice', 'bob']));

    useSpeakingStore.getState().applySpeakers(['carol']);
    expect(useSpeakingStore.getState().speakingIdentities).toEqual(new Set(['carol']));
  });

  it('applySpeakers no-ops when the set is unchanged', () => {
    useSpeakingStore.getState().applySpeakers(['alice', 'bob']);
    const before = useSpeakingStore.getState();

    useSpeakingStore.getState().applySpeakers(['bob', 'alice']);
    expect(useSpeakingStore.getState()).toBe(before);
  });

  it('applySpeakers writes when membership changes even if size matches', () => {
    useSpeakingStore.getState().applySpeakers(['alice', 'bob']);
    const before = useSpeakingStore.getState();

    useSpeakingStore.getState().applySpeakers(['alice', 'carol']);
    expect(useSpeakingStore.getState()).not.toBe(before);
    expect(useSpeakingStore.getState().speakingIdentities).toEqual(new Set(['alice', 'carol']));
  });
});
