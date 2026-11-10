import { TrackType } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';

import { SOUNDBOARD_TRACK, recordableTracks } from './liveKitRecorder.js';

const track = (sid: string, name: string, over: object = {}) => ({
  sid,
  name,
  type: TrackType.AUDIO,
  muted: false,
  ...over,
});

describe('recordableTracks', () => {
  it('records each speaker’s voice tracks', () => {
    expect(
      recordableTracks([
        { identity: 'alice', tracks: [track('T1', 'microphone')] },
        { identity: 'dm', tracks: [track('T2', 'microphone'), track('T3', 'voice-fx')] },
      ]),
    ).toEqual([
      { identity: 'alice', trackSid: 'T1' },
      { identity: 'dm', trackSid: 'T2' },
      { identity: 'dm', trackSid: 'T3' },
    ]);
  });

  it('never records the soundboard: effects are not part of the session record', () => {
    expect(SOUNDBOARD_TRACK).toBe('soundboard');
    expect(
      recordableTracks([
        { identity: 'dm', tracks: [track('T1', 'microphone'), track('T9', SOUNDBOARD_TRACK)] },
      ]),
    ).toEqual([{ identity: 'dm', trackSid: 'T1' }]);
  });

  it('can keep the soundboard as a separate effects track when the operator switches that on', () => {
    expect(
      recordableTracks(
        [{ identity: 'dm', tracks: [track('T1', 'microphone'), track('T9', SOUNDBOARD_TRACK)] }],
        { includeEffects: true },
      ),
    ).toEqual([
      { identity: 'dm', trackSid: 'T1' },
      { identity: 'dm', trackSid: 'T9', effects: true },
    ]);
  });

  it('skips muted tracks and anything that is not audio', () => {
    expect(
      recordableTracks([
        {
          identity: 'a',
          tracks: [
            track('T1', 'microphone', { muted: true }),
            track('T2', 'screen', { type: TrackType.VIDEO }),
          ],
        },
      ]),
    ).toEqual([]);
  });
});
