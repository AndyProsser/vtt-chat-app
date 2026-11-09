export interface SceneLayerRecord {
  id: string;
  soundId: string;
  mode: 'loop' | 'random';
  volume: number;
  minIntervalSec: number | null;
  maxIntervalSec: number | null;
}
export interface SceneRecord {
  id: string;
  name: string;
  layers: SceneLayerRecord[];
}

/** What the scene editor holds while editing. Layers without an id are new. */
export interface SceneDraft {
  id?: string;
  name: string;
  layers: {
    id?: string;
    soundId: string;
    mode: 'loop' | 'random';
    volume: number;
    minIntervalSec: number | null;
    maxIntervalSec: number | null;
  }[];
}

export const DEFAULT_GAP: [number, number] = [8, 20];

export const draftOf = (scene: SceneRecord): SceneDraft => ({
  id: scene.id,
  name: scene.name,
  layers: scene.layers.map((l) => ({ ...l })),
});

export const blankScene = (firstSoundId: string): SceneDraft => ({
  name: '',
  layers: [
    {
      soundId: firstSoundId,
      mode: 'loop',
      volume: 0.6,
      minIntervalSec: null,
      maxIntervalSec: null,
    },
  ],
});

/** The layer a new row starts as: a quiet random sound every 8 to 20 seconds. */
export const newLayer = (soundId: string): SceneDraft['layers'][number] => ({
  soundId,
  mode: 'random',
  volume: 0.6,
  minIntervalSec: DEFAULT_GAP[0],
  maxIntervalSec: DEFAULT_GAP[1],
});

/** The body the server's scene routes take: a loop carries no gap. */
export function sceneBody(draft: SceneDraft) {
  return {
    name: draft.name.trim(),
    layers: draft.layers.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      soundId: l.soundId,
      mode: l.mode,
      volume: l.volume,
      minIntervalSec: l.mode === 'random' ? l.minIntervalSec : null,
      maxIntervalSec: l.mode === 'random' ? l.maxIntervalSec : null,
    })),
  };
}

/** What is wrong with the draft, in words for the DM; nothing when it can be saved. */
export function validateScene(draft: SceneDraft): string | undefined {
  if (draft.name.trim() === '') return 'Give the scene a name.';
  if (draft.layers.length === 0) return 'Add at least one layer.';
  for (const l of draft.layers) {
    if (!l.soundId) return 'Every layer needs a sound.';
    if (l.mode === 'random') {
      const { minIntervalSec: lo, maxIntervalSec: hi } = l;
      if (lo === null || hi === null || lo < 1 || hi < lo) {
        return 'Check the gap: the shortest must be at least 1 second and not longer than the longest.';
      }
    }
  }
  return undefined;
}
