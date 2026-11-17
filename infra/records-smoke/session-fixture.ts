// The written test session (fixtures/session-vault.txt) as a transcript, and a recall score for notes
// written from it. The spoken two-minute scene is too short to tell summary models apart; this is about
// 12 minutes of speech with a throwaway NPC, a deadline, a secret and table chatter.
//
//   node infra/records-smoke/session-fixture.ts transcript <out.json>
//       writes the transcript (the Game Master's speaker id is "gm": pass --gm gm to llm-bench.ts)
//   node infra/records-smoke/session-fixture.ts score <llm-bench output .md> [more .md …]
//       for each file, how many of the facts in session-vault.facts.json its "## notes" section holds
//
// The score is pattern matching (see the facts file): it compares recall between models fairly, it does
// not judge writing, and a model can state a fact in words the patterns miss. Read the notes too.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, 'fixtures/session-vault.txt');
const FACTS = path.join(here, 'fixtures/session-vault.facts.json');
const GM = 'Morgan';

interface Utterance {
  speaker: { id: string; name: string };
  startMs: number;
  endMs: number;
  text: string;
  typed?: boolean;
}

/** The script's lines with a clock: about 150 words a minute, a short breath between speakers. */
async function transcript(): Promise<Utterance[]> {
  const lines = (await readFile(SCRIPT, 'utf8'))
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('#'));
  let at = 4000;
  return lines.map((line) => {
    const match = /^([A-Za-z]+)( \(typed\))?: (.*)$/.exec(line);
    if (!match) throw new Error(`not "Speaker: words": ${line}`);
    const [, name, typed, text] = match as unknown as [string, string, string | undefined, string];
    const startMs = at;
    const endMs = startMs + Math.max(1200, text.split(/\s+/).length * 400);
    at = endMs + 900;
    return {
      speaker: { id: name === GM ? 'gm' : name.toLowerCase(), name },
      startMs,
      endMs,
      text,
      ...(typed ? { typed: true } : {}),
    };
  });
}

interface Fact {
  id: string;
  what: string;
  all?: string[];
  any?: string[];
}

async function score(files: string[]): Promise<void> {
  const { facts, mustNot } = JSON.parse(await readFile(FACTS, 'utf8')) as {
    facts: Fact[];
    mustNot: Fact[];
  };
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    // The notes section of an llm-bench file; a plain notes file is scored whole.
    const notes = /## notes[^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(text)?.[1] ?? text;
    const has = (pattern: string) => new RegExp(pattern, 'i').test(notes);
    const missing = facts.filter((f) => !(f.all ?? []).every(has));
    const leaked = mustNot.filter((f) => (f.any ?? []).some(has));
    console.log(
      JSON.stringify({
        file: path.basename(file),
        found: facts.length - missing.length,
        of: facts.length,
        noteWords: notes.split(/\s+/).filter((w) => w !== '').length,
        missing: missing.map((f) => f.id),
        chatterKept: leaked.map((f) => f.id),
      }),
    );
  }
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'transcript' && rest[0]) {
  const utterances = await transcript();
  await writeFile(rest[0], JSON.stringify(utterances, null, 2));
  const minutes = Math.round((utterances.at(-1)?.endMs ?? 0) / 60000);
  console.log(`${utterances.length} lines, about ${minutes} minutes → ${rest[0]}`);
} else if (command === 'score' && rest.length > 0) {
  await score(rest);
} else {
  console.error('usage: session-fixture.ts transcript <out.json> | score <notes.md …>');
  process.exit(1);
}
