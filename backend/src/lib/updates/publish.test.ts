import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildLatestJson, platformOf, publishUpdates } from './publish.js';

describe('platformOf', () => {
  it('maps the signed artifacts the Tauri bundler writes to updater platforms', () => {
    expect(platformOf('VTT Chat App_0.3.0_amd64.AppImage')).toBe('linux-x86_64');
    expect(platformOf('VTT Chat App_0.3.0_aarch64.AppImage')).toBe('linux-aarch64');
    expect(platformOf('VTT Chat App_0.3.0_x64-setup.exe')).toBe('windows-x86_64');
    expect(platformOf('VTT Chat App_0.3.0_x64_en-US.msi')).toBe('windows-x86_64');
    expect(platformOf('VTT Chat App.app.tar.gz')).toBe('darwin-x86_64');
    expect(platformOf('VTT Chat App_aarch64.app.tar.gz')).toBe('darwin-aarch64');
  });
  it('ignores everything else', () => {
    expect(platformOf('notes.txt')).toBeUndefined();
    expect(platformOf('VTT Chat App_0.3.0_amd64.deb')).toBeUndefined();
    expect(platformOf('latest.json')).toBeUndefined();
  });
});

describe('buildLatestJson', () => {
  it('lists each platform with its signature and an absolute, escaped URL', () => {
    const json = buildLatestJson({
      version: '0.3.0',
      notes: 'Faster.',
      pubDate: '2026-11-08T00:00:00.000Z',
      baseUrl: 'https://play.example.com/updates/',
      artifacts: [
        { platform: 'linux-x86_64', file: 'VTT Chat App_0.3.0_amd64.AppImage', signature: 'SIG' },
      ],
    });
    expect(json).toEqual({
      version: '0.3.0',
      notes: 'Faster.',
      pub_date: '2026-11-08T00:00:00.000Z',
      platforms: {
        'linux-x86_64': {
          signature: 'SIG',
          url: 'https://play.example.com/updates/VTT%20Chat%20App_0.3.0_amd64.AppImage',
        },
      },
    });
  });
});

describe('publishUpdates', () => {
  function release(version = '0.3.0') {
    const from = mkdtempSync(path.join(tmpdir(), 'rel-'));
    const to = mkdtempSync(path.join(tmpdir(), 'upd-'));
    const file = `VTT Chat App_${version}_amd64.AppImage`;
    writeFileSync(path.join(from, file), 'binary');
    writeFileSync(path.join(from, `${file}.sig`), 'SIGNATURE\n');
    writeFileSync(path.join(from, 'VTT Chat App_amd64.deb'), 'ignored');
    return { from, to, file };
  }

  it('copies signed artifacts and writes latest.json, trimming the signature', async () => {
    const { from, to, file } = release();
    const result = await publishUpdates({
      from,
      to,
      baseUrl: 'https://h/updates',
      version: '0.3.0',
      notes: 'n',
      now: () => new Date('2026-11-08T00:00:00Z'),
    });
    expect(result.platforms).toEqual(['linux-x86_64']);
    expect(existsSync(path.join(to, file))).toBe(true);
    expect(existsSync(path.join(to, 'VTT Chat App_amd64.deb'))).toBe(false);
    const latest = JSON.parse(readFileSync(path.join(to, 'latest.json'), 'utf8'));
    expect(latest.platforms['linux-x86_64'].signature).toBe('SIGNATURE');
    expect(latest.version).toBe('0.3.0');
  });

  it('refuses an artifact with no signature, a release with nothing to publish, and a bad URL', async () => {
    const { from, to, file } = release();
    mkdirSync(path.join(from, 'x'));
    writeFileSync(path.join(from, 'Other_0.3.0_x64-setup.exe'), 'unsigned');
    await expect(
      publishUpdates({ from, to, baseUrl: 'https://h/u', version: '0.3.0' }),
    ).rejects.toThrow(/no signature/);
    const empty = mkdtempSync(path.join(tmpdir(), 'empty-'));
    await expect(
      publishUpdates({ from: empty, to, baseUrl: 'https://h/u', version: '0.3.0' }),
    ).rejects.toThrow(/nothing to publish/);
    const ok = release();
    await expect(
      publishUpdates({ from: ok.from, to: ok.to, baseUrl: 'ftp://h', version: '0.3.0' }),
    ).rejects.toThrow(/base URL/);
    expect(file).toBeTruthy();
  });

  const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
  const pub = (r: { from: string; to: string }, version: string) =>
    publishUpdates({ from: r.from, to: r.to, baseUrl: 'https://h/updates', version });

  it('keeps dev builds in a dev/ folder and leaves the release feed alone', async () => {
    const r = release('0.4.0-dev.1');
    const result = await pub(r, '0.4.0-dev.1');
    expect(result.channel).toBe('dev');
    expect(existsSync(path.join(r.to, 'dev', r.file))).toBe(true);
    expect(existsSync(path.join(r.to, 'latest.json'))).toBe(false);
    const feed = read(path.join(r.to, 'dev', 'latest.json'));
    expect(feed.version).toBe('0.4.0-dev.1');
    expect(feed.platforms['linux-x86_64'].url).toBe(
      `https://h/updates/dev/${encodeURIComponent(r.file)}`,
    );
  });

  it('offers dev-channel players the newer of the latest dev build and the latest release', async () => {
    const r = release('0.4.0-dev.2');
    await pub(r, '0.4.0-dev.2');
    const rel = release('0.4.0');
    rel.to = r.to;
    expect((await pub(rel, '0.4.0')).channel).toBe('release');
    expect(read(path.join(r.to, 'latest.json')).version).toBe('0.4.0');
    expect(read(path.join(r.to, 'dev', 'latest.json')).version).toBe('0.4.0'); // the release outranks its dev builds
    const next = release('0.5.0-dev.1');
    next.to = r.to;
    await pub(next, '0.5.0-dev.1');
    expect(read(path.join(r.to, 'dev', 'latest.json')).version).toBe('0.5.0-dev.1');
    expect(read(path.join(r.to, 'latest.json')).version).toBe('0.4.0'); // releases-only players are untouched
  });

  it('does not let an older dev build replace what dev players are offered', async () => {
    const r = release('0.4.0');
    await pub(r, '0.4.0');
    const old = release('0.4.0-dev.1');
    old.to = r.to;
    await pub(old, '0.4.0-dev.1');
    expect(read(path.join(r.to, 'dev', 'latest.json')).version).toBe('0.4.0');
  });
});
