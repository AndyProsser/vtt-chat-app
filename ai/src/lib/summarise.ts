import {
  CONDENSE_THRESHOLD,
  DEFAULT_CHUNK_CHARS,
  DEFAULT_CHUNK_OVERLAP_LINES,
  MAX_REDUCE_DEPTH,
  NOTES_READ_ATTEMPTS,
} from '../consts/index.js';
import type { AiSettings } from '@vtt-chat-app/shared';
import type { GenerateText, SummaryContext, SummaryKind, Utterance } from '../types/index.js';
import { chunkLines } from './chunk.js';
import type { StructuredNotes } from './notes.js';
import { formatTimeline } from './format.js';
import { mergeNotes, NOTES_MAX_WORDS, notesWords, parseNotes, renderNotes } from './notes.js';
import { contextWindowTokens, estimateTokens } from './tokenBudget.js';
import {
  buildChroniclerPrompt,
  buildCondensePrompt,
  buildNotesPrompt,
  buildNotesRepairPrompt,
  buildStoryPrompt,
} from './prompts.js';

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

/**
 * Removes a reasoning model's `<think>…</think>` preamble, which some servers return inside the answer
 * (an OpenAI-compatible endpoint, or Ollama without `think: false`). Only the summary is stored.
 */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}

/**
 * The two roles a summary needs (prompts.ts). They may be one model or two: the scribe wants a model that
 * sticks to the text, the bard one that writes well. A plain `GenerateText` is used for both.
 */
/** A bard with nothing left unresolved sometimes still writes the closing "Next time:" and stops; drop the stub. */
export function tidyTale(text: string): string {
  return text.replace(/\n+\s*\**Next time:?\**:?\s*$/i, '').trim();
}

export interface SummaryModels {
  /** Takes the notes, shortens them when they outgrow one call, and writes the Game Master's brief. */
  scribe: GenerateText;
  /** Tells the tale from the notes. */
  bard: GenerateText;
}

const asModels = (models: GenerateText | SummaryModels): SummaryModels =>
  typeof models === 'function' ? { scribe: models, bard: models } : models;

export interface NotesOptions {
  context?: SummaryContext;
  chunkChars?: number;
  overlapLines?: number;
  /**
   * The word count this stretch's notes are condensed toward (default `NOTES_MAX_WORDS`). A chaptered
   * session takes its notes one chapter at a time and simply concatenates them (`processRecording.ts`),
   * so the caller lowers this per chapter (roughly `NOTES_MAX_WORDS / chapter count`) to keep the whole
   * session's stored notes near the cap instead of every chapter reaching it on its own.
   */
  maxWords?: number;
  /**
   * The backend `writeFromNotes`'s condense loop checks its token estimate against (`contextWindowTokens`).
   * Omitted only by callers that have not been updated to pass it yet; `contextWindowTokens` itself already
   * falls back to the measured local default when a caller passes `{ kind: 'local', context: null }` or
   * equivalent, so this field's own absence is a second, separate fallback for an even older caller.
   */
  llm?: AiSettings['llm'];
}

export interface Notes {
  /** One block of notes per piece of the transcript, in order. */
  notes: string[];
  modelCalls: number;
}

export interface SummariseOptions extends NotesOptions {
  kind: SummaryKind;
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
 * Pass one: the scribe reads the transcript, piece by piece, and writes down what happened. A 4 to 8 hour
 * session is far past one context window, so several pieces is the normal case, not the edge case.
 *
 * Done **once per stretch of recording** and shared by every summary of it (the tale, each character's tale,
 * the Game Master's brief). Before 0.5.2 each summary re-read the whole transcript: about eight full readings
 * for a five-player session, where this is one.
 */
export async function takeNotes(
  scribe: GenerateText,
  utterances: readonly Utterance[],
  options: NotesOptions = {},
): Promise<Notes> {
  if (utterances.length === 0) {
    throw new Error('nothing to summarise: the transcript is empty');
  }
  const context = options.context ?? {};
  const lines = formatTimeline(utterances, context.cues);
  const chunks = chunkLines(
    lines,
    options.chunkChars ?? DEFAULT_CHUNK_CHARS,
    options.overlapLines ?? DEFAULT_CHUNK_OVERLAP_LINES,
  );
  let modelCalls = 0;
  const ask = async (prompt: string): Promise<string> => {
    modelCalls += 1;
    return stripThinking(await scribe(prompt));
  };
  const read = async (prompt: string): Promise<StructuredNotes | undefined> => {
    const answer = await ask(prompt);
    const parsed = parseNotes(answer);
    if (parsed) return parsed;
    // Not readable: first ask for the same notes laid out properly, which is cheap.
    return parseNotes(await ask(buildNotesRepairPrompt(answer)));
  };

  const pieces: StructuredNotes[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const prompt = buildNotesPrompt(chunk, index, chunks.length, context);
    let parsed: StructuredNotes | undefined;
    // Still not readable: read the transcript again. Never a weaker fallback (decision 7): the job fails and retries.
    for (let attempt = 0; attempt < NOTES_READ_ATTEMPTS && !parsed; attempt += 1) {
      parsed = await read(prompt);
    }
    if (!parsed) {
      throw new Error(
        `the scribe's notes for part ${index + 1} of ${chunks.length} were unreadable after ${NOTES_READ_ATTEMPTS} readings`,
      );
    }
    pieces.push(parsed);
  }

  // One set of notes for the stretch (a repeat from the overlap once), kept to about the cap.
  // Word-based, not token-based like writeFromNotes's condense loop below: this is a stable, cheap length
  // target set once per chapter (today's per-chapter cap sharing), not the real fit-in-window decision
  // taken right before a single model call — that one has to compare against the real window, this one
  // doesn't.
  const cap = options.maxWords ?? NOTES_MAX_WORDS;
  let merged = mergeNotes(pieces);
  for (let round = 0; round < MAX_REDUCE_DEPTH && notesWords(merged) > cap; round += 1) {
    const shorter = await read(buildCondensePrompt([renderNotes(merged)], context));
    if (!shorter || notesWords(shorter) >= notesWords(merged)) break;
    merged = shorter;
  }
  return { notes: [renderNotes(merged)], modelCalls };
}

/**
 * Pass two: one summary written from the notes. The bard tells the tale (session, chapter, character); the
 * scribe writes the Game Master's brief. Notes too long for one call are shortened first, round by round.
 */
export async function writeFromNotes(
  models: GenerateText | SummaryModels,
  taken: readonly string[],
  options: SummariseOptions,
): Promise<SummaryResult> {
  const { scribe, bard } = asModels(models);
  const context = options.context ?? {};
  const chunkChars = options.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const window = contextWindowTokens(
    options.llm ?? { kind: 'local', url: null, model: null, priceIn: null, priceOut: null, context: null },
  );
  let modelCalls = 0;
  const call = async (model: GenerateText, prompt: string): Promise<string> => {
    modelCalls += 1;
    return stripThinking(await model(prompt));
  };

  let notes = [...taken];
  for (let depth = 0; depth < MAX_REDUCE_DEPTH; depth += 1) {
    if (estimateTokens(notes.join('\n\n')) <= window * CONDENSE_THRESHOLD) break;
    // Shorten groups of notes that each fit, then go round again on the shorter result.
    const shorter: string[] = [];
    for (const group of groupByBudget(notes, chunkChars)) {
      shorter.push(await call(scribe, buildCondensePrompt(group, context)));
    }
    notes = shorter;
  }

  const text =
    options.kind === 'dm-only'
      ? await call(scribe, buildChroniclerPrompt(notes, context))
      : tidyTale(await call(bard, buildStoryPrompt(options.kind, notes, context)));
  return { kind: options.kind, text, dmOnly: options.kind === 'dm-only', modelCalls };
}

/** Both passes for one summary: notes, then the summary. The records job shares the notes instead (see `takeNotes`). */
export async function summarise(
  models: GenerateText | SummaryModels,
  utterances: readonly Utterance[],
  options: SummariseOptions,
): Promise<SummaryResult> {
  const taken = await takeNotes(asModels(models).scribe, utterances, options);
  const result = await writeFromNotes(models, taken.notes, options);
  return { ...result, modelCalls: result.modelCalls + taken.modelCalls };
}
