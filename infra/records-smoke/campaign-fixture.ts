// The demo campaign's fixtures (fixtures/campaign/): parse the session scripts and check that everything that
// refers to them is true, so a typo in a script cannot silently weaken a test run weeks later.
//
//   node infra/records-smoke/campaign-fixture.ts check [dir]   exit 1 if anything is wrong
//   node infra/records-smoke/campaign-fixture.ts stats [dir]   sizes, durations, glossary and canary use
//
// The line format is described in fixtures/campaign/README.md. What is checked:
//   - every speaker is on the cast, the silent observer never speaks, and nobody talks while off the network
//   - every [scene: …] and [stinger: Board > Button] exists in the shipped soundboard catalogue
//   - pauses, late joins, leaves and rejoins pair up, and the recording starts and stops
//   - every canary word is on lines that must never reach a shared artifact, and nowhere else
//   - every fact and callback is really in the scripts it says it is in
//   - every glossary term is used (single-use terms are reported, not failed)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = path.join(here, 'fixtures/campaign');
const CATALOGUE = path.join(here, '../../backend/assets/sounds/catalogue.json');

export const WORDS_PER_MINUTE = 150;
/** A breath between speakers, in seconds (the same as session-fixture.ts). */
export const GAP_SECONDS = 1.2;

export const GLOSSARY_KINDS = ['person', 'place', 'item', 'spell', 'other'] as const;
/** Chat commands whose lines never reach a shared artifact: out of character, and private whispers. */
const ABSENT_COMMANDS = new Set([
  'ooc',
  'late',
  'cant',
  'work',
  'brb',
  'afk',
  'back',
  'dm',
  'tell',
  'w',
]);

export interface Person {
  name: string;
  email: string;
  voice?: string;
  character?: { name: string; class?: string; subclass?: string; race?: string; level?: number };
  silent?: boolean;
}
export interface Campaign {
  name: string;
  cast: { dm: Person; players: Person[]; observer: Person };
  storyteller: string;
  sessions: { n: number; title: string; file: string; extended?: boolean }[];
  gmNotes: string;
  glossary: { term: string; kind: string; aliases: string[] }[];
  canaries: { word: string; session: number; how: string }[];
  gmCanaries: { word: string; how: string }[];
}
export interface Fact {
  id: string;
  what: string;
  all: string[];
  source: string;
  importance: string;
}
export interface Callback {
  id: string;
  what: string;
  introduced: number;
  recurs: number[];
  source: string;
  memory: { after: number; pattern: string };
  weave: { session: number; outputs: string[]; pattern: string };
  trap?: boolean;
}
export interface Catalogue {
  boards: { name: string; buttons: { label: string }[] }[];
  scenes: { name: string }[];
}

export type Expect = 'captured' | 'absent';
export type Event =
  | { kind: 'say' | 'type'; who: string; text: string; expect: Expect; over: boolean; line: number }
  | { kind: 'directive'; name: string; arg: string; line: number };

export interface Parsed {
  events: Event[];
  problems: string[];
}

const UTTERANCE = /^([A-Za-z]+)((?: \([a-z0-9 ]+\))*): (.*)$/;
const DIRECTIVE = /^\[([a-z-]+)(?::\s*(.*))?\]$/;
const DIRECTIVES = new Set([
  'start',
  'stop',
  'pause',
  'resume',
  'scene',
  'stinger',
  'loot',
  'handout',
  'late-join',
  'ack',
  'leave',
  'rejoin',
]);

/** Parse one session script, working out for every line whether it must end up in the records. */
export function parseSession(
  text: string,
  cast: Campaign['cast'],
  catalogue: Catalogue,
  label = 'script',
): Parsed {
  const problems: string[] = [];
  const events: Event[] = [];
  const players = new Set([cast.dm.name, ...cast.players.map((p) => p.name)]);
  const joinable = new Set(cast.players.map((p) => p.name));
  const scenes = new Set(catalogue.scenes.map((s) => s.name.toLowerCase()));
  const buttons = new Set(
    catalogue.boards.flatMap((b) => b.buttons.map((x) => `${b.name} > ${x.label}`.toLowerCase())),
  );
  let started = false;
  let stopped = false;
  let paused = false;
  const unacked = new Set<string>();
  const away = new Set<string>();
  const err = (n: number, m: string) => problems.push(`${label}:${n}: ${m}`);

  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const d = DIRECTIVE.exec(line);
    if (d) {
      const name = d[1] as string;
      const arg = (d[2] ?? '').trim();
      events.push({ kind: 'directive', name, arg, line: n });
      if (!DIRECTIVES.has(name)) return err(n, `unknown directive [${name}]`);
      if (name !== 'start' && !started) err(n, `[${name}] before [start]`);
      if (stopped) err(n, `[${name}] after [stop]`);
      switch (name) {
        case 'start':
          if (started) err(n, 'a second [start]');
          started = true;
          break;
        case 'stop':
          if (paused) err(n, '[stop] while paused');
          stopped = true;
          break;
        case 'pause':
          if (paused) err(n, '[pause] while already paused');
          paused = true;
          break;
        case 'resume':
          if (!paused) err(n, '[resume] without a [pause]');
          paused = false;
          break;
        case 'scene':
          if (!scenes.has(arg.toLowerCase())) err(n, `no soundboard scene called "${arg}"`);
          break;
        case 'stinger':
          if (!buttons.has(arg.toLowerCase()))
            err(n, `no soundboard button "${arg}" (write Board > Button)`);
          break;
        case 'loot': {
          const [item, who] = arg.split('|').map((x) => x.trim());
          if (!item || !who) err(n, 'loot is [loot: item | recipient]');
          else if (who.toLowerCase() !== 'party' && !joinable.has(who))
            err(n, `loot goes to party or a player, not "${who}"`);
          break;
        }
        case 'handout': {
          // [handout: Title | text] shows to everyone; [handout: Title | text | to Priya, Elise] to those players only.
          const [title, body, to] = arg.split('|').map((x) => x.trim());
          if (!title || !body)
            err(n, 'handout is [handout: Title | text] or [handout: Title | text | to Name, Name]');
          else if (to !== undefined) {
            const names = to
              .replace(/^to\s+/i, '')
              .split(',')
              .map((x) => x.trim());
            for (const who of names)
              if (!joinable.has(who)) err(n, `handout goes to players, not "${who}"`);
          }
          break;
        }
        case 'late-join':
        case 'ack':
        case 'leave':
        case 'rejoin':
          if (!joinable.has(arg)) {
            err(n, `[${name}: ${arg}] is not a player`);
            break;
          }
          if (name === 'late-join') unacked.add(arg);
          if (name === 'ack') {
            if (!unacked.has(arg)) err(n, `[ack: ${arg}] without a [late-join: ${arg}]`);
            unacked.delete(arg);
          }
          if (name === 'leave') away.add(arg);
          if (name === 'rejoin') {
            if (!away.has(arg)) err(n, `[rejoin: ${arg}] without a [leave: ${arg}]`);
            away.delete(arg);
          }
          break;
      }
      return;
    }
    const m = UTTERANCE.exec(line);
    if (!m) return err(n, `not "Speaker: words" or a [directive]: ${line.slice(0, 60)}`);
    const who = m[1] as string;
    const mods = (m[2] ?? '').match(/\(([a-z0-9 ]+)\)/g)?.map((x) => x.slice(1, -1)) ?? [];
    const body = m[3] as string;
    for (const mod of mods)
      if (mod !== 'typed' && mod !== 'over') err(n, `unknown modifier (${mod})`);
    const typed = mods.includes('typed');
    if (cast.observer.character && who === cast.observer.character.name)
      err(n, `${who} is the silent observer and never has a line`);
    else if (who === cast.observer.name) err(n, 'the silent observer never has a line');
    else if (!players.has(who)) err(n, `${who} is not on the cast`);
    if (!started) err(n, `a line before [start]`);
    if (away.has(who))
      err(n, `${who} is off the network (between [leave] and [rejoin]) and cannot speak or type`);
    let expect: Expect = 'captured';
    if (paused) expect = 'absent';
    else if (!typed && unacked.has(who)) expect = 'absent';
    else if (typed) {
      const cmd = /^\/([a-z]+)\b/.exec(body)?.[1];
      if (cmd && ABSENT_COMMANDS.has(cmd)) expect = 'absent';
    }
    events.push({
      kind: typed ? 'type' : 'say',
      who,
      text: body,
      expect,
      over: mods.includes('over'),
      line: n,
    });
  });
  if (!started) problems.push(`${label}: no [start]`);
  else if (!stopped) problems.push(`${label}: no [stop]`);
  if (paused) problems.push(`${label}: ends paused`);
  for (const w of unacked) problems.push(`${label}: ${w} joined late and never acknowledged`);
  for (const w of away) problems.push(`${label}: ${w} left and never rejoined`);
  return { events, problems };
}

const wordRe = (w: string) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
const countWords = (t: string) => t.split(/\s+/).filter(Boolean).length;
const spokenText = (events: Event[], expect?: Expect) =>
  events
    .filter((e): e is Extract<Event, { who: string }> => e.kind !== 'directive')
    .filter((e) => expect === undefined || e.expect === expect)
    .map((e) => e.text)
    .join('\n');

export interface Loaded {
  campaign: Campaign;
  facts: Record<string, Fact[]> & { about?: unknown };
  callbacks: { callbacks: Callback[] };
  scripts: Map<number, string>;
  gmNotes: string;
  catalogue: Catalogue;
}

export async function load(dir = DEFAULT_DIR): Promise<Loaded> {
  const j = async (f: string) => JSON.parse(await readFile(path.join(dir, f), 'utf8')) as unknown;
  const campaign = (await j('campaign.json')) as Campaign;
  const scripts = new Map<number, string>();
  for (const s of campaign.sessions)
    scripts.set(s.n, await readFile(path.join(dir, s.file), 'utf8'));
  return {
    campaign,
    facts: (await j('facts.json')) as Loaded['facts'],
    callbacks: (await j('callbacks.json')) as Loaded['callbacks'],
    scripts,
    gmNotes: await readFile(path.join(dir, campaign.gmNotes), 'utf8'),
    catalogue: JSON.parse(await readFile(CATALOGUE, 'utf8')) as Catalogue,
  };
}

export interface Report {
  errors: string[];
  warnings: string[];
  parsed: Map<number, Parsed>;
}

export function validate(l: Loaded): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = new Map<number, Parsed>();
  const { campaign } = l;
  for (const s of campaign.sessions) {
    const p = parseSession(l.scripts.get(s.n) ?? '', campaign.cast, l.catalogue, s.file);
    parsed.set(s.n, p);
    errors.push(...p.problems);
  }
  const text = (n: number, e?: Expect) => spokenText(parsed.get(n)?.events ?? [], e);

  // Canaries: only on lines that must never be recorded.
  for (const c of campaign.canaries) {
    const re = wordRe(c.word);
    let hits = 0;
    for (const [n, p] of parsed) {
      for (const e of p.events) {
        if (e.kind === 'directive' || !re.test(e.text)) continue;
        hits += 1;
        if (n !== c.session)
          errors.push(
            `canary "${c.word}" (session ${c.session}) also appears in session ${n}:${e.line}`,
          );
        if (e.expect !== 'absent')
          errors.push(
            `canary "${c.word}" is on a line that WILL be recorded (session ${n}:${e.line})`,
          );
      }
    }
    if (hits === 0) errors.push(`canary "${c.word}" is in no script`);
  }
  for (const c of campaign.gmCanaries) {
    if (!wordRe(c.word).test(l.gmNotes))
      errors.push(`GM canary "${c.word}" is not in the GM notes`);
    for (const [n, t] of l.scripts)
      if (wordRe(c.word).test(t))
        errors.push(
          `GM canary "${c.word}" is said in session ${n}: it must live in the notes only`,
        );
  }

  // Facts: really in the script they belong to.
  for (const s of campaign.sessions) {
    const list = l.facts[String(s.n)] ?? [];
    if (list.length === 0) errors.push(`no facts for session ${s.n}`);
    const seen = new Set<string>();
    for (const f of list) {
      if (seen.has(f.id)) errors.push(`session ${s.n}: duplicate fact id ${f.id}`);
      seen.add(f.id);
      try {
        for (const a of f.all) new RegExp(a, 'i');
        if (!new RegExp(f.source, 'i').test(text(s.n, 'captured')))
          errors.push(
            `fact ${s.n}/${f.id}: source /${f.source}/ is not in the recorded lines of session ${s.n}`,
          );
      } catch (x) {
        errors.push(`fact ${s.n}/${f.id}: bad pattern (${(x as Error).message})`);
      }
      if (!['core', 'subtle', 'trap'].includes(f.importance))
        errors.push(`fact ${s.n}/${f.id}: importance must be core, subtle or trap`);
    }
  }

  // Callbacks: in each session they claim.
  const ids = new Set<string>();
  for (const cb of l.callbacks.callbacks) {
    if (ids.has(cb.id)) errors.push(`duplicate callback id ${cb.id}`);
    ids.add(cb.id);
    for (const n of [cb.introduced, ...cb.recurs]) {
      if (!l.scripts.has(n)) errors.push(`callback ${cb.id}: no session ${n}`);
      else if (!new RegExp(cb.source, 'i').test(text(n, 'captured')))
        errors.push(`callback ${cb.id}: /${cb.source}/ is not in session ${n}`);
    }
    if (cb.recurs.some((n) => n <= cb.introduced))
      errors.push(`callback ${cb.id}: it recurs before it is introduced`);
    for (const re of [cb.memory.pattern, cb.weave.pattern]) {
      try {
        new RegExp(re, 'i');
      } catch (x) {
        errors.push(`callback ${cb.id}: bad pattern (${(x as Error).message})`);
      }
    }
    if (
      !l.scripts.has(cb.weave.session) ||
      cb.weave.session < Math.max(cb.introduced, ...cb.recurs, 0) - 0
    ) {
      if (!l.scripts.has(cb.weave.session))
        errors.push(`callback ${cb.id}: weave session ${cb.weave.session} does not exist`);
    }
  }

  // Glossary.
  const terms = new Set<string>();
  const all = [...l.scripts.keys()].map((n) => text(n, 'captured')).join('\n');
  for (const g of campaign.glossary) {
    if (terms.has(g.term.toLowerCase())) errors.push(`glossary: duplicate term ${g.term}`);
    terms.add(g.term.toLowerCase());
    if (!(GLOSSARY_KINDS as readonly string[]).includes(g.kind))
      errors.push(`glossary: ${g.term} has kind "${g.kind}"`);
    if (g.term.length > 100 || g.aliases.length > 10)
      errors.push(`glossary: ${g.term} is over the server's limits`);
    if (g.aliases.some((a) => a.toLowerCase() === g.term.toLowerCase()))
      errors.push(`glossary: ${g.term} lists itself as an alias`);
    const n = (all.match(new RegExp(g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) ?? [])
      .length;
    if (n === 0) errors.push(`glossary: "${g.term}" is never used in any script`);
    else if (n === 1) warnings.push(`glossary: "${g.term}" is used only once (a weak test)`);
  }
  return { errors, warnings, parsed };
}

export interface SessionStats {
  n: number;
  title: string;
  words: number;
  minutes: number;
  spokenLines: number;
  typedLines: number;
  absentLines: number;
  scenes: number;
  stingers: number;
  loot: number;
  handouts: number;
  facts: number;
}

export function stats(l: Loaded, report: Report): SessionStats[] {
  return l.campaign.sessions.map((s) => {
    const ev = report.parsed.get(s.n)?.events ?? [];
    const lines = ev.filter((e): e is Extract<Event, { who: string }> => e.kind !== 'directive');
    const spoken = lines.filter((e) => e.kind === 'say');
    const words = countWords(spoken.map((e) => e.text).join(' '));
    const dir = (name: string) =>
      ev.filter((e) => e.kind === 'directive' && e.name === name).length;
    return {
      n: s.n,
      title: s.title,
      words,
      minutes:
        Math.round((words / WORDS_PER_MINUTE + (spoken.length * GAP_SECONDS) / 60) * 10) / 10,
      spokenLines: spoken.length,
      typedLines: lines.length - spoken.length,
      absentLines: lines.filter((e) => e.expect === 'absent').length,
      scenes: dir('scene'),
      stingers: dir('stinger'),
      loot: dir('loot'),
      handouts: dir('handout'),
      facts: (l.facts[String(s.n)] ?? []).length,
    };
  });
}

async function main(argv: string[]) {
  const [cmd, dir] = argv;
  if (cmd !== 'check' && cmd !== 'stats') {
    console.error('usage: campaign-fixture.ts check|stats [dir]');
    process.exit(2);
  }
  const l = await load(dir ?? DEFAULT_DIR);
  const r = validate(l);
  if (cmd === 'stats') {
    const rows = stats(l, r);
    console.log(
      'session  minutes  words  spoken  typed  absent  scenes  stingers  loot  handouts  facts',
    );
    for (const s of rows)
      console.log(
        `${String(s.n).padEnd(8)} ${String(s.minutes).padEnd(8)} ${String(s.words).padEnd(6)} ${String(s.spokenLines).padEnd(7)} ${String(s.typedLines).padEnd(6)} ${String(s.absentLines).padEnd(7)} ${String(s.scenes).padEnd(7)} ${String(s.stingers).padEnd(9)} ${String(s.loot).padEnd(5)} ${String(s.handouts).padEnd(8)} ${s.facts}`,
      );
    console.log(
      `total    ${Math.round(rows.reduce((a, s) => a + s.minutes, 0) * 10) / 10} minutes, ${rows.reduce((a, s) => a + s.words, 0)} spoken words`,
    );
    console.log(
      `glossary ${l.campaign.glossary.length} terms, ${l.callbacks.callbacks.length} callbacks, ${l.campaign.canaries.length} canaries (+${l.campaign.gmCanaries.length} in the GM notes)`,
    );
  }
  for (const w of r.warnings) console.log(`warning: ${w}`);
  for (const e of r.errors) console.log(`ERROR: ${e}`);
  if (r.errors.length > 0) {
    console.log(`${r.errors.length} problem(s)`);
    process.exit(1);
  }
  if (cmd === 'check') console.log(`campaign fixtures OK (${r.warnings.length} warning(s))`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
