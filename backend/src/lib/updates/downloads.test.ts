import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
      macosIntel: 'https://dl.test/a_x64.dmg',
      linux: 'https://dl.test/a_amd64.AppImage',
      linuxRpm: 'https://dl.test/a.rpm',
    });
  });
});

describe('pickDownloads on a Mac', () => {
  it('keeps an Intel-only release in the Intel slot, and a .dmg with no architecture in the main one', () => {
    expect(pickDownloads([asset('VTT.Chat_1.0.0_x64.dmg')])).toEqual({
      macosIntel: 'https://dl.test/VTT.Chat_1.0.0_x64.dmg',
    });
    expect(pickDownloads([asset('VTT.Chat_1.0.0.dmg')])).toEqual({
      macos: 'https://dl.test/VTT.Chat_1.0.0.dmg',
    });
    expect(pickDownloads([asset('VTT.Chat_1.0.0_universal.dmg')])).toEqual({
      macos: 'https://dl.test/VTT.Chat_1.0.0_universal.dmg',
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

describe('resolveDownloads for dev builds', () => {
  it('prefers the dev set when asked, falls back to the release set, and lets explicit URLs win', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'downloads-dev-'));
    await mkdir(path.join(dir, 'dev'));
    await writeFile(
      path.join(dir, 'downloads.json'),
      JSON.stringify({ linux: 'https://dl.test/rel.AppImage' }),
    );
    expect(await resolveDownloads({}, dir, { dev: true })).toEqual({
      linux: 'https://dl.test/rel.AppImage',
    });
    await writeFile(
      path.join(dir, 'dev', 'downloads.json'),
      JSON.stringify({ linux: 'https://dl.test/dev.AppImage' }),
    );
    expect(await resolveDownloads({}, dir, { dev: true })).toEqual({
      linux: 'https://dl.test/dev.AppImage',
    });
    expect(await resolveDownloads({}, dir)).toEqual({ linux: 'https://dl.test/rel.AppImage' });
    expect(await resolveDownloads({ windows: 'https://mine/w' }, dir, { dev: true })).toEqual({
      windows: 'https://mine/w',
    });
  });
});
