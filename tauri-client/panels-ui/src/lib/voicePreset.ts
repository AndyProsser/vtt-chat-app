export type VoicePresetName = 'off' | 'natural' | 'warm' | 'broadcast';

export const VOICE_PRESETS: readonly VoicePresetName[] = ['off', 'natural', 'warm', 'broadcast'];

export const VOICE_PRESET_LABEL: Record<VoicePresetName, string> = {
  off: 'Off',
  natural: 'Natural',
  warm: 'Warm',
  broadcast: 'Broadcast',
};

/** What each preset does, in words a player can act on. */
export const VOICE_PRESET_HINT: Record<VoicePresetName, string> = {
  off: 'Your microphone as it is, after noise and echo cleaning.',
  natural: 'A little body and brightness, and a gentle levelling. A good start.',
  warm: 'More low end and a softer top: a warm, close voice.',
  broadcast: 'The most polish: firm lows, less boxiness, clear presence, an even level.',
};

export function isVoicePreset(value: string): value is VoicePresetName {
  return (VOICE_PRESETS as readonly string[]).includes(value);
}
