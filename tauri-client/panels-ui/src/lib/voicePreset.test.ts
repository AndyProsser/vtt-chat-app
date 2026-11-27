import { describe, expect, it } from 'vitest';

import {
  isVoicePreset,
  VOICE_PRESET_HINT,
  VOICE_PRESET_LABEL,
  VOICE_PRESETS,
} from './voicePreset.js';

describe('voice presets', () => {
  it('has a label and a hint for every preset, from off to broadcast', () => {
    expect(VOICE_PRESETS).toEqual(['off', 'natural', 'warm', 'broadcast']);
    for (const preset of VOICE_PRESETS) {
      expect(VOICE_PRESET_LABEL[preset]).not.toBe('');
      expect(VOICE_PRESET_HINT[preset]).not.toBe('');
    }
  });
  it('accepts only the known names', () => {
    expect(isVoicePreset('warm')).toBe(true);
    expect(isVoicePreset('loud')).toBe(false);
  });
});
