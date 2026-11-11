import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { mirrorUsage, syncUpdates, type SyncOptions } from './sync.js';

const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name);
const publicKey = (await readFile(fixture('test.pub'), 'utf8')).trim();
const goodSig = (await readFile(fixture('sample.bin.sig'), 'utf8')).trim();
const goodFile = await readFile(fixture('sample.bin'));

interface FakeRelease {
  tag: string;
  prerelease?: boolean;
  draft?: boolean;
  /** Serve a file that the signature does not cover. */
  tampered?: boolean;
  noInstaller?: boolean;
  /** Only the Linux files are up (the other platforms' builds have not finished uploading yet). */
  partial?: boolean;
}

/** A GitHub that lists the given releases, each with one Linux installer and its signature. */
function fakeGithub(releases: FakeRelease[]): typeof fetch {
  const asset = (r: FakeRelease) => `VTT.Chat_${r.tag.slice(1)}_amd64.AppImage`;
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/releases?')) {
      const body = releases.map((r) => ({
        tag_name: r.tag,
        draft: !!r.draft,
        prerelease: !!r.prerelease,
        body: `notes for ${r.tag}`,
        published_at: '2026-11-11T00:00:00Z',
        assets: r.noInstaller
          ? []
          : [
              {
                name: asset(r),
                browser_download_url: `https://dl.test/${r.tag}/${asset(r)}`,
                size: 1,
              },
              // human installers: unsigned, never in the updater feed, but offered as downloads
              ...(r.partial
                ? ['VTT.Chat_amd64.deb']
                : ['VTT.Chat_x64-setup.exe', 'VTT.Chat_aarch64.dmg', 'VTT.Chat_amd64.deb']
              ).map((n) => ({
                name: n,
                browser_download_url: `https://dl.test/${r.tag}/${n}`,
                size: 1,
              })),
              {
                name: `${asset(r)}.sig`,
                browser_download_url: `https://dl.test/${r.tag}/${asset(r)}.sig`,
                size: 1,
              },
            ],
      }));
      return new Response(JSON.stringify(body));
    }
    const tag = /dl\.test\/([^/]+)\//.exec(url)![1]!;
    const release = releases.find((r) => r.tag === tag)!;
    if (url.endsWith('.sig')) return new Response(goodSig);
    return new Response(release.tampered ? Buffer.from('not what was signed') : goodFile);
  }) as typeof fetch;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'updates-sync-'));
});

const base = (over: Partial<SyncOptions>): SyncOptions => ({
  source: 'github',
  repo: 'o/r',
  line: '0.3',
  dir,
  baseUrl: 'https://play.test/updates',
  publicKey,
  ...over,
});
const manifest = async (rel = 'latest.json') =>
  JSON.parse(await readFile(path.join(dir, rel), 'utf8')) as {
    version: string;
    platforms: Record<string, { url: string }>;
  };

describe('syncUpdates, github source', () => {
  it('offers the newest patch of the server line and points players at GitHub', async () => {
    const result = await syncUpdates(
      base({
        fetchImpl: fakeGithub([
          { tag: 'v0.4.0' }, // a different minor: never offered
          { tag: 'v0.3.1' },
          { tag: 'v0.3.3' },
          { tag: 'v0.3.4', draft: true }, // not published yet
          { tag: 'v0.3.5-dev.1', prerelease: true }, // dev builds are off
          { tag: 'v0.3.2' },
        ]),
      }),
    );
    expect(result.release).toBe('0.3.3');
    const m = await manifest();
    expect(m.version).toBe('0.3.3');
    expect(m.platforms['linux-x86_64']!.url).toBe(
      'https://dl.test/v0.3.3/VTT.Chat_0.3.3_amd64.AppImage',
    );
    expect(await readdir(dir)).not.toContain('v'); // nothing stored
  });

  it('records the installable download per platform for the release it offers', async () => {
    await syncUpdates(base({ fetchImpl: fakeGithub([{ tag: 'v0.3.1' }, { tag: 'v0.3.3' }]) }));
    expect(JSON.parse(await readFile(path.join(dir, 'downloads.json'), 'utf8'))).toEqual({
      windows: 'https://dl.test/v0.3.3/VTT.Chat_x64-setup.exe',
      macos: 'https://dl.test/v0.3.3/VTT.Chat_aarch64.dmg',
      linux: 'https://dl.test/v0.3.3/VTT.Chat_0.3.3_amd64.AppImage',
      linuxDeb: 'https://dl.test/v0.3.3/VTT.Chat_amd64.deb',
    });
  });

  it("uses the dev build's installers for downloads when the line has no stable release yet", async () => {
    await syncUpdates(
      base({
        fetchImpl: fakeGithub([{ tag: 'v0.3.3-dev.1', prerelease: true }]),
        includeDev: true,
      }),
    );
    const downloads = JSON.parse(await readFile(path.join(dir, 'downloads.json'), 'utf8'));
    expect(downloads.linux).toContain('v0.3.3-dev.1');
  });

  it('does not offer a release whose other platforms are still uploading, and keeps the previous one', async () => {
    const result = await syncUpdates(
      base({ fetchImpl: fakeGithub([{ tag: 'v0.3.2' }, { tag: 'v0.3.3', partial: true }]) }),
    );
    expect(result.release).toBe('0.3.2');
    expect(result.skipped.join(' ')).toContain('still uploading');
    expect((await manifest()).version).toBe('0.3.2');
  });

  it('leaves the current feed alone when GitHub has nothing on this line', async () => {
    await writeFile(path.join(dir, 'latest.json'), '{"version":"0.3.0","platforms":{}}');
    const result = await syncUpdates(base({ fetchImpl: fakeGithub([{ tag: 'v0.4.0' }]) }));
    expect(result.release).toBeUndefined();
    expect((await manifest()).version).toBe('0.3.0');
  });

  it('offers a dev build to the dev feed only when asked, and only if newer than the release', async () => {
    const releases = [{ tag: 'v0.3.2' }, { tag: 'v0.3.3-dev.2', prerelease: true }];
    await syncUpdates(base({ fetchImpl: fakeGithub(releases), includeDev: true }));
    expect((await manifest()).version).toBe('0.3.2');
    expect((await manifest('dev/latest.json')).version).toBe('0.3.3-dev.2');
    const off = await mkdtemp(path.join(tmpdir(), 'updates-sync-'));
    await syncUpdates(base({ dir: off, fetchImpl: fakeGithub(releases) }));
    expect(JSON.parse(await readFile(path.join(off, 'dev/latest.json'), 'utf8')).version).toBe(
      '0.3.2',
    );
  });

  it('falls back to the previous patch when the newest has no installers yet', async () => {
    const result = await syncUpdates(
      base({ fetchImpl: fakeGithub([{ tag: 'v0.3.3', noInstaller: true }, { tag: 'v0.3.2' }]) }),
    );
    expect(result.release).toBe('0.3.2');
    expect(result.skipped[0]).toContain('0.3.3');
  });
});

describe('syncUpdates, mirror source', () => {
  it('downloads, verifies and serves from this server', async () => {
    const result = await syncUpdates(
      base({ source: 'mirror', fetchImpl: fakeGithub([{ tag: 'v0.3.3' }]) }),
    );
    expect(result.downloaded).toEqual(['0.3.3/VTT.Chat_0.3.3_amd64.AppImage']);
    expect((await manifest()).platforms['linux-x86_64']!.url).toBe(
      'https://play.test/updates/v/0.3.3/VTT.Chat_0.3.3_amd64.AppImage',
    );
    expect(await readFile(path.join(dir, 'v/0.3.3/VTT.Chat_0.3.3_amd64.AppImage'))).toEqual(
      goodFile,
    );
  });

  it('refuses a file that does not verify, stores nothing, and keeps offering the last good one', async () => {
    const github = fakeGithub([{ tag: 'v0.3.2' }]);
    await syncUpdates(base({ source: 'mirror', fetchImpl: github }));
    const result = await syncUpdates(
      base({
        source: 'mirror',
        fetchImpl: fakeGithub([{ tag: 'v0.3.3', tampered: true }, { tag: 'v0.3.2' }]),
      }),
    );
    expect(result.skipped[0]).toContain('does not verify');
    expect(result.release).toBe('0.3.2');
    expect(await readdir(path.join(dir, 'v'))).toEqual(['0.3.2']);
    expect(await readdir(path.join(dir, 'v/0.3.2'))).toEqual(['VTT.Chat_0.3.2_amd64.AppImage']); // no .part left
  });

  it('keeps the newest patch plus one previous and deletes the rest', async () => {
    const releases = [{ tag: 'v0.3.3' }, { tag: 'v0.3.2' }, { tag: 'v0.3.1' }];
    await syncUpdates(base({ source: 'mirror', fetchImpl: fakeGithub([releases[2]!]) }));
    let result = await syncUpdates(
      base({ source: 'mirror', fetchImpl: fakeGithub([releases[1]!, releases[2]!]) }),
    );
    expect(result.removed).toEqual([]); // two versions: both kept
    result = await syncUpdates(base({ source: 'mirror', fetchImpl: fakeGithub(releases) }));
    expect(result.removed).toEqual(['0.3.1']);
    expect((await readdir(path.join(dir, 'v'))).sort()).toEqual(['0.3.2', '0.3.3']);
    // GitHub dropping the old release does not delete the rollback copy
    await syncUpdates(base({ source: 'mirror', fetchImpl: fakeGithub([releases[0]!]) }));
    expect((await readdir(path.join(dir, 'v'))).sort()).toEqual(['0.3.2', '0.3.3']);
    const usage = await mirrorUsage(dir);
    expect(usage.versions).toEqual(['0.3.3', '0.3.2']);
    expect(usage.bytes).toBe(goodFile.length * 2);
  });

  it('needs the public URL', async () => {
    await expect(
      syncUpdates(base({ source: 'mirror', baseUrl: '', fetchImpl: fakeGithub([]) })),
    ).rejects.toThrow(/PUBLIC_URL/);
  });
});
