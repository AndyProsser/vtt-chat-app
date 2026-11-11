import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { compareVersions, isDevVersion } from './version.js';

/** Platforms the Tauri updater understands, e.g. `linux-x86_64`. */
export type UpdaterPlatform = string;

const arch = (name: string, aarch64: RegExp, x64: RegExp): 'aarch64' | 'x86_64' | undefined =>
  aarch64.test(name) ? 'aarch64' : x64.test(name) ? 'x86_64' : undefined;

/**
 * The updater platform a bundler artifact is for, or `undefined` for files that are not updates
 * (a `.deb`, notes, signatures). What Tauri v2 signs: the AppImage on Linux, the NSIS setup or MSI
 * on Windows, the `.app.tar.gz` on macOS.
 */
export function platformOf(file: string): UpdaterPlatform | undefined {
  const name = file.toLowerCase();
  if (name.endsWith('.appimage')) {
    const a = arch(name, /aarch64|arm64/, /amd64|x86_64|x64/);
    return a ? `linux-${a}` : undefined;
  }
  if (name.endsWith('-setup.exe') || name.endsWith('.msi')) {
    const a = arch(name, /aarch64|arm64/, /x64|amd64|x86_64/);
    return a ? `windows-${a}` : undefined;
  }
  if (name.endsWith('.app.tar.gz')) {
    return `darwin-${arch(name, /aarch64|arm64/, /.^/) ?? 'x86_64'}`;
  }
  return undefined;
}

export interface Artifact {
  platform: UpdaterPlatform;
  file: string;
  signature: string;
}

export interface LatestJson {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<UpdaterPlatform, { signature: string; url: string }>;
}

/** The static manifest the Tauri updater reads (`latest.json`). */
export function buildLatestJson(input: {
  version: string;
  notes: string;
  pubDate: string;
  baseUrl: string;
  artifacts: Artifact[];
}): LatestJson {
  const base = input.baseUrl.replace(/\/+$/, '');
  const platforms: LatestJson['platforms'] = {};
  for (const a of input.artifacts) {
    platforms[a.platform] = {
      signature: a.signature,
      url: `${base}/${encodeURIComponent(a.file)}`,
    };
  }
  return { version: input.version, notes: input.notes, pub_date: input.pubDate, platforms };
}

export interface PublishOptions {
  /** The bundler's output directory: installers with `.sig` files beside them. */
  from: string;
  /** `UPDATES_DIR`. */
  to: string;
  /** Where this server serves `to` from, e.g. `https://play.example.com/updates`. */
  baseUrl: string;
  version: string;
  notes?: string;
  now?: () => Date;
}

async function readManifest(file: string): Promise<LatestJson | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as LatestJson;
  } catch {
    return undefined;
  }
}

/**
 * Copies every **signed** update artifact into `to` and writes the manifest pointing at this server.
 * An installer without a `.sig` is refused rather than skipped: publishing one silently would leave
 * some platform on an old build with no message saying why.
 *
 * Two channels, chosen by the version name (a `-suffix` such as `0.4.0-dev.2` or `0.4.0-rc.1` is a dev
 * build): releases go to `to/latest.json`, which every player reads; dev builds go to `to/dev/`, and
 * `to/dev/latest.json` is what players who opted in to dev builds read. That feed always holds the newer
 * of the latest dev build and the latest release, so someone on dev builds still moves up to the release.
 */
export async function publishUpdates(
  options: PublishOptions,
): Promise<{ platforms: string[]; channel: 'release' | 'dev' }> {
  if (!/^https?:\/\//.test(options.baseUrl)) {
    throw new Error('the base URL must start with https:// (or http:// for a LAN server)');
  }
  const channel = isDevVersion(options.version) ? 'dev' : 'release';
  const names = await readdir(options.from);
  const artifacts: Artifact[] = [];
  for (const file of names) {
    const platform = platformOf(file);
    if (!platform) continue;
    if (!names.includes(`${file}.sig`)) {
      throw new Error(`${file} has no signature (${file}.sig); build with the signing key set`);
    }
    const signature = (await readFile(path.join(options.from, `${file}.sig`), 'utf8')).trim();
    artifacts.push({ platform, file, signature });
  }
  if (artifacts.length === 0) {
    throw new Error(`nothing to publish in ${options.from}: no signed installers found`);
  }
  const folder = channel === 'dev' ? path.join(options.to, 'dev') : options.to;
  await mkdir(folder, { recursive: true });
  for (const a of artifacts)
    await copyFile(path.join(options.from, a.file), path.join(folder, a.file));
  const base = options.baseUrl.replace(/\/+$/, '');
  const latest = buildLatestJson({
    version: options.version,
    notes: options.notes ?? '',
    pubDate: (options.now ?? (() => new Date()))().toISOString(),
    baseUrl: channel === 'dev' ? `${base}/dev` : base,
    artifacts,
  });
  const text = `${JSON.stringify(latest, null, 2)}\n`;
  const devDir = path.join(options.to, 'dev');
  if (channel === 'release') {
    await writeFile(path.join(options.to, 'latest.json'), text);
  } else {
    await writeFile(path.join(devDir, 'build.json'), text);
  }
  // The dev feed: the newer of the latest dev build and the latest release.
  const release = await readManifest(path.join(options.to, 'latest.json'));
  const build = await readManifest(path.join(devDir, 'build.json'));
  const offered = [release, build].filter((m): m is LatestJson => m !== undefined);
  const best = offered.sort((x, y) => compareVersions(y.version, x.version))[0];
  if (best) {
    await mkdir(devDir, { recursive: true });
    await writeFile(path.join(devDir, 'latest.json'), `${JSON.stringify(best, null, 2)}\n`);
  }
  return { platforms: artifacts.map((a) => a.platform), channel };
}
