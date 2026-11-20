import { describe, expect, it, vi } from 'vitest';

import type { Utterance } from '../types/index.js';
import {
  emptyNotes,
  mergeNotes,
  NOTES_MAX_WORDS,
  notesWords,
  parseNotes,
  renderNotes,
} from './notes.js';
import { takeNotes } from './summarise.js';

const speaker = { id: 'a', name: 'ALICE' };
const lines = (count: number): Utterance[] =>
  Array.from({ length: count }, (_, i) => ({
    speaker,
    startMs: i * 10_000,
    endMs: i * 10_000 + 5_000,
    text: `line number ${i} with some padding words to take up room`,
  }));

describe('parseNotes', () => {
  it('reads Markdown headings and bullets into sections', () => {
    const notes = parseNotes(
      '## Events\n- The party entered the keep.\n- They met Ravenshade.\n\n## Memorable quotes\n- Bram: "Not the eel."',
    );
    expect(notes?.events).toEqual(['The party entered the keep.', 'They met Ravenshade.']);
    expect(notes?.quotes).toEqual(['Bram: "Not the eel."']);
    expect(notes?.combat).toEqual([]);
  });

  it('forgives bold headings, aliases, numbered bullets and a preamble', () => {
    const notes = parseNotes(
      'Here are the notes.\n\n**NPCs**\n1. Gary the gnome sold a lantern.\n\nSecrets revealed:\n* The cult serves Vecna.',
    );
    expect(notes?.npcs).toEqual(['Gary the gnome sold a lantern.']);
    expect(notes?.secrets).toEqual(['The cult serves Vecna.']);
  });

  it('drops "none" markers and keeps lines under an unknown heading under Events', () => {
    const notes = parseNotes('## Events\n- A thing.\n## Loot\n- None\n## Weather\n- It rained.');
    expect(notes?.loot).toEqual([]);
    expect(notes?.events).toEqual(['A thing.', 'It rained.']);
  });

  it('is unreadable with no headings, no text, or nothing under the headings', () => {
    expect(parseNotes('Alice found a key.')).toBeUndefined();
    expect(parseNotes('')).toBeUndefined();
    expect(parseNotes('## Events\n- None')).toBeUndefined();
  });
});

describe('renderNotes and mergeNotes', () => {
  it('renders in the fixed order and leaves empty sections out', () => {
    const notes = emptyNotes();
    notes.quotes.push('"Hi."');
    notes.events.push('A.');
    expect(renderNotes(notes)).toBe('## Events\n- A.\n\n## Memorable quotes\n- "Hi."');
    expect(parseNotes(renderNotes(notes))).toEqual(notes);
  });

  it('joins pieces section by section and keeps a repeat from the overlap once', () => {
    const a = { ...emptyNotes(), events: ['One.', 'Two.'] };
    const b = { ...emptyNotes(), events: ['two.', 'Three.'], loot: ['A key.'] };
    const merged = mergeNotes([a, b]);
    expect(merged.events).toEqual(['One.', 'Two.', 'Three.']);
    expect(merged.loot).toEqual(['A key.']);
  });
});

describe('takeNotes (Stage 12 D)', () => {
  it('asks the scribe to lay unreadable notes out again before reading the transcript again', async () => {
    const scribe = vi
      .fn<(prompt: string) => Promise<string>>()
      .mockResolvedValueOnce('Alice found a key.') // the reading: no headings
      .mockResolvedValueOnce('## Events\n- Alice found a key.'); // the layout repair
    const result = await takeNotes(scribe, lines(3));
    expect(result.notes).toEqual(['## Events\n- Alice found a key.']);
    expect(result.modelCalls).toBe(2);
    expect(scribe.mock.calls[1]?.[0]).toMatch(/changing only the layout/);
    expect(scribe.mock.calls[1]?.[0]).toContain('Alice found a key.');
  });

  it('reads the transcript again when the layout cannot be repaired', async () => {
    const scribe = vi
      .fn<(prompt: string) => Promise<string>>()
      .mockResolvedValueOnce('nope')
      .mockResolvedValueOnce('still nope')
      .mockResolvedValueOnce('## Events\n- A real reading.');
    const result = await takeNotes(scribe, lines(3));
    expect(result.notes).toEqual(['## Events\n- A real reading.']);
    expect(scribe.mock.calls[2]?.[0]).toContain('line number 0'); // the transcript, not the bad notes
    expect(result.modelCalls).toBe(3);
  });

  it('fails the job rather than settle for notes that cannot be read', async () => {
    const scribe = vi.fn(async () => 'never any headings');
    await expect(takeNotes(scribe, lines(3))).rejects.toThrow(/unreadable after 3 readings/);
    expect(scribe).toHaveBeenCalledTimes(6); // three readings, each with one repair
  });

  it('makes one set of notes of a long transcript', async () => {
    let n = 0;
    const scribe = async (): Promise<string> => `## Events\n- Part event ${(n += 1)}.`;
    const result = await takeNotes(scribe, lines(40), { chunkChars: 600, overlapLines: 1 });
    expect(result.notes).toHaveLength(1);
    expect(result.modelCalls).toBe(n);
    expect(n).toBeGreaterThan(1);
    expect(result.notes[0]).toContain('- Part event 1.');
    expect(result.notes[0]).toContain(`- Part event ${n}.`);
  });

  it('shortens notes that run past the size limit, and stops when the model cannot', async () => {
    const long = Array.from({ length: 700 }, (_, i) => `Event ${i} with five more words.`);
    let condensed = 0;
    const scribe = async (prompt: string): Promise<string> => {
      if (prompt.startsWith('You are the scribe')) return `## Events\n- ${long.join('\n- ')}`;
      condensed += 1;
      return '## Events\n- The short version.';
    };
    const result = await takeNotes(scribe, lines(3));
    expect(condensed).toBe(1);
    expect(result.notes).toEqual(['## Events\n- The short version.']);

    const stubborn = async (prompt: string): Promise<string> =>
      prompt.startsWith('You are the scribe')
        ? `## Events\n- ${long.join('\n- ')}`
        : `## Events\n- ${long.join('\n- ')}`;
    const kept = await takeNotes(stubborn, lines(3));
    expect(notesWords(parseNotes(kept.notes[0]!)!)).toBeGreaterThan(NOTES_MAX_WORDS); // gave up, kept the full notes
  });
});
