import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pickDownloads, resolveDownloads } from './downloads.js';

const asset = (name: string) => ({ name, browser_download_url: `https://dl.test/${name}` });

describe('pickDownloads', () => {
  it('chooses one installer per slot, preferring setup.exe over msi and x64 over arm on Linux/Windows', () => {
    const picked = pickDownloads(
      [
        'a_arm64-setup.exe',
        'a_x64.msi',
        'a_x64-setup.exe',
        'a_x64.dmg',
        'a_aarch64.dmg',
        'a_arm64.AppImage',
        'a_amd64.AppImage',
        'a.rpm',
        'a.app.tar.gz',
        'a.AppImage.sig',
      ].map(asset),
    );
    expect(picked).toEqual({
      windows: 'https://dl.test/a_x64-setup.exe',
      macos: 'https://dl.test/a_aarch64.dmg',
      linux: 'https://dl.test/a_amd64.AppImage',
      linuxRpm: 'https://dl.test/a.rpm',
    });
  });
});

describe('resolveDownloads precedence', () => {
  it('explicit CLIENT_URL_* first, else downloads.json, else nothing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'downloads-'));
    expect(await resolveDownloads({}, dir)).toEqual({});
    expect(await resolveDownloads({}, undefined)).toEqual({});
    await writeFile(
      path.join(dir, 'downloads.json'),
      JSON.stringify({
        linux: 'https://dl.test/x.AppImage',
        windows: 'javascript:alert(1)',
        junk: 1,
      }),
    );
    expect(await resolveDownloads({}, dir)).toEqual({ linux: 'https://dl.test/x.AppImage' });
    expect(await resolveDownloads({ windows: 'https://mine/w' }, dir)).toEqual({
      windows: 'https://mine/w',
    });
    await writeFile(path.join(dir, 'downloads.json'), 'not json');
    expect(await resolveDownloads({}, dir)).toEqual({});
  });
});
