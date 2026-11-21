// The reading pack: one Markdown file made from a finished run's outputs, for a person to read. It keeps apart what a
// player reads (the tale, and the chapters and heroes folded under it) and what only the Game Master reads (the
// Chronicler's brief, which is where the hooks are, and the scribe's notes), and shows the campaign memory after each
// session and which of the planted callbacks the memory and the later tales picked up. The scores stay in report.md.

import { splitTaleTitle } from '@vtt-chat-app/shared';

export interface SummaryBlock {
  kind: string;
  subject: string;
  visibility: string;
  text: string;
}

/** Parses `outputs/session-N-summaries.md`: `## kind: subject (visibility)` headings, each followed by the text. */
export function parseSummaries(md: string): SummaryBlock[] {
  const out: SummaryBlock[] = [];
  const head = /^## ([a-z-]+)(?:: (.*?))? \((members|dm)\)\s*$/;
  let cur: { kind: string; subject: string; visibility: string; lines: string[] } | undefined;
  for (const line of md.split('\n')) {
    const m = head.exec(line);
    if (m) {
      if (cur)
        out.push({
          kind: cur.kind,
          subject: cur.subject,
          visibility: cur.visibility,
          text: cur.lines.join('\n').trim(),
        });
      cur = { kind: m[1] as string, subject: m[2] ?? '', visibility: m[3] as string, lines: [] };
    } else cur?.lines.push(line);
  }
  if (cur)
    out.push({
      kind: cur.kind,
      subject: cur.subject,
      visibility: cur.visibility,
      text: cur.lines.join('\n').trim(),
    });
  return out;
}

export interface CallbackResult {
  id: string;
  memory: boolean;
  weave: boolean | undefined;
}

export interface SessionInput {
  n: number;
  title: string;
  summaries: SummaryBlock[];
  memory: string;
  scores: { name: string; value: string; detail?: string }[];
}

const words = (t: string): number => t.split(/\s+/).filter(Boolean).length;
const mark = (v: boolean | undefined): string => (v === undefined ? '–' : v ? '✔' : '✖');

export function buildPack(input: {
  label: string;
  sessions: SessionInput[];
  callbacks: CallbackResult[];
  callbackText: Record<string, string>;
}): string {
  const L: string[] = [];
  L.push(`# Reading pack: ${input.label}`, '');
  L.push(
    "Made from the run's outputs, to read. **What a player reads** is the tale (with its chapters and heroes folded away); **what only the Game Master reads** is the Chronicler's brief, which is where the hooks are, and the scribe's notes. The scores are in `report.md`.",
    '',
  );
  L.push('## Did the story thread across sessions?', '');
  L.push(
    '| Planted link | In memory when it should be | Connected back in the later tale or brief |',
    '| --- | --- | --- |',
  );
  for (const c of input.callbacks)
    L.push(`| ${input.callbackText[c.id] ?? c.id} | ${mark(c.memory)} | ${mark(c.weave)} |`);
  L.push(
    '',
    '✔ found by the pattern, ✖ not found, – nothing to judge yet. A pattern cannot judge a connection: **read the tales below**, then decide.',
    '',
  );
  for (const s of input.sessions) {
    L.push(`## Session ${s.n}: ${s.title}`, '');
    const tales = s.summaries.filter((x) => x.kind === 'session');
    const chapters = s.summaries.filter((x) => x.kind === 'chapter');
    const heroes = s.summaries.filter((x) => x.kind === 'character');
    const brief = s.summaries.filter((x) => x.kind === 'dm-only');
    const notes = s.summaries.filter((x) => x.kind === 'notes');
    L.push('### What a player reads', '');
    if (tales.length === 0) L.push('_No tale was written._', '');
    for (const t of tales) {
      const { title, body } = splitTaleTitle(t.text);
      L.push(`#### ${title ?? 'The tale'} (${words(body)} words)`, '', body, '');
    }
    if (chapters.length + heroes.length > 0) {
      L.push(
        `<details><summary>More detail: ${chapters.length} chapters, ${heroes.length} heroes</summary>`,
        '',
      );
      for (const x of [...chapters, ...heroes])
        L.push(
          `**${x.kind === 'chapter' ? 'Chapter' : 'Hero'}: ${x.subject}** (${words(x.text)} words)`,
          '',
          x.text,
          '',
        );
      L.push('</details>', '');
    }
    L.push('### What only the Game Master reads', '');
    if (brief.length === 0) L.push('_No brief was written._', '');
    for (const b of brief)
      L.push(`#### The Chronicler's brief (${words(b.text)} words)`, '', b.text, '');
    for (const n of notes)
      L.push(
        `<details><summary>The scribe's notes (${words(n.text)} words)</summary>`,
        '',
        n.text,
        '',
        '</details>',
        '',
      );
    L.push(
      `### Campaign memory after session ${s.n}`,
      '',
      '```text',
      s.memory.trim() || '(nothing)',
      '```',
      '',
    );
    if (s.scores.length) {
      L.push(
        `### Scores for session ${s.n}`,
        '',
        '| Score | Value | Detail |',
        '| --- | --- | --- |',
      );
      for (const x of s.scores)
        L.push(`| ${x.name} | ${x.value} | ${(x.detail ?? '').replace(/\|/g, '\\|')} |`);
      L.push('');
    }
  }
  return L.join('\n');
}
