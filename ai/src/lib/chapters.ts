import type { RecordingEvent, Utterance } from '../types/index.js';

/** A chapter with less speech than this, begun by a scene change, folds into the one before it. */
export const MIN_SCENE_CHAPTER_MS = 60_000;

export interface Chapter {
  number: number;
  startMs: number;
  /** `Infinity` for the last one. */
  endMs: number;
  /** The scene running when the chapter began, if the DM had one. */
  title?: string;
}

export interface ChapterInput {
  events: readonly RecordingEvent[];
  startedAt: number;
  utterances: readonly Utterance[];
  /** Override for tests. */
  minSceneChapterMs?: number;
}

interface Boundary {
  at: number;
  reason: 'start' | 'pause' | 'scene';
  scene: string | undefined;
}

/**
 * Where each chapter of a recording begins. Two things start one:
 * - **a pause** (every `resumed`; start / pause / resume / stop are the session's bookmarks, 2026-11-05), always;
 * - **a scene change** (the DM starting a scene), but only when the new chapter holds at least
 *   `MIN_SCENE_CHAPTER_MS` of speech, so a DM flipping through scenes does not leave dozens of tiny
 *   chapters. A short scene chapter folds into the one before it; the scene still shows as a cue inside it.
 *
 * A chapter's title is the scene running when it began (cleared when the scene ends). Chapters are numbered
 * in time order. The worker and the API both call this, so they number and title them identically. Pure.
 */
export function planChapters(input: ChapterInput): Chapter[] {
  const min = input.minSceneChapterMs ?? MIN_SCENE_CHAPTER_MS;
  const bounds: Boundary[] = [{ at: 0, reason: 'start', scene: undefined }];
  let scene: string | undefined;
  for (const e of [...input.events].sort((a, b) => a.at - b.at)) {
    const at = Math.max(0, e.at - input.startedAt);
    if (e.event === 'scene' && e.detail?.action === 'start' && typeof e.detail.name === 'string') {
      scene = e.detail.name;
      bounds.push({ at, reason: 'scene', scene });
    } else if (e.event === 'scene' && e.detail?.action === 'stop') {
      scene = undefined;
    } else if (e.event === 'resumed') {
      bounds.push({ at, reason: 'pause', scene });
    }
  }
  // A scene the DM opened with, at the very start, titles the first chapter instead of splitting it.
  const second = bounds[1];
  if (second?.reason === 'scene' && second.at === 0) {
    bounds[0] = { at: 0, reason: 'start', scene: second.scene };
    bounds.splice(1, 1);
  }

  const speechIn = (from: number, to: number) =>
    input.utterances
      .filter((u) => !u.typed && u.startMs >= from && u.startMs < to)
      .reduce((sum, u) => sum + Math.max(0, u.endMs - u.startMs), 0);

  // Fold short scene chapters left to right: dropping one only lengthens the chapter before it.
  const kept = bounds.filter((b, i) => {
    if (b.reason !== 'scene') return true;
    return speechIn(b.at, bounds[i + 1]?.at ?? Number.POSITIVE_INFINITY) >= min;
  });
  return kept.map((b, i) => ({
    number: i + 1,
    startMs: b.at,
    endMs: kept[i + 1]?.at ?? Number.POSITIVE_INFINITY,
    ...(b.scene ? { title: b.scene } : {}),
  }));
}
