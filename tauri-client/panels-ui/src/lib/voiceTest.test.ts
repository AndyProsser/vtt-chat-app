import { describe, expect, it } from 'vitest';

import {
  IDLE_VOICE_TEST,
  isVoiceTestBusy,
  voiceTestText,
  type VoiceTestStatus,
} from './voiceTest.js';

const at = (patch: Partial<VoiceTestStatus>): VoiceTestStatus => ({ ...IDLE_VOICE_TEST, ...patch });

describe('voice test status', () => {
  it('is busy only while recording or playing', () => {
    expect(isVoiceTestBusy(at({ phase: 'idle' }))).toBe(false);
    expect(isVoiceTestBusy(at({ phase: 'ready' }))).toBe(false);
    expect(isVoiceTestBusy(at({ phase: 'recording' }))).toBe(true);
    expect(isVoiceTestBusy(at({ phase: 'playing' }))).toBe(true);
  });

  it('says how far a recording has got, in whole seconds', () => {
    const text = voiceTestText(at({ phase: 'recording', elapsedMs: 3400, totalMs: 5000 }));
    expect(text).toMatch(/3 of 5 s/);
  });

  it('tells a player with a clip what to do next', () => {
    expect(voiceTestText(at({ phase: 'ready', totalMs: 10_000 }))).toMatch(
      /10 s recording is ready/,
    );
  });

  it('explains the test when idle, including that nothing is kept', () => {
    expect(voiceTestText(IDLE_VOICE_TEST)).toMatch(/Nothing is saved or sent/);
  });
});
