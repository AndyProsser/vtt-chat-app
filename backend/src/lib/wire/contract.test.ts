import { readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildContract, CONTRACT_PATH, contractFile, type ContractFile } from './contract.js';

const UPDATE = process.env.PROTOCOL_CONTRACT_UPDATE === '1';
const ALLOW_SAME_VERSION = process.env.PROTOCOL_ALLOW_SAME_VERSION === '1';

const committed = (): ContractFile =>
  JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as ContractFile;
const render = (file: ContractFile): string => `${JSON.stringify(file, null, 2)}\n`;

describe('wire contract guard', () => {
  it('sees the frames, events and routes it is meant to guard', () => {
    const contract = buildContract();
    expect(Object.keys(contract.clientFrames)).toContain('auth');
    expect(Object.keys(contract.clientFrames)).toContain('chat.message');
    expect(contract.serverEvents).toEqual(
      expect.arrayContaining(['auth.ok', 'auth.revoked', 'error', 'snapshot', 'chat.message']),
    );
    expect(contract.restRoutes.some((r) => r.includes('POST'))).toBe(true);
    expect(contract.restRoutes).toContain('app.ts USE /api/version');
  });

  it('is deterministic', () => {
    expect(contractFile().hash).toBe(contractFile().hash);
  });

  if (UPDATE) {
    // Run through `npm run protocol:update`, which is the only supported way to refresh the file.
    it('rewrites shared/protocol.contract.json', () => {
      const next = contractFile();
      const before = committed();
      if (next.hash !== before.hash && next.protocolVersion === before.protocolVersion) {
        expect(
          ALLOW_SAME_VERSION,
          'The wire contract changed but PROTOCOL_VERSION did not. Bump PROTOCOL_VERSION in ' +
            'shared/src/consts/index.ts and tauri-client/src-tauri/src/consts.rs (and the MINOR version), ' +
            'or pass --allow-same-version for an additive change inside a minor that has not been released.',
        ).toBe(true);
      }
      writeFileSync(CONTRACT_PATH, render(next));
    });
  } else {
    it('matches shared/protocol.contract.json', () => {
      const now = contractFile();
      const before = committed();
      expect(
        now.hash,
        'wire contract changed: if this is intentional bump PROTOCOL_VERSION (and the MINOR per ' +
          'VERSIONING-AND-DEPLOYMENT.md; the Rust const in tauri-client/src-tauri/src/consts.rs too) then run ' +
          '`npm run protocol:update` to refresh shared/protocol.contract.json. ' +
          `Summary now: ${JSON.stringify(now.summary)}`,
      ).toBe(before.hash);
      expect(now.protocolVersion).toBe(before.protocolVersion);
    });
  }
});
