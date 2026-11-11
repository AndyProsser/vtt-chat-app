import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { DOWNLOADS_FILE, pickDownloads } from './downloads.js';
import { verifyMinisign } from './minisign.js';
import { platformOf, type LatestJson } from './publish.js';
import { compareVersions, isDevVersion } from './version.js';

/**
 * Keeps the server's `/updates` feed in step with the releases on GitHub, so nobody has to run
 * `vtt-admin updates publish` by hand. Design and rationale: docs/architecture/VERSIONING-AND-DEPLOYMENT.md §2.
 *
 * - Only releases on the server's own MAJOR.MINOR are offered (`line`, e.g. "0.3"): the newest patch of it.
 *   Patches are approved automatically; a new MAJOR.MINOR is a deliberate server upgrade, never offered here.
 * - `github`: the manifest points players at the GitHub downloads. Nothing is stored here.
 * - `mirror`: installers are downloaded, checked against the updater key, and served by this server. Only the
 *   newest patch and one previous are kept.
 */
export interface SyncOptions {
  source: 'github' | 'mirror';
  /** `owner/name` of the GitHub repository that publishes releases. */
  repo: string;
  /** The server's MAJOR.MINOR, e.g. "0.3". */
  line: string;
  /** `UPDATES_DIR`. */
  dir: string;
  /** Where this server serves `dir`, e.g. `https://play.example.com/updates`. Required for `mirror`. */
  baseUrl?: string;
  /** Also offer dev builds (`-dev.N`) of this line to players who opted in. */
  includeDev?: boolean;
  /** The updater public key from `tauri.conf.json`; mirrored files must verify against it. */
  publicKey: string;
  /** Versions kept in the mirror per channel, newest first. Default 2 (newest patch plus one for rollback). */
  keep?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface SyncResult {
  release?: string;
  dev?: string;
  downloaded: string[];
  removed: string[];
  /** Releases that matched but could not be offered, and why (a bad signature, a missing installer). */
  skipped: string[];
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  body: string | null;
  published_at: string | null;
  assets: GithubAsset[];
}

const SEMVER = /^v?(\d+)\.(\d+)\.\d+/;

export async function syncUpdates(options: SyncOptions): Promise<SyncResult> {
  const get = options.fetchImpl ?? fetch;
  const result: SyncResult = { downloaded: [], removed: [], skipped: [] };
  if (options.source === 'mirror' && !options.baseUrl) {
    throw new Error('UPDATES_SOURCE=mirror needs the public /updates URL (PUBLIC_URL)');
  }

  const response = await get(`https://api.github.com/repos/${options.repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vtt-chat-server' },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} listing releases`);
  const all = (await response.json()) as GithubRelease[];

  const onLine = all
    .filter((r) => !r.draft && SEMVER.test(r.tag_name))
    .filter((r) => {
      const m = SEMVER.exec(r.tag_name)!;
      return `${m[1]}.${m[2]}` === options.line;
    })
    .map((r) => ({ release: r, version: r.tag_name.replace(/^v/, '') }))
    .sort((a, b) => compareVersions(b.version, a.version));

  const releases = onLine.filter((x) => !isDevVersion(x.version) && !x.release.prerelease);
  const devs = options.includeDev
    ? onLine.filter((x) => isDevVersion(x.version) && x.release.prerelease)
    : [];

  const manifests: { release?: LatestJson; dev?: LatestJson } = {};
  let releaseAssets: GithubAsset[] = [];
  let devAssets: GithubAsset[] = [];
  const kept = new Set<string>();

  // Newest first; the first one that can be offered in full wins, so a release missing an installer or failing
  // verification does not block the previous patch from being offered.
  const pick = async (candidates: typeof onLine, channel: 'release' | 'dev') => {
    for (const c of candidates) {
      try {
        // A release is created on GitHub before the last platform's build has uploaded its files. Offering it then
        // would hide the update (and the download) from whoever is still missing, so wait until all three
        // installers exist; the previous release stays offered meanwhile.
        const found = pickDownloads(c.release.assets);
        const missing = (['windows', 'macos', 'linux'] as const).filter((k) => !found[k]);
        if (missing.length > 0) {
          result.skipped.push(
            `${c.version}: still uploading (no ${missing.join(', ')} installer yet)`,
          );
          continue;
        }
        const manifest = await manifestFor(c.release, c.version, options, get, result);
        if (manifest) {
          manifests[channel] = manifest;
          if (channel === 'release') releaseAssets = c.release.assets;
          else devAssets = c.release.assets;
          return c.version;
        }
        result.skipped.push(`${c.version}: no signed installers`);
      } catch (error) {
        result.skipped.push(
          `${c.version}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return undefined;
  };
  const releaseVersion = await pick(releases, 'release');
  // A dev build is only worth offering if it is newer than the release (a release outranks its own dev builds).
  const newerDevs = devs.filter(
    (d) => !releaseVersion || compareVersions(d.version, releaseVersion) > 0,
  );
  const devVersion = await pick(newerDevs.slice(0, 1), 'dev');

  if (releaseVersion) result.release = releaseVersion;
  if (devVersion) result.dev = devVersion;

  if (manifests.release)
    await writeAtomic(path.join(options.dir, 'latest.json'), manifests.release);
  // Where a person installs the app from (the landing page's download buttons). GitHub links in both modes: the
  // mirror holds only the signed updater files, and the installers are public there anyway.
  // With no stable release yet (a line that only has dev builds, and the operator opted in), the dev build's
  // installers are what a new player can get.
  if (manifests.release || manifests.dev) {
    const assets = manifests.release ? releaseAssets : devAssets;
    await writeAtomic(path.join(options.dir, DOWNLOADS_FILE), pickDownloads(assets));
  }
  const devFeed = manifests.dev ?? manifests.release;
  if (devFeed) await writeAtomic(path.join(options.dir, 'dev', 'latest.json'), devFeed);

  if (options.source === 'mirror') {
    // Keep the newest `keep` mirrored releases (judged by what is stored, not by what GitHub still lists, so a
    // rollback copy survives GitHub dropping its release), plus the dev build being offered.
    const mirrored = new Set(await mirroredVersions(options.dir));
    const keep = options.keep ?? 2;
    const keepVersions = [...mirrored]
      .filter((v) => !isDevVersion(v))
      .sort((x, y) => compareVersions(y, x))
      .slice(0, keep);
    if (releaseVersion && !keepVersions.includes(releaseVersion)) keepVersions.push(releaseVersion);
    if (devVersion) keepVersions.push(devVersion);
    for (const v of keepVersions) kept.add(v);
    for (const v of mirrored) {
      if (kept.has(v)) continue;
      await rm(versionDir(options.dir, v), { recursive: true, force: true });
      result.removed.push(v);
    }
  }
  return result;
}

const versionDir = (dir: string, version: string) => path.join(dir, 'v', version);

async function mirroredVersions(dir: string): Promise<string[]> {
  try {
    return (await readdir(path.join(dir, 'v'), { withFileTypes: true }))
      .filter((e) => e.isDirectory() && SEMVER.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

async function manifestFor(
  release: GithubRelease,
  version: string,
  options: SyncOptions,
  get: typeof fetch,
  result: SyncResult,
): Promise<LatestJson | undefined> {
  const platforms: LatestJson['platforms'] = {};
  const base = options.baseUrl?.replace(/\/+$/, '');
  for (const asset of release.assets) {
    const platform = platformOf(asset.name);
    const sigAsset = release.assets.find((a) => a.name === `${asset.name}.sig`);
    if (!platform || !sigAsset) continue;
    const sigResponse = await get(sigAsset.browser_download_url);
    if (!sigResponse.ok) throw new Error(`could not read ${sigAsset.name} (${sigResponse.status})`);
    const signature = (await sigResponse.text()).trim();
    if (options.source === 'github') {
      platforms[platform] = { signature, url: asset.browser_download_url };
      continue;
    }
    const folder = versionDir(options.dir, version);
    const target = path.join(folder, asset.name);
    if (!(await exists(target))) {
      await mkdir(folder, { recursive: true });
      const partial = `${target}.part`;
      try {
        const download = await get(asset.browser_download_url);
        if (!download.ok || !download.body) {
          throw new Error(`could not download ${asset.name} (${download.status})`);
        }
        await pipeline(Readable.fromWeb(download.body as never), createWriteStream(partial));
        if (!(await verifyMinisign(options.publicKey, signature, partial))) {
          throw new Error(`${asset.name} does not verify against the updater key; not stored`);
        }
        await rename(partial, target);
        result.downloaded.push(`${version}/${asset.name}`);
      } catch (error) {
        await rm(partial, { force: true });
        // Do not leave an empty version folder behind: it would look like a mirrored version.
        if ((await readdir(folder)).length === 0)
          await rm(folder, { recursive: true, force: true });
        throw error;
      }
    }
    platforms[platform] = {
      signature,
      url: `${base}/v/${encodeURIComponent(version)}/${encodeURIComponent(asset.name)}`,
    };
  }
  if (Object.keys(platforms).length === 0) return undefined;
  return {
    version,
    notes: release.body ?? '',
    pub_date: release.published_at ?? (options.now ?? (() => new Date()))().toISOString(),
    platforms,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Write then rename, so a player never reads half a manifest. */
async function writeAtomic(file: string, manifest: object): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(temp, file);
}

/** What the mirror holds, for `vtt-admin updates status`. */
export async function mirrorUsage(dir: string): Promise<{ versions: string[]; bytes: number }> {
  const versions = (await mirroredVersions(dir)).sort(compareVersions).reverse();
  let bytes = 0;
  for (const v of versions) {
    for (const f of await readdir(versionDir(dir, v))) {
      bytes += (await stat(path.join(versionDir(dir, v), f))).size;
    }
  }
  return { versions, bytes };
}
