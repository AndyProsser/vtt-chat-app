import { describe, expect, it } from 'vitest';

import { useMicrophoneStore } from './microphoneStore.js';

describe('microphoneStore', () => {
  it('starts muted', () => {
    expect(useMicrophoneStore.getState().muted).toBe(true);
  });

  it('applyMuted replaces the value', () => {
    useMicrophoneStore.getState().applyMuted(false);
    expect(useMicrophoneStore.getState().muted).toBe(false);

    useMicrophoneStore.getState().applyMuted(true);
    expect(useMicrophoneStore.getState().muted).toBe(true);
  });

  it('applyMuted no-ops when the value is unchanged', () => {
    useMicrophoneStore.getState().applyMuted(true);
    const before = useMicrophoneStore.getState();

    useMicrophoneStore.getState().applyMuted(true);
    expect(useMicrophoneStore.getState()).toBe(before);
  });
});
