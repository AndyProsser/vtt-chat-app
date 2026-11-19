/**
 * The records API's vocabulary, in one place (Stage 11 item 8, the tidy-up of what 0.5.2 added without a bump):
 * the kinds of summary a recording has and who may read each. The server enforces this at the API
 * (`recordsRoutes.ts`); the desktop and phone apps only use it for labels and order. See
 * docs/architecture/RECORDING-AND-SUMMARIES.md "Access & retention".
 */

/** In the order they are listed: the tale first, the Game Master's working material last. */
export const SUMMARY_KINDS = ['session', 'chapter', 'character', 'dm-only', 'notes'] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];

/** `members` is every player of the campaign and the Game Master; `dm` is the Game Master alone. */
export type SummaryVisibility = 'members' | 'dm';

/** The kinds only the Game Master reads: their brief and the scribe's notes. Everything else is a tale. */
export const DM_ONLY_SUMMARY_KINDS: readonly SummaryKind[] = ['dm-only', 'notes'];

export const SUMMARY_LABELS: Record<SummaryKind, string> = {
  session: 'The tale',
  chapter: 'Chapter',
  character: 'Hero',
  'dm-only': 'DM brief',
  notes: 'Scribe’s notes',
};

/** The heading for a summary of this kind; a kind this build does not know is shown as it is. */
export const summaryLabel = (kind: string): string =>
  (SUMMARY_LABELS as Record<string, string>)[kind] ?? kind;

/** Where in the list a kind goes: known kinds in `SUMMARY_KINDS` order, unknown ones after them. */
export const summaryRank = (kind: string): number => {
  const i = (SUMMARY_KINDS as readonly string[]).indexOf(kind);
  return i === -1 ? SUMMARY_KINDS.length : i;
};

/** Whether a viewer may read a summary of this visibility. */
export const canReadSummary = (visibility: SummaryVisibility, isDm: boolean): boolean =>
  visibility === 'members' || isDm;
