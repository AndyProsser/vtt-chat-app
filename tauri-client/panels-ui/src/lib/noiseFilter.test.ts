import { describe, expect, it } from 'vitest';

import {
  isNoiseFilterLevel,
  NOISE_FILTER_HINT,
  NOISE_FILTER_LABEL,
  NOISE_FILTER_LEVELS,
} from './noiseFilter.js';

describe('noise filter levels', () => {
  it('has a label and a hint for every level, in order from off to strong', () => {
    expect(NOISE_FILTER_LEVELS).toEqual(['off', 'light', 'standard', 'strong']);
    for (const level of NOISE_FILTER_LEVELS) {
      expect(NOISE_FILTER_LABEL[level]).not.toBe('');
      expect(NOISE_FILTER_HINT[level]).not.toBe('');
    }
  });
  it('accepts only the known names', () => {
    expect(isNoiseFilterLevel('strong')).toBe(true);
    expect(isNoiseFilterLevel('loud')).toBe(false);
  });
});
