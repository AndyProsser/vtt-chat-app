// Run: node --test infra/records-smoke/validation/score.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Callback, Fact } from '../campaign-fixture.ts';
import {
  meanAccuracy,
  recall,
  scoreCallbacks,
  scoreCanaries,
  scoreFacts,
  scoreGlossary,
  speakerAccuracy,
  tobiasesKeptApart,
  type Artifact,
} from './score.ts';

const fact = (id: string, all: string[], importance = 'core'): Fact => ({
  id,
  what: id,
  all,
  source: '.',
  importance,
});

test('a fact is found only when every pattern matches', () => {
  const s = scoreFacts(
    [fact('a', ['mabel', 'onion']), fact('b', ['mabel', 'duchess'], 'subtle')],
    'Mabel took the pickled onions.',
  );
  assert.deepEqual(
    s.map((x) => x.found),
    [true, false],
  );
  assert.deepEqual(recall(s), { found: 1, total: 2 });
  assert.deepEqual(recall(s, 'subtle'), { found: 0, total: 1 });
});

test('canaries are found as whole words, in every artifact that holds one', () => {
  const art: Artifact[] = [
    { name: 'notes 1', kind: 'notes', text: 'The party met a cantaloupe seller.' },
    { name: 'tale 1', kind: 'tale', text: 'Nothing to see.' },
    { name: 'search', kind: 'search', text: 'walnuts and quince' },
  ];
  assert.deepEqual(scoreCanaries(['cantaloupe', 'walnut', 'quince'], art), [
    { word: 'cantaloupe', where: 'notes 1' },
    { word: 'quince', where: 'search' },
  ]);
  assert.deepEqual(scoreCanaries(['rhubarb'], art), []);
});

test('glossary accuracy counts what was said against what came out, and keeps the mishearings', () => {
  const terms = [
    { term: 'Quillfeather', aliases: ['Quill Feather'] },
    { term: 'Saltmarrow', aliases: ['Salt Marrow'] },
    { term: 'Unsaid', aliases: [] },
  ];
  const s = scoreGlossary(
    terms,
    'Quillfeather and Quillfeather, then Saltmarrow',
    'Quill Feather and Quillfeather, then Salt Marrow',
  );
  assert.equal(s.length, 2);
  assert.deepEqual(s[0], {
    term: 'Quillfeather',
    expected: 2,
    exact: 1,
    heard: { 'Quill Feather': 1 },
    accuracy: 0.5,
  });
  assert.equal(s[1]?.accuracy, 0);
  assert.equal(meanAccuracy(s)?.toFixed(3), '0.333');
  assert.equal(meanAccuracy([]), undefined);
});

test('speaker accuracy is per speaker, and a speaker with no words is skipped', () => {
  const a = speakerAccuracy(
    { Priya: 'the quick brown fox', Marcus: '' },
    { Priya: 'the quick brown box' },
  );
  assert.deepEqual(Object.keys(a), ['Priya']);
  assert.equal(a.Priya, 0.75);
});

test('callbacks: memory after a session, and the weave in a later tale or brief', () => {
  const cb: Callback = {
    id: 'mabel',
    what: '',
    introduced: 1,
    recurs: [3],
    source: 'Mabel',
    memory: { after: 1, pattern: 'mabel' },
    weave: { session: 3, outputs: ['tale'], pattern: 'mabel.{0,50}onion' },
  };
  const out: Artifact[] = [
    {
      name: 'tale 3',
      kind: 'tale',
      session: 3,
      text: 'Mabel, who once took a jar of onions, poled the barge.',
    },
    { name: 'brief 3', kind: 'brief', session: 3, text: 'Nothing about her.' },
  ];
  assert.deepEqual(scoreCallbacks([cb], { 1: 'Mabel Thrupp | person' }, out), [
    { id: 'mabel', memory: true, weave: true },
  ]);
  assert.deepEqual(scoreCallbacks([cb], { 1: 'nobody' }, [])[0], {
    id: 'mabel',
    memory: false,
    weave: undefined,
  });
});

test('the two Tobiases must stay two entries', () => {
  assert.equal(tobiasesKeptApart('Tobias Quillfeather | person\nTobias Wick | person').apart, true);
  assert.equal(tobiasesKeptApart('Tobias Quillfeather (also Wick) | person').apart, false);
  assert.equal(tobiasesKeptApart('Tobias Quillfeather | person').apart, false);
});
