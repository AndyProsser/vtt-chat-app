// Refreshes shared/protocol.contract.json after a deliberate wire-contract change.
//
//   npm run protocol:update                        refuses if the contract changed but PROTOCOL_VERSION did not
//   npm run protocol:update -- --allow-same-version  for an additive change inside an unreleased minor
//
// The contract is computed by backend/src/lib/wire/contract.ts (it imports the backend's zod schemas, which
// need the TypeScript toolchain), so this runs that module's update test under vitest. The refusal logic
// lives in contract.test.ts next to the guard it belongs with. See docs/architecture/VERSIONING-AND-DEPLOYMENT.md.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--allow-same-version');
if (unknown.length > 0) {
  console.error(`unknown argument(s): ${unknown.join(' ')}`);
  process.exit(2);
}

const backend = fileURLToPath(new URL('../backend', import.meta.url));
const result = spawnSync(
  'npx',
  ['vitest', 'run', 'src/lib/wire/contract.test.ts', '--reporter=dot'],
  {
    cwd: backend,
    stdio: 'inherit',
    env: {
      ...process.env,
      PROTOCOL_CONTRACT_UPDATE: '1',
      ...(args.includes('--allow-same-version') ? { PROTOCOL_ALLOW_SAME_VERSION: '1' } : {}),
    },
  },
);
process.exit(result.status ?? 1);
