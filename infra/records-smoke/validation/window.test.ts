import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeModelWindow, parseModelWindow } from './window.ts';

const log = [
  'slot update_slots: id  0 | task 1 | new prompt, n_ctx_slot = 8192, n_keep = 4, task.n_tokens = 3000',
  'slot      release: id  0 | task 1 | stop processing: n_tokens = 3400, truncated = 0',
  'slot update_slots: id  0 | task 2 | new prompt, n_ctx_slot = 8192, n_keep = 4, task.n_tokens = 8100',
  'slot      release: id  0 | task 2 | stop processing: n_tokens = 8192, truncated = 1',
  'slot      release: id  0 | task 3 | stop processing: n_tokens = 7600, truncated = 0',
].join('\n');

test('reads the window, the fill, the cuts and the nearly-full requests from Ollama’s log', () => {
  const m = parseModelWindow(log);
  assert.equal(m.calls, 3);
  assert.equal(m.window, 8192);
  assert.equal(m.maxTokens, 8192);
  assert.equal(m.truncated, 1);
  assert.equal(m.nearlyFull, 2);
  const d = describeModelWindow(m);
  assert.match(d.text, /1 request\(s\) were CUT/);
  assert.equal(d.notable, true);
});

test('a log with no requests is not a finding', () => {
  const d = describeModelWindow(parseModelWindow('nothing here'));
  assert.equal(d.notable, false);
});
