export type NoiseFilterLevel = 'off' | 'light' | 'standard' | 'strong';

export const NOISE_FILTER_LEVELS: readonly NoiseFilterLevel[] = [
  'off',
  'light',
  'standard',
  'strong',
];

export const NOISE_FILTER_LABEL: Record<NoiseFilterLevel, string> = {
  off: 'Off',
  light: 'Light',
  standard: 'Standard',
  strong: 'Strong',
};

/** What each level does, in words a player can act on. */
export const NOISE_FILTER_HINT: Record<NoiseFilterLevel, string> = {
  off: 'Your microphone as it is (WebRTC’s own gentle noise reduction still runs).',
  light: 'Takes the edge off fans and hum and keeps more of the room.',
  standard: 'Removes fans, air conditioning and steady hum. Typing is only softened.',
  strong:
    'Standard, plus it closes between words, so typing and mouse clicks mostly disappear. Adds 20 ms of delay.',
};

export function isNoiseFilterLevel(value: string): value is NoiseFilterLevel {
  return (NOISE_FILTER_LEVELS as readonly string[]).includes(value);
}
