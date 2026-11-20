import { useEffect, useState } from 'react';

import { onSoundboardActive, onVoiceEffect, voiceEffectGet } from '../lib/tauriBridge.js';
import { useActiveScene } from './useActiveScene.js';

/** What is sounding right now on the DM's deck, so the buttons can say so even when their panels are closed. */
export interface SoundActivity {
  /** 1 while a character voice is on (not the normal voice), else 0. */
  voice: number;
  /** How many stinger sounds are playing. */
  stingers: number;
  /** 1 while a scene runs, else 0. */
  scenes: number;
  total: number;
}

export const activityTotal = (a: Pick<SoundActivity, 'voice' | 'stingers' | 'scenes'>): number =>
  a.voice + a.stingers + a.scenes;

export function useSoundActivity(): SoundActivity {
  const scene = useActiveScene();
  const [voice, setVoice] = useState(0);
  const [stingers, setStingers] = useState(0);
  useEffect(() => {
    let live = true;
    void voiceEffectGet().then(
      (v) => live && setVoice(v === 'normal' ? 0 : 1),
      () => undefined,
    );
    const offVoice = onVoiceEffect((v) => setVoice(v === 'normal' ? 0 : 1));
    const offSounds = onSoundboardActive(setStingers);
    return () => {
      live = false;
      void offVoice.then((fn) => fn());
      void offSounds.then((fn) => fn());
    };
  }, []);
  const scenes = scene ? 1 : 0;
  return { voice, stingers, scenes, total: activityTotal({ voice, stingers, scenes }) };
}
