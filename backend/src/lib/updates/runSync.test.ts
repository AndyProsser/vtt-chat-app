import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { UPDATER_PUBLIC_KEY } from '../../consts/index.js';
import { loadConfig } from '../config.js';
import { releaseLine } from './runSync.js';

describe('update sync wiring', () => {
  it('trusts the same updater key the app is built with', async () => {
    const conf = JSON.parse(
      await readFile(
        path.join(import.meta.dirname, '../../../../tauri-client/src-tauri/tauri.conf.json'),
        'utf8',
      ),
    ) as { plugins: { updater: { pubkey: string } } };
    expect(UPDATER_PUBLIC_KEY).toBe(conf.plugins.updater.pubkey);
  });

  it('takes the release line (MAJOR.MINOR) from the server version', () => {
    expect(releaseLine('0.3.2')).toBe('0.3');
    expect(releaseLine('0.4.0-dev.2')).toBe('0.4');
    expect(releaseLine('unknown')).toBeUndefined();
  });

  it('is off unless the operator chooses a source and a folder', () => {
    expect(loadConfig({}).updatesSync).toBeUndefined();
    expect(loadConfig({ UPDATES_SOURCE: 'github' }).updatesSync).toBeUndefined();
    expect(
      loadConfig({ UPDATES_SOURCE: 'nonsense', UPDATES_DIR: '/u' }).updatesSync,
    ).toBeUndefined();
    expect(
      loadConfig({ UPDATES_SOURCE: 'mirror', UPDATES_DIR: '/u', PUBLIC_URL: 'https://p' })
        .updatesSync,
    ).toMatchObject({ source: 'mirror', includeDev: false, publicUrl: 'https://p' });
  });
});
