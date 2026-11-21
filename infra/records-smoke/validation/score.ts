// Scoring a live run: turn what the server produced into numbers and findings, against the fixtures' ground truth.
// Pure functions over text (score.test.ts). Thresholds are not set here: a score is reported, a leak is a failure.

import { wordAccuracy } from '../e2e/score.ts';
import type { Callback, Fact } from '../campaign-fixture.ts';

export type ArtifactKind =
  | 'transcript'
  | 'notes'
  | 'tale'
  | 'brief'
  | 'chapter'
  | 'character'
  | 'memory'
  | 'search'
  | 'export'
  | 'other';

export interface Artifact {
  name: string;
  kind: ArtifactKind;
  session?: number;
  /** Who may read it: a leak into `shared` text is what a canary looks for. */
  text: string;
}

const re = (p: string) => new RegExp(p, 'i');
const wordRe = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

export interface FactScore {
  id: string;
  importance: string;
  found: boolean;
}

/** A fact is found when every one of its patterns matches the text. */
export function scoreFacts(facts: readonly Fact[], text: string): FactScore[] {
  return facts.map((f) => ({
    id: f.id,
    importance: f.importance,
    found: f.all.every((p) => re(p).test(text)),
  }));
}

export const recall = (
  scores: readonly FactScore[],
  importance?: string,
): { found: number; total: number } => {
  const s = importance ? scores.filter((x) => x.importance === importance) : scores;
  return { found: s.filter((x) => x.found).length, total: s.length };
};

export interface Leak {
  word: string;
  where: string;
}

/** Every artifact in which a canary word appears. An empty list is the pass. */
export function scoreCanaries(words: readonly string[], artifacts: readonly Artifact[]): Leak[] {
  const leaks: Leak[] = [];
  for (const w of words)
    for (const a of artifacts) if (wordRe(w).test(a.text)) leaks.push({ word: w, where: a.name });
  return leaks;
}

const countOf = (text: string, term: string): number =>
  (text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) ?? []).length;

export interface GlossaryScore {
  term: string;
  expected: number;
  exact: number;
  /** Alias forms found instead (what Whisper wrote), with counts: the list to add to the glossary. */
  heard: Record<string, number>;
  accuracy: number;
}

/** How often each glossary term was said (in the script) against how often it came out right (in the transcript). */
export function scoreGlossary(
  terms: readonly { term: string; aliases: string[] }[],
  spokenScript: string,
  transcript: string,
): GlossaryScore[] {
  const out: GlossaryScore[] = [];
  for (const g of terms) {
    const expected = countOf(spokenScript, g.term);
    if (expected === 0) continue;
    const exact = countOf(transcript, g.term);
    const heard: Record<string, number> = {};
    for (const a of g.aliases) {
      const n = countOf(transcript, a);
      if (n > 0) heard[a] = n;
    }
    out.push({ term: g.term, expected, exact, heard, accuracy: Math.min(1, exact / expected) });
  }
  return out;
}

export const meanAccuracy = (s: readonly GlossaryScore[]): number | undefined =>
  s.length === 0
    ? undefined
    : s.reduce((a, x) => a + x.expected * x.accuracy, 0) / s.reduce((a, x) => a + x.expected, 0);

/** Word accuracy for each speaker: what their script said while recorded against what the transcript has under their name. */
export function speakerAccuracy(
  script: Record<string, string>,
  transcript: Record<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [who, said] of Object.entries(script))
    if (said.trim()) out[who] = wordAccuracy(said, transcript[who] ?? '');
  return out;
}

export interface CallbackScore {
  id: string;
  memory: boolean;
  weave: boolean | undefined;
}

/**
 * `memoryAfter[n]` is the campaign memory's text after session n's job; `outputs` are the session artifacts.
 * A callback's memory check looks at the session it names; its weave check looks at the tale and brief of the
 * session it names (judged by pattern here, then by a person reading).
 */
export function scoreCallbacks(
  callbacks: readonly Callback[],
  memoryAfter: Readonly<Record<number, string>>,
  outputs: readonly Artifact[],
): CallbackScore[] {
  return callbacks.map((cb) => {
    const memText = memoryAfter[cb.memory.after];
    const wanted = new Set(cb.weave.outputs);
    const woven = outputs.filter((o) => o.session === cb.weave.session && wanted.has(o.kind));
    return {
      id: cb.id,
      memory: memText === undefined ? false : re(cb.memory.pattern).test(memText),
      weave: woven.length === 0 ? undefined : woven.some((o) => re(cb.weave.pattern).test(o.text)),
    };
  });
}

/** The two-Tobiases trap: two different entries, never one merged line holding both surnames. */
export function tobiasesKeptApart(memoryText: string): { apart: boolean; detail: string } {
  const lines = memoryText.split('\n');
  const q = lines.filter((l) => /quillfeather/i.test(l));
  const w = lines.filter((l) => /\bwick\b/i.test(l));
  const merged = lines.some((l) => /quillfeather/i.test(l) && /\bwick\b/i.test(l));
  return {
    apart: q.length > 0 && w.length > 0 && !merged,
    detail: `${q.length} line(s) for Quillfeather, ${w.length} for Wick${merged ? ', and one line holds both' : ''}`,
  };
}
