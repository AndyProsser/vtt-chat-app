import { describe, expect, it } from 'vitest';

import { parseTrackFileName } from './records-smoke.js';

describe('parseTrackFileName', () => {
  it('reads a plain speaker id', () => {
    expect(parseTrackFileName('alice.ogg')).toEqual({ speakerId: 'alice', startOffsetMs: 0 });
  });

  it('reads a start offset after the last @', () => {
    expect(parseTrackFileName('bob@12000.opus')).toEqual({
      speakerId: 'bob',
      startOffsetMs: 12000,
    });
    expect(parseTrackFileName('a@b@500.wav')).toEqual({ speakerId: 'a@b', startOffsetMs: 500 });
  });

  it('ignores non-audio files and rejects a bad offset', () => {
    expect(parseTrackFileName('notes.txt')).toBeNull();
    expect(parseTrackFileName('bob@soon.ogg')).toBeNull();
    expect(parseTrackFileName('bob@-5.ogg')).toBeNull();
  });
});
