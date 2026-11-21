// Tests for the demo campaign's fixtures and their validator. Run: node --test infra/records-smoke/campaign-fixture.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  load,
  parseSession,
  stats,
  validate,
  type Campaign,
  type Catalogue,
} from './campaign-fixture.ts';

const cast: Campaign['cast'] = {
  dm: { name: 'Rowan', email: 'r@example.com' },
  players: [
    { name: 'Priya', email: 'p@example.com' },
    { name: 'Marcus', email: 'm@example.com' },
  ],
  observer: { name: 'The developer', email: 'x', silent: true, character: { name: 'Varek' } },
};
const catalogue: Catalogue = {
  boards: [{ name: 'Combat', buttons: [{ label: 'Sword clash' }] }],
  scenes: [{ name: 'Tavern' }],
};
const parse = (body: string) => parseSession(`[start]\n${body}\n[stop]\n`, cast, catalogue, 't');

test('the shipped campaign fixtures are valid', async () => {
  const l = await load();
  const r = validate(l);
  assert.deepEqual(r.errors, []);
});

test('each shipped session is a believable length, and the whole is about an hour and a half', async () => {
  const l = await load();
  const rows = stats(l, validate(l));
  for (const s of rows)
    assert.ok(s.minutes >= 20 && s.minutes <= 70, `session ${s.n} is ${s.minutes} minutes`);
  const total = rows.reduce((a, s) => a + s.minutes, 0);
  assert.ok(total >= 60 && total <= 150, `${total} minutes in all`);
});

test('the silent observer is on the cast and never speaks in the shipped scripts', async () => {
  const l = await load();
  assert.equal(l.campaign.cast.observer.silent, true);
  for (const t of l.scripts.values()) assert.doesNotMatch(t, /^(Varek|The developer)\b.*: /m);
});

test('out-of-character, whispers and paused talk are absent; in-character chat is captured', () => {
  const p = parse(
    [
      'Priya (typed): /ooc brb',
      'Priya (typed): /dm secret',
      'Priya (typed): /tell Marcus secret',
      'Priya (typed): /say Stand fast!',
      'Priya (typed): I nock an arrow',
      'Priya: spoken line',
      '[pause]',
      'Marcus: said while paused',
      '[resume]',
    ].join('\n'),
  );
  assert.deepEqual(p.problems, []);
  const lines = p.events.filter((e) => e.kind !== 'directive');
  assert.deepEqual(
    lines.map((e) => (e.kind === 'directive' ? '' : e.expect)),
    ['absent', 'absent', 'absent', 'captured', 'captured', 'captured', 'absent'],
  );
});

test('a late joiner is not recorded until they acknowledge the cue', () => {
  const p = parse(
    [
      '[late-join: Marcus]',
      'Marcus: before the cue',
      '[ack: Marcus]',
      'Marcus: after the cue',
    ].join('\n'),
  );
  assert.deepEqual(p.problems, []);
  const expects = p.events.flatMap((e) => (e.kind === 'directive' ? [] : [e.expect]));
  assert.deepEqual(expects, ['absent', 'captured']);
});

test('real mistakes are reported with a line number', () => {
  assert.match(parse('Nobody: hello').problems.join('\n'), /t:2: Nobody is not on the cast/);
  assert.match(parse('Varek: grunt').problems.join('\n'), /silent observer/);
  assert.match(
    parse('[scene: The Moon]').problems.join('\n'),
    /no soundboard scene called "The Moon"/,
  );
  assert.match(parse('[stinger: Combat > Boom]').problems.join('\n'), /no soundboard button/);
  assert.match(parse('[stinger: Sword clash]').problems.join('\n'), /Board > Button/);
  assert.match(
    parse('[loot: Rope | Nobody]').problems.join('\n'),
    /loot goes to party or a player/,
  );
  assert.match(
    parse('[leave: Priya]\nPriya: hello\n[rejoin: Priya]').problems.join('\n'),
    /off the network/,
  );
  assert.match(parse('[pause]').problems.join('\n'), /ends paused/);
  assert.match(parse('[resume]').problems.join('\n'), /without a \[pause\]/);
  assert.match(parse('[ack: Priya]').problems.join('\n'), /without a \[late-join/);
  assert.match(parse('[late-join: Priya]').problems.join('\n'), /never acknowledged/);
  assert.match(parse('Priya (loud): hi').problems.join('\n'), /unknown modifier/);
  assert.match(
    parseSession('Priya: hi\n', cast, catalogue, 't').problems.join('\n'),
    /before \[start\]/,
  );
  assert.match(
    parseSession('[start]\nPriya: hi\n', cast, catalogue, 't').problems.join('\n'),
    /no \[stop\]/,
  );
});

test('a canary on a recorded line, or in the wrong session, fails the check', async () => {
  const l = await load();
  const leak = structuredClone(l);
  leak.scripts.set(
    1,
    (leak.scripts.get(1) ?? '').replace('[stop]', 'Rowan: and the cantaloupe was lovely\n[stop]'),
  );
  const errors = validate(leak).errors.join('\n');
  assert.match(errors, /canary "cantaloupe" is on a line that WILL be recorded/);
  const gm = structuredClone(l);
  gm.scripts.set(
    2,
    (gm.scripts.get(2) ?? '').replace('[stop]', 'Rowan: pour the moonlily oil\n[stop]'),
  );
  assert.match(validate(gm).errors.join('\n'), /GM canary "moonlily" is said in session 2/);
});

test('a fact or a callback that is not in the script fails the check', async () => {
  const l = await load();
  const bad = structuredClone(l);
  (bad.facts['1'] ?? [])[0]!.source = 'a phrase nobody says';
  bad.callbacks.callbacks[0]!.recurs = [2, 3, 4];
  const errors = validate(bad).errors.join('\n');
  assert.match(errors, /fact 1\/hire: source/);
  assert.match(errors, /callback mabel: no session 4/);
});

test('an unused glossary term fails, a bad kind fails', async () => {
  const l = await load();
  const bad = structuredClone(l);
  bad.campaign.glossary.push({ term: 'Zzyzx the Unmentioned', kind: 'place', aliases: [] });
  bad.campaign.glossary.push({ term: 'Rowan', kind: 'creature', aliases: [] });
  const errors = validate(bad).errors.join('\n');
  assert.match(errors, /"Zzyzx the Unmentioned" is never used/);
  assert.match(errors, /Rowan has kind "creature"/);
});
