import { describe, expect, it, vi } from 'vitest';

import { clipToWords, fitNotes, wordCount } from './fitNotes.js';
import { estimateTokens } from './tokenBudget.js';

const notesOf = (parts: number, wordsEach: number): string[] =>
  Array.from({ length: parts }, (_, p) =>
    [
      '## Events',
      ...Array.from(
        { length: wordsEach / 5 },
        (_, i) => `- Part ${p} thing ${i} happened to everyone.`,
      ),
    ].join('\n'),
  );

describe('clipToWords', () => {
  it('leaves text that already fits alone', () => {
    expect(clipToWords('## Events\n- a b c', 50)).toBe('## Events\n- a b c');
  });
  it('keeps the headings and thins the bullets evenly down to the limit', () => {
    const text = [
      '## Events',
      ...Array.from({ length: 100 }, (_, i) => `- line ${i} has some words`),
    ].join('\n');
    const out = clipToWords(text, 100);
    expect(wordCount(out)).toBeLessThanOrEqual(100);
    expect(out.startsWith('## Events')).toBe(true);
    expect(out).toContain('line 0 '); // the start is kept
    expect(out).toMatch(/line 9\d /); // and so is the end: thinned, not cut off
  });
});

describe('fitNotes', () => {
  const window = 12_288;

  it('does nothing, and calls no model, when the notes already fit', async () => {
    const scribe = vi.fn(async () => 'x');
    const r = await fitNotes(scribe, notesOf(2, 200), { window });
    expect(scribe).not.toHaveBeenCalled();
    expect(r.notes).toHaveLength(2);
    expect(r.modelCalls).toBe(0);
  });

  it('asks for a recap with a word limit, and returns notes that fit the window', async () => {
    const big = notesOf(10, 800); // about 8,000 words, far past the window
    expect(estimateTokens(big.join('\n\n'))).toBeGreaterThan(window);
    const prompts: string[] = [];
    // An obedient model: it writes about half of what it is given.
    const scribe = async (prompt: string): Promise<string> => {
      prompts.push(prompt);
      const limit = /at most (\d+) words/.exec(prompt)?.[1];
      return [
        '## Events',
        ...Array.from({ length: Number(limit ?? 50) / 6 }, (_, i) => `- kept ${i} thing here`),
      ].join('\n');
    };
    const r = await fitNotes(scribe, big, { window });
    expect(estimateTokens(r.notes.join('\n\n'))).toBeLessThanOrEqual(window * 0.7);
    expect(prompts.every((p) => /at most \d+ words/.test(p))).toBe(true);
    expect(prompts[0]).toMatch(/recap|matter/i);
  });

  it('still fits when the model ignores the limit and gives back what it was given', async () => {
    const big = notesOf(10, 800);
    const stubborn = vi.fn(
      async (prompt: string) =>
        prompt.split('Notes, in order:\n\n')[1]!.split('\n\nShorter notes:')[0]!,
    );
    const r = await fitNotes(stubborn, big, { window });
    expect(estimateTokens(r.notes.join('\n\n'))).toBeLessThanOrEqual(window * 0.7);
    // bounded: a stubborn model is asked, told once more, then clipped; never an endless loop
    expect(stubborn.mock.calls.length).toBeLessThan(80);
  });

  it('tells a model that wrote too much once, then accepts the shorter answer', async () => {
    const big = notesOf(4, 4000);
    const answers: string[] = [];
    const scribe = async (prompt: string): Promise<string> => {
      const limit = Number(/at most (\d+) words/.exec(prompt)?.[1] ?? 100);
      const retry = /last attempt/i.test(prompt);
      const words = retry ? Math.floor(limit * 0.8) : limit * 3;
      const out = `## Events\n- ${'w '.repeat(words)}`;
      answers.push(retry ? 'retry' : 'first');
      return out;
    };
    const r = await fitNotes(scribe, big, { window });
    expect(answers).toContain('retry');
    expect(estimateTokens(r.notes.join('\n\n'))).toBeLessThanOrEqual(window * 0.7);
  });

  it('clips a group by code when the model keeps aborting on it (a repeat-limit abort), and goes on', async () => {
    let calls = 0;
    const scribe = async (): Promise<string> => {
      calls += 1;
      throw new Error(
        '/v1/chat/completions failed with status 500: prediction aborted, token repeat limit reached',
      );
    };
    const r = await fitNotes(scribe, notesOf(10, 800), { window });
    expect(estimateTokens(r.notes.join('\n\n'))).toBeLessThanOrEqual(window * 0.7);
    expect(calls).toBeLessThan(80); // each group is tried twice, then clipped
  });

  it('does not hide a model that cannot be reached: that still fails the job (so failover can act)', async () => {
    const scribe = async (): Promise<string> => {
      throw new Error('fetch failed');
    };
    await expect(fitNotes(scribe, notesOf(10, 800), { window })).rejects.toThrow('fetch failed');
  });

  it('counts every model call it makes', async () => {
    const scribe = vi.fn(async () => '## Events\n- short');
    const r = await fitNotes(scribe, notesOf(10, 800), { window });
    expect(r.modelCalls).toBe(scribe.mock.calls.length);
  });
});
