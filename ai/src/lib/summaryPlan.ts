import type {
  RecordingEvent,
  SummaryContext,
  SummaryKind,
  SummaryVisibility,
  Utterance,
} from '../types/index.js';

/** One summary a processed recording gets: what it covers, who may read it, and what the model reads. */
export interface PlannedSummary {
  kind: SummaryKind;
  /** The character for `character`, the chapter number for `chapter`; empty otherwise. */
  subject: string;
  visibility: SummaryVisibility;
  utterances: Utterance[];
  context: SummaryContext;
}

export interface PlanInput {
  /** Spoken and typed lines, merged, on the recording's clock. */
  utterances: readonly Utterance[];
  /** The recording's bookmarks (started / paused / resumed / stopped …). */
  events: readonly RecordingEvent[];
  startedAt: number;
  /** Account ids of the campaign's players (everyone but the DM): who gets a character summary. */
  playerIds: ReadonlySet<string>;
  campaignName?: string;
}

/**
 * Where each chapter begins, in ms from the start of the recording. A chapter is a stretch of recording
 * between pauses (decided 2026-11-05: start / pause / resume / stop are the session's bookmarks), so the
 * first starts at 0 and every `resumed` starts another. Lines typed during a pause belong to the chapter
 * before it.
 */
export function chapterStarts(events: readonly RecordingEvent[], startedAt: number): number[] {
  const starts = [0];
  for (const e of events) {
    if (e.event === 'resumed') starts.push(Math.max(0, e.at - startedAt));
  }
  return starts;
}

/**
 * Every summary a recording gets (CLAUDE.md §8.4): the session summary and the DM-only one; a chapter
 * summary for each part when the recording was paused at least once; and a character summary for each
 * player who spoke or typed, under the name the transcript shows for them (their active character, else
 * their display name). Pure: the handler stores what this plans.
 */
export function planSummaries(input: PlanInput): PlannedSummary[] {
  const { utterances } = input;
  // Whoever spoke and is not a player is the Game Master (the DM's character is suspended while DM).
  const gm = utterances.find((u) => !input.playerIds.has(u.speaker.id))?.speaker.name;
  const base: SummaryContext = {
    ...(input.campaignName ? { campaignName: input.campaignName } : {}),
    ...(gm ? { gameMaster: gm } : {}),
  };
  const plan: PlannedSummary[] = [
    {
      kind: 'session',
      subject: '',
      visibility: 'members',
      utterances: [...utterances],
      context: base,
    },
    { kind: 'dm-only', subject: '', visibility: 'dm', utterances: [...utterances], context: base },
  ];
  if (utterances.length === 0) return plan;

  const starts = chapterStarts(input.events, input.startedAt);
  if (starts.length > 1) {
    for (const [i, start] of starts.entries()) {
      const end = starts[i + 1] ?? Number.POSITIVE_INFINITY;
      const part = utterances.filter((u) => u.startMs >= start && u.startMs < end);
      if (part.length === 0) continue;
      plan.push({
        kind: 'chapter',
        subject: String(i + 1),
        visibility: 'members',
        utterances: part,
        context: { ...base, chapter: { number: i + 1, of: starts.length } },
      });
    }
  }

  // The name a player is shown under, latest wins (a mid-session character switch shows the new one).
  const names = new Map<string, string>();
  for (const u of utterances) {
    if (input.playerIds.has(u.speaker.id)) names.set(u.speaker.id, u.speaker.name);
  }
  const seen = new Set<string>();
  for (const name of names.values()) {
    if (seen.has(name)) continue; // two players under one name share one summary (the subject is unique)
    seen.add(name);
    plan.push({
      kind: 'character',
      subject: name,
      visibility: 'members',
      utterances: [...utterances],
      context: { ...base, characterName: name },
    });
  }
  return plan;
}
