import { describe, expect, it } from 'vitest';

import { blankScene, draftOf, sceneBody, validateScene, type SceneRecord } from './sceneDraft.js';

const record: SceneRecord = {
  id: 's1',
  name: 'Tavern',
  layers: [
    {
      id: 'l1',
      soundId: 'crowd',
      mode: 'loop',
      volume: 0.6,
      minIntervalSec: null,
      maxIntervalSec: null,
    },
    {
      id: 'l2',
      soundId: 'clink',
      mode: 'random',
      volume: 0.4,
      minIntervalSec: 20,
      maxIntervalSec: 45,
    },
  ],
};

describe('scene drafts', () => {
  it('round-trips a stored scene through the editor', () => {
    expect(sceneBody(draftOf(record))).toEqual({
      name: 'Tavern',
      layers: [
        {
          id: 'l1',
          soundId: 'crowd',
          mode: 'loop',
          volume: 0.6,
          minIntervalSec: null,
          maxIntervalSec: null,
        },
        {
          id: 'l2',
          soundId: 'clink',
          mode: 'random',
          volume: 0.4,
          minIntervalSec: 20,
          maxIntervalSec: 45,
        },
      ],
    });
  });

  it('sends no gap for a loop, whatever was typed', () => {
    const draft = draftOf(record);
    draft.layers[0]!.minIntervalSec = 5;
    expect(sceneBody(draft).layers[0]).toMatchObject({
      minIntervalSec: null,
      maxIntervalSec: null,
    });
  });

  it('starts blank with one loop layer slot and a default gap ready for a random one', () => {
    const d = blankScene('crowd');
    expect(d.name).toBe('');
    expect(d.layers).toHaveLength(1);
    expect(d.layers[0]).toMatchObject({ soundId: 'crowd', mode: 'loop' });
  });

  it('asks for a name, at least one layer, a sound on every layer, and a sensible gap', () => {
    const ok = draftOf(record);
    expect(validateScene(ok)).toBeUndefined();
    expect(validateScene({ ...ok, name: '  ' })).toMatch(/name/i);
    expect(validateScene({ ...ok, layers: [] })).toMatch(/layer/i);
    expect(validateScene({ ...ok, layers: [{ ...ok.layers[0]!, soundId: '' }] })).toMatch(/sound/i);
    expect(
      validateScene({
        ...ok,
        layers: [{ ...ok.layers[1]!, minIntervalSec: 50, maxIntervalSec: 10 }],
      }),
    ).toMatch(/gap/i);
  });
});
