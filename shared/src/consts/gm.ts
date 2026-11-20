/**
 * The Game Master's notes and the campaign glossary (Stage 11 items 5 and 6). Both are the Game Master's alone at
 * the API. The notes are one freeform Markdown page per campaign with picture and PDF attachments; the glossary is
 * the vocabulary a campaign uses (names, places, items, spells), which transcription will be told about in Stage 12.
 */

/** Characters of Markdown in the notes page: generous on purpose ("no real limits"), a ceiling only so one save cannot fill the database. */
export const GM_NOTES_BODY_MAX = 2_000_000;

/** What the notes page starts with, to prompt a novice (the content stays unstructured; delete any of it). */
export const GM_NOTES_STARTER = `# Notes

## The story so far

## Secrets

## Non-player characters

## Places

## To prepare
`;

export const GLOSSARY_KINDS = ['person', 'place', 'item', 'spell', 'other'] as const;
export type GlossaryKind = (typeof GLOSSARY_KINDS)[number];

export const GLOSSARY_KIND_LABELS: Record<GlossaryKind, string> = {
  person: 'Person',
  place: 'Place',
  item: 'Item',
  spell: 'Spell',
  other: 'Other',
};

export type GlossaryStatus = 'approved' | 'suggested';

export const GLOSSARY_TERM_MAX = 100;
export const GLOSSARY_ALIASES_MAX = 10;
/** Terms per campaign; a campaign's own vocabulary is a few hundred at the most. */
export const GLOSSARY_TERMS_MAX = 2000;

export const isGlossaryKind = (value: unknown): value is GlossaryKind =>
  typeof value === 'string' && (GLOSSARY_KINDS as readonly string[]).includes(value);
