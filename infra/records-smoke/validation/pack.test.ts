// Run: node --test infra/records-smoke/validation/pack.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPack, parseSummaries } from './pack.ts';

const md = [
  '## session (members)',
  '',
  '# The Weeping Anchor',
  '',
  'They arrived at dusk.',
  '',
  '## dm-only (dm)',
  '',
  'Hooks: find the keeper.',
  '',
  '## chapter: 1 (members)',
  '',
  'Chapter one text.',
  '',
  '## character: Kestrel (members)',
  '',
  'Kestrel did a thing.',
  '',
  '## notes (dm)',
  '',
  '### Part 1',
  '#### Events',
  '- a thing',
].join('\n');

test("summaries are split by their headings and keep the notes' own sub-headings", () => {
  const s = parseSummaries(md);
  assert.deepEqual(
    s.map((x) => [x.kind, x.subject, x.visibility]),
    [
      ['session', '', 'members'],
      ['dm-only', '', 'dm'],
      ['chapter', '1', 'members'],
      ['character', 'Kestrel', 'members'],
      ['notes', '', 'dm'],
    ],
  );
  assert.match(s[4]!.text, /^### Part 1\n#### Events\n- a thing$/);
});

test('the pack keeps what a player reads apart from what only the Game Master reads', () => {
  const pack = buildPack({
    label: 'demo',
    sessions: [
      {
        n: 1,
        title: 'The Weeping Anchor',
        summaries: parseSummaries(md),
        memory: 'Mabel Thrupp | person',
        scores: [{ name: 'facts', value: '12 of 18' }],
      },
    ],
    callbacks: [
      { id: 'mabel', memory: true, weave: undefined },
      { id: 'odalys', memory: false, weave: false },
    ],
    callbackText: { mabel: 'Mabel Thrupp, the ferrywoman' },
  });
  const player = pack.indexOf('### What a player reads');
  const gm = pack.indexOf('### What only the Game Master reads');
  assert.ok(player > 0 && gm > player);
  // The tale (with its title as the heading) is on the player's side; the brief and the notes on the Game Master's.
  assert.ok(
    pack.indexOf('#### The Weeping Anchor') > player &&
      pack.indexOf('#### The Weeping Anchor') < gm,
  );
  assert.ok(pack.indexOf("The Chronicler's brief") > gm && pack.indexOf("The scribe's notes") > gm);
  assert.ok(pack.indexOf('Chapter one text.') < gm); // folded under the player's detail
  assert.match(pack, /\| Mabel Thrupp, the ferrywoman \| ✔ \| – \|/);
  assert.match(pack, /\| odalys \| ✖ \| ✖ \|/);
  assert.match(pack, /```text\nMabel Thrupp \| person\n```/);
  assert.match(pack, /\| facts \| 12 of 18 \|/);
});
