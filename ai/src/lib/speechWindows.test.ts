import { describe, expect, it } from 'vitest';

import {
  invert,
  offsetSegments,
  parseSilenceDetect,
  speechWindows,
  transcribeWindows,
} from './speechWindows.js';

describe('parseSilenceDetect', () => {
  it('reads start/end pairs into milliseconds', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 0',
      '[silencedetect @ 0x1] silence_end: 5.106313 | silence_duration: 5.106313',
      '[silencedetect @ 0x1] silence_start: 15.999937',
      '[silencedetect @ 0x1] silence_end: 65.1 | silence_duration: 49.1',
    ].join('\n');
    expect(parseSilenceDetect(stderr, 100_000)).toEqual([
      { startMs: 0, endMs: 5106 },
      { startMs: 16000, endMs: 65100 },
    ]);
  });

  it('closes a trailing silence at the end of the track', () => {
    expect(parseSilenceDetect('silence_start: 90.5', 100_000)).toEqual([
      { startMs: 90500, endMs: 100_000 },
    ]);
  });

  it('clamps a slightly negative start and ignores unrelated lines', () => {
    const stderr = 'size=N/A\nsilence_start: -0.002\nsilence_end: 2 | silence_duration: 2.002\n';
    expect(parseSilenceDetect(stderr, 10_000)).toEqual([{ startMs: 0, endMs: 2000 }]);
  });

  it('returns nothing for a track with no silence', () => {
    expect(parseSilenceDetect('Input #0, wav\n', 10_000)).toEqual([]);
  });
});

describe('invert', () => {
  it('returns the gaps between silences, including the ends', () => {
    expect(
      invert(
        [
          { startMs: 1000, endMs: 2000 },
          { startMs: 5000, endMs: 6000 },
        ],
        8000,
      ),
    ).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 2000, endMs: 5000 },
      { startMs: 6000, endMs: 8000 },
    ]);
  });

  it('copes with overlapping and unsorted silences', () => {
    expect(
      invert(
        [
          { startMs: 4000, endMs: 6000 },
          { startMs: 1000, endMs: 5000 },
        ],
        8000,
      ),
    ).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 6000, endMs: 8000 },
    ]);
  });

  it('a track that is all silence has no speech', () => {
    expect(invert([{ startMs: 0, endMs: 5000 }], 5000)).toEqual([]);
  });
});

describe('speechWindows', () => {
  const opts = { minSpeechMs: 300, padMs: 400, mergeGapMs: 2000, maxWindowMs: 60_000 };

  it('finds the window around each stretch of speech, padded', () => {
    // speech 5-16 s and 65-76 s in a 100 s track (the spike's sparse fixture)
    const windows = speechWindows(
      [
        { startMs: 0, endMs: 5000 },
        { startMs: 16_000, endMs: 65_000 },
        { startMs: 76_000, endMs: 100_000 },
      ],
      100_000,
      opts,
    );
    expect(windows).toEqual([
      { startMs: 4600, endMs: 16_400 },
      { startMs: 64_600, endMs: 76_400 },
    ]);
  });

  it('keeps leading silence out of the window, so offsets are exact', () => {
    // Bob's track: 12 s of silence, then speech. Whisper alone said it began at 0.
    const [first] = speechWindows([{ startMs: 0, endMs: 12_000 }], 23_000, opts);
    expect(first?.startMs).toBe(11_600);
  });

  it('merges speech separated by a short pause into one window', () => {
    // speech 0-5 s and 6-10 s with a 1 s pause between: one conversation, one window
    const windows = speechWindows([{ startMs: 5000, endMs: 6000 }], 10_000, {
      ...opts,
      padMs: 0,
    });
    expect(windows).toEqual([{ startMs: 0, endMs: 10_000 }]);
  });

  it('does not merge across a long silence', () => {
    const windows = speechWindows([{ startMs: 5000, endMs: 20_000 }], 25_000, opts);
    expect(windows).toHaveLength(2);
  });

  it('drops blips shorter than the minimum', () => {
    const windows = speechWindows(
      [
        { startMs: 0, endMs: 5000 },
        { startMs: 5100, endMs: 20_000 }, // 100 ms of "speech" between two silences
      ],
      30_000,
      { ...opts, padMs: 0 },
    );
    expect(windows).toEqual([{ startMs: 20_000, endMs: 30_000 }]);
  });

  it('never lets a window exceed the maximum, splitting at a pause where it can', () => {
    // 10 s speech blocks 1.5 s apart: merging all would give 100 s; max is 30 s
    const silences = Array.from({ length: 9 }, (_, i) => ({
      startMs: 10_000 + i * 11_500,
      endMs: 11_500 + i * 11_500,
    }));
    const windows = speechWindows(silences, 114_000, { ...opts, maxWindowMs: 30_000, padMs: 0 });
    expect(windows.length).toBeGreaterThan(2);
    for (const w of windows) expect(w.endMs - w.startMs).toBeLessThanOrEqual(30_000);
    expect(windows[0]?.startMs).toBe(0);
    expect(windows.at(-1)?.endMs).toBe(114_000);
  });

  it('cuts a single over-long stretch into equal parts', () => {
    const windows = speechWindows([], 150_000, { ...opts, maxWindowMs: 60_000 });
    expect(windows).toEqual([
      { startMs: 0, endMs: 50_000 },
      { startMs: 50_000, endMs: 100_000 },
      { startMs: 100_000, endMs: 150_000 },
    ]);
  });

  it('windows never overlap and stay inside the track', () => {
    const windows = speechWindows(
      [
        { startMs: 1000, endMs: 1800 },
        { startMs: 2600, endMs: 9000 },
      ],
      10_000,
      opts,
    );
    for (const [i, w] of windows.entries()) {
      expect(w.startMs).toBeGreaterThanOrEqual(0);
      expect(w.endMs).toBeLessThanOrEqual(10_000);
      if (i > 0) expect(w.startMs).toBeGreaterThanOrEqual(windows[i - 1]?.endMs ?? 0);
    }
  });

  it('an entirely silent track yields no windows', () => {
    expect(speechWindows([{ startMs: 0, endMs: 60_000 }], 60_000, opts)).toEqual([]);
  });
});

describe('offsetSegments', () => {
  it('moves window-relative times onto the track timeline', () => {
    expect(
      offsetSegments([{ startMs: 500, endMs: 2500, text: 'hi' }], {
        startMs: 11_600,
        endMs: 23_000,
      }),
    ).toEqual([{ startMs: 12_100, endMs: 14_100, text: 'hi' }]);
  });

  it('clips an end that runs past the window', () => {
    const [s] = offsetSegments([{ startMs: 0, endMs: 99_000, text: 'x' }], {
      startMs: 1000,
      endMs: 5000,
    });
    expect(s?.endMs).toBe(5000);
  });
});

describe('transcribeWindows', () => {
  it('transcribes each window and returns one ordered timeline', async () => {
    const calls: number[] = [];
    const progress: string[] = [];
    const out = await transcribeWindows(
      [
        { startMs: 4600, endMs: 16_400 },
        { startMs: 64_600, endMs: 76_400 },
      ],
      {
        transcribeWindow: async (_w, i) => {
          calls.push(i);
          return [{ startMs: 400, endMs: 8000, text: `line ${i}` }];
        },
        onProgress: (d, t) => progress.push(`${d}/${t}`),
      },
    );
    expect(calls).toEqual([0, 1]);
    expect(progress).toEqual(['1/2', '2/2']);
    expect(out.map((s) => [s.startMs, s.text])).toEqual([
      [5000, 'line 0'],
      [65_000, 'line 1'],
    ]);
  });

  it('fails the whole track when one window fails, rather than leave a silent hole', async () => {
    await expect(
      transcribeWindows(
        [
          { startMs: 0, endMs: 1000 },
          { startMs: 5000, endMs: 6000 },
        ],
        {
          transcribeWindow: async (_w, i) => {
            if (i === 1) throw new Error('whisper crashed');
            return [];
          },
        },
      ),
    ).rejects.toThrow('whisper crashed');
  });

  it('returns nothing for a track with no speech', async () => {
    expect(await transcribeWindows([], { transcribeWindow: async () => [] })).toEqual([]);
  });
});
