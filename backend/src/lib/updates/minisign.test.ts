import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { verifyMinisign } from './minisign.js';

// Made with a throwaway key (`tauri signer generate`), signing sample.bin. The private half is not kept.
const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name);
const pub = (await readFile(fixture('test.pub'), 'utf8')).trim();
const sig = (await readFile(fixture('sample.bin.sig'), 'utf8')).trim();

describe('verifyMinisign', () => {
  it('accepts the file the signature was made for', async () => {
    expect(await verifyMinisign(pub, sig, fixture('sample.bin'))).toBe(true);
  });

  it('rejects a file that was changed by one byte', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'minisign-'));
    const file = path.join(dir, 'sample.bin');
    await writeFile(file, 'vtt-chat test installer!\n');
    expect(await verifyMinisign(pub, sig, file)).toBe(false);
  });

  it('rejects a signature from a different key', async () => {
    // The app\'s real updater key never signed this fixture.
    const config = JSON.parse(
      await readFile(
        path.join(import.meta.dirname, '../../../../tauri-client/src-tauri/tauri.conf.json'),
        'utf8',
      ),
    ) as { plugins: { updater: { pubkey: string } } };
    expect(await verifyMinisign(config.plugins.updater.pubkey, sig, fixture('sample.bin'))).toBe(
      false,
    );
  });

  it('rejects garbage instead of throwing', async () => {
    expect(await verifyMinisign('nope', 'nope', fixture('sample.bin'))).toBe(false);
    expect(await verifyMinisign(pub, 'bm9wZQ==', fixture('sample.bin'))).toBe(false);
  });
});
