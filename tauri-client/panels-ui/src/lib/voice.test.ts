import { describe, expect, it } from 'vitest';

import { nextVoiceAction } from './voice.js';

describe('nextVoiceAction', () => {
  it('connects when not in voice and disconnects when in voice', () => {
    expect(nextVoiceAction(false, false)).toBe('connect');
    expect(nextVoiceAction(true, false)).toBe('disconnect');
  });
  it('waits while a connect or disconnect is in flight', () => {
    expect(nextVoiceAction(false, true)).toBe('wait');
    expect(nextVoiceAction(true, true)).toBe('wait');
  });
});
