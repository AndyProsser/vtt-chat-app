import { describe, expect, it } from 'vitest';

import { toneWav } from './toneWav.js';

describe('toneWav', () => {
  it('is a real 16 kHz mono 16-bit WAV of the length asked for', () => {
    const wav = toneWav(1);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(32_000); // one second of 16-bit samples
    expect(wav.length).toBe(44 + 32_000);
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
  });

  it('holds a tone, not silence, and stays well inside the 16-bit range', () => {
    const wav = toneWav(0.5);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    expect(peak).toBeGreaterThan(1_000);
    expect(peak).toBeLessThan(20_000);
  });
});
