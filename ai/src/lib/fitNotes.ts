import {
  CONDENSE_THRESHOLD,
  DEFAULT_CHUNK_CHARS,
  FIT_TARGET_SHARE,
  MAX_REDUCE_DEPTH,
} from '../consts/index.js';
import type { SummaryContext } from '../types/index.js';
import { buildCondensePrompt } from './prompts.js';
import { estimateTokens } from './tokenBudget.js';

/**
 * The notes of a whole session, cut down to a recap that fits the model's window, whatever the length of the session.
 *
 * A summary is the bits a table remembers (the key events, the big wins and fumbles, the funny moments), not everything that
 * was said, so it is right to cut hard here. The model is asked for a recap with a **word limit**; a model that writes too
 * much is told once; and if it still does, the text is clipped to the limit by code, so the result always fits and a prompt
 * is never sent that the model must refuse (0.6.4: the shortening call kept returning about what it was given, and the
 * final call failed an hour in, three times).
 */
export interface FitOptions {
  context?: SummaryContext;
  /** The model's real window in tokens (`contextWindowTokens`). */
  window: number;
  /** The most characters one shortening call is given. */
  chunkChars?: number;
}

export interface FitResult {
  notes: string[];
  modelCalls: number;
}

/** About 6 characters to a word, spaces and punctuation included; the same 3.5 chars a token as `estimateTokens`. */
const CHARS_PER_TOKEN = 3.5;
const CHARS_PER_WORD = 6;

export const wordCount = (text: string): number => text.split(/\s+/).filter((w) => w !== '').length;

/**
 * Thins `text` to at most `limit` words: headings are kept, and the other lines are dropped evenly from start to end, so
 * the ending survives as well as the beginning.
 */
export function clipToWords(text: string, limit: number): string {
  const total = wordCount(text);
  if (total <= limit) return text;
  const lines = text.split('\n');
  const isHeading = (l: string) => /^\s*#{1,6}\s/.test(l);
  const body = lines.filter((l) => !isHeading(l) && l.trim() !== '');
  const headingWords = lines.filter(isHeading).reduce((n, l) => n + wordCount(l), 0);
  const room = Math.max(0, limit - headingWords);
  const bodyWords = body.reduce((n, l) => n + wordCount(l), 0);
  const keepRatio = bodyWords === 0 ? 0 : room / bodyWords;
  let seen = 0;
  let kept = 0;
  const result: string[] = [];
  let used = headingWords;
  for (const line of lines) {
    if (isHeading(line)) {
      result.push(line);
      continue;
    }
    if (line.trim() === '') continue;
    seen += 1;
    // Even sampling, starting with the first line: keep one each time the running share passes a whole number.
    if (Math.ceil(seen * keepRatio - 1e-9) > kept) {
      const w = wordCount(line);
      if (used + w <= limit) {
        kept += 1;
        used += w;
        result.push(line);
      }
    }
  }
  return result.join('\n');
}

/** The server gave up on a model that was repeating itself: a fault of this text and this call, not of the connection. */
const isRepeatAbort = (e: unknown): boolean =>
  /repeat limit|prediction aborted/i.test(e instanceof Error ? e.message : String(e));

const words = (notes: readonly string[]): number => notes.reduce((n, t) => n + wordCount(t), 0);

export async function fitNotes(
  scribe: (prompt: string) => Promise<string>,
  taken: readonly string[],
  options: FitOptions,
): Promise<FitResult> {
  const { window } = options;
  const context = options.context ?? {};
  const chunkChars = options.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const fits = (n: readonly string[], share: number) =>
    estimateTokens(n.join('\n\n')) <= window * share;
  if (fits(taken, CONDENSE_THRESHOLD)) return { notes: [...taken], modelCalls: 0 };

  const targetWords = Math.floor((window * FIT_TARGET_SHARE * CHARS_PER_TOKEN) / CHARS_PER_WORD);
  let modelCalls = 0;
  const call = async (prompt: string): Promise<string> => {
    modelCalls += 1;
    return scribe(prompt);
  };

  /** One group shortened to about `limit` words: asked, told once if it wrote too much, then clipped. */
  const shorten = async (group: string[], limit: number): Promise<string> => {
    // A model that aborts on this text (Ollama: "token repeat limit reached") is tried once more, then the group is
    // clipped by code. Any other failure, such as a server that cannot be reached, is not ours to hide.
    let first: string;
    try {
      first = await call(buildCondensePrompt(group, context, limit));
    } catch (e) {
      if (!isRepeatAbort(e)) throw e;
      try {
        first = await call(buildCondensePrompt(group, context, limit));
      } catch (again) {
        if (!isRepeatAbort(again)) throw again;
        return clipToWords(group.join('\n\n'), limit);
      }
    }
    if (wordCount(first) <= limit * 1.25) return first;
    const second = await call(buildCondensePrompt(group, context, limit, wordCount(first)));
    return wordCount(second) <= limit * 1.25 ? second : clipToWords(second, limit);
  };

  let current = [...taken];
  for (let round = 0; round < MAX_REDUCE_DEPTH && !fits(current, FIT_TARGET_SHARE); round += 1) {
    const total = words(current);
    const ratio = Math.min(0.8, Math.max(0.25, targetWords / total));
    const next: string[] = [];
    for (const group of groupNotes(current, chunkChars)) {
      next.push(await shorten(group, Math.max(40, Math.round(words(group) * ratio))));
    }
    current = next;
  }
  // The guarantee: whatever the model did, what goes on fits.
  if (!fits(current, CONDENSE_THRESHOLD)) {
    const share = targetWords / Math.max(1, words(current));
    current = current.map((n) => clipToWords(n, Math.max(40, Math.floor(wordCount(n) * share))));
  }
  return { notes: current, modelCalls };
}

/** Packs whole notes into groups of at most `maxChars`; an oversize note stands alone. */
function groupNotes(notes: readonly string[], maxChars: number): string[][] {
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
