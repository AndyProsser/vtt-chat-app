import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

/**
 * Copies every **signed** update artifact into `to` and writes `latest.json` pointing at this
 * server. An installer without a `.sig` is refused rather than skipped: publishing one silently
 * would leave some platform on an old build with no message saying why.
 */
export async function publishUpdates(options: PublishOptions): Promise<{ platforms: string[] }> {
  if (!/^https?:\/\//.test(options.baseUrl)) {
    throw new Error('the base URL must start with https:// (or http:// for a LAN server)');
  }
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
  await mkdir(options.to, { recursive: true });
  for (const a of artifacts)
    await copyFile(path.join(options.from, a.file), path.join(options.to, a.file));
  const latest = buildLatestJson({
    version: options.version,
    notes: options.notes ?? '',
    pubDate: (options.now ?? (() => new Date()))().toISOString(),
    baseUrl: options.baseUrl,
    artifacts,
  });
  await writeFile(path.join(options.to, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
  return { platforms: artifacts.map((a) => a.platform) };
}
