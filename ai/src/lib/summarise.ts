import {
  DEFAULT_CHUNK_CHARS,
  DEFAULT_CHUNK_OVERLAP_LINES,
  MAX_REDUCE_DEPTH,
} from '../consts/index.js';
import type { GenerateText, SummaryContext, SummaryKind, Utterance } from '../types/index.js';
import { chunkLines } from './chunk.js';
import { formatTranscript } from './format.js';
import { buildChunkPrompt, buildReducePrompt, buildSinglePrompt } from './prompts.js';

/** Greedily packs whole notes into groups of at most `maxChars`; an oversize note stands alone. */
export function groupByBudget(notes: readonly string[], maxChars: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const note of notes) {
    if (current.length > 0 && size + note.length > maxChars) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(note);
    size += note.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export interface SummariseOptions {
  kind: SummaryKind;
  context?: SummaryContext;
  chunkChars?: number;
  overlapLines?: number;
}

export interface SummaryResult {
  kind: SummaryKind;
  text: string;
  /** Carried through to the API: a DM-only summary must never be served to players. */
  dmOnly: boolean;
  /** Model calls made, for the job log and for sizing. */
  modelCalls: number;
}

/**
 * Summarises a merged transcript with any text-generation function (Ollama by default).
 *
 * Short sessions are one call. Long ones are map-reduce: summarise overlapping chunks, then
 * combine the notes, combining again if the notes themselves are still too long. A 4–8 hour
 * session is far past one context window, so this is the normal path, not the edge case.
 */
export async function summarise(
  generate: GenerateText,
  utterances: readonly Utterance[],
  options: SummariseOptions,
): Promise<SummaryResult> {
  const context = options.context ?? {};
  const chunkChars = options.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const overlap = options.overlapLines ?? DEFAULT_CHUNK_OVERLAP_LINES;
  let modelCalls = 0;
  const call = async (prompt: string): Promise<string> => {
    modelCalls += 1;
    return (await generate(prompt)).trim();
  };

  if (utterances.length === 0) {
    throw new Error('nothing to summarise: the transcript is empty');
  }

  const lines = formatTranscript(utterances);
  const chunks = chunkLines(lines, chunkChars, overlap);
  const result = (text: string): SummaryResult => ({
    kind: options.kind,
    text,
    dmOnly: options.kind === 'dm-only',
    modelCalls,
  });

  const [onlyChunk] = chunks;
  if (chunks.length === 1 && onlyChunk !== undefined) {
    return result(await call(buildSinglePrompt(options.kind, onlyChunk, context)));
  }

  let notes: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    notes.push(await call(buildChunkPrompt(options.kind, chunk, index, chunks.length, context)));
  }

  for (let depth = 0; depth < MAX_REDUCE_DEPTH; depth += 1) {
    const joined = notes.join('\n\n');
    if (joined.length <= chunkChars) break;
    // Combine groups of notes that each fit, then go round again on the shorter result.
    const combined: string[] = [];
    for (const group of groupByBudget(notes, chunkChars)) {
      combined.push(await call(buildReducePrompt(options.kind, group, context, false)));
    }
    notes = combined;
  }

  return result(await call(buildReducePrompt(options.kind, notes, context, true)));
}
