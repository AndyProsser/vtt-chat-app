/**
 * `vtt-admin test ai`, run inside the records worker's container (that is where Whisper's and Ollama's addresses and the API
 * keys are). The Compose `vtt-admin` runs it with `docker compose exec worker`; a native install runs the same file.
 *
 *   node ai/dist/cli/selftest.js [--local] [--remote] [--cloud]
 *
 * Exit code 0 when nothing failed, 1 when something did, 2 for a flag it does not know.
 */
import process from 'node:process';

import { formatTestRows, testExitCode, testVerdict, type TestBadge } from '@vtt-chat-app/shared';

import { runAiTest } from '../lib/selftest/aiTest.js';
import { PostgresRecordsStore, createPool } from '../lib/records/postgresRecordsStore.js';

const FLAGS = new Set(['--local', '--remote', '--cloud']);
const args = process.argv.slice(2);
const unknown = args.filter((a) => !FLAGS.has(a));
if (unknown.length > 0) {
  console.error(`unknown option ${unknown[0]}. usage: test ai [--local] [--remote] [--cloud]`);
  process.exit(2);
}

// Colour only when the terminal asked for it (the vtt-admin wrapper passes FORCE_COLOR for a terminal, VTT_ADMIN_PLAIN otherwise).
const colour = process.env.FORCE_COLOR && !process.env.VTT_ADMIN_PLAIN && !process.env.NO_COLOR;
const paint: Record<TestBadge, string> = { ok: '32', warn: '33', fail: '31', off: '90' };
const BADGE: Record<TestBadge, string> = { ok: 'ok  ', warn: 'WARN', fail: 'FAIL', off: '--  ' };
const badge = (kind: TestBadge): string =>
  colour ? `\u001b[${paint[kind]}m${BADGE[kind]}\u001b[0m` : BADGE[kind];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set: this has to run inside the worker, where the AI settings live.',
  );
  process.exit(1);
}
const pool = createPool(url);
try {
  const settings = await new PostgresRecordsStore(pool).getAiSettings();
  const rows = await runAiTest(
    {
      local: args.includes('--local'),
      remote: args.includes('--remote'),
      cloud: args.includes('--cloud'),
    },
    { settings, env: process.env },
  );
  console.log('AI: can the worker reach Whisper and the summary model?\n');
  for (const line of formatTestRows(rows, badge)) console.log(`  ${line}`);
  console.log(`\n  ${testVerdict(rows)}`);
  process.exitCode = testExitCode(rows);
} finally {
  await pool.end();
}
