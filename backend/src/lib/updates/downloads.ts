import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ClientDownloads } from '../config.js';

/** The file next to `latest.json` that the update sync writes: where a person installs the app from. */
export const DOWNLOADS_FILE = 'downloads.json';

const KEYS = ['windows', 'macos', 'linux', 'linuxDeb', 'linuxRpm'] as const;

/** Rank assets so the best single installer per slot wins (lower is better); undefined = not an installer. */
function rank(name: string): { slot: (typeof KEYS)[number]; score: number } | undefined {
  const n = name.toLowerCase();
  const arm = /aarch64|arm64/.test(n);
  if (n.endsWith('-setup.exe')) return { slot: 'windows', score: arm ? 2 : 0 };
  if (n.endsWith('.msi')) return { slot: 'windows', score: arm ? 3 : 1 };
  // Apple-silicon Macs are the common case; an Intel-only release falls through to the x64 build.
  if (n.endsWith('.dmg')) return { slot: 'macos', score: arm || /universal/.test(n) ? 0 : 1 };
  if (n.endsWith('.appimage')) return { slot: 'linux', score: arm ? 1 : 0 };
  if (n.endsWith('.deb')) return { slot: 'linuxDeb', score: arm ? 1 : 0 };
  if (n.endsWith('.rpm')) return { slot: 'linuxRpm', score: arm ? 1 : 0 };
  return undefined;
}

/**
 * The human-installable download per platform from a release's assets (Windows setup/MSI, macOS .dmg, Linux
 * AppImage plus .deb/.rpm). One link per slot: x64 Windows/Linux, Apple-silicon macOS where there is a choice.
 */
export function pickDownloads(
  assets: { name: string; browser_download_url: string }[],
): ClientDownloads {
  const best: Partial<Record<(typeof KEYS)[number], { score: number; url: string }>> = {};
  for (const asset of assets) {
    const r = rank(asset.name);
    if (!r) continue;
    const have = best[r.slot];
    if (!have || r.score < have.score)
      best[r.slot] = { score: r.score, url: asset.browser_download_url };
  }
  const out: ClientDownloads = {};
  for (const k of KEYS) if (best[k]) out[k] = best[k]!.url;
  return out;
}

/** Reads `downloads.json` from the updates dir; `{}` when absent, unreadable or not what we wrote. */
export async function readDownloadsFile(dir: string | undefined): Promise<ClientDownloads> {
  if (!dir) return {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(dir, DOWNLOADS_FILE), 'utf8'));
    const out: ClientDownloads = {};
    if (parsed && typeof parsed === 'object') {
      for (const k of KEYS) {
        const v = (parsed as Record<string, unknown>)[k];
        if (typeof v === 'string' && /^https?:\/\//.test(v)) out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Explicit `CLIENT_URL_*` values win, per platform; the synced file fills whatever they leave empty. */
export async function resolveDownloads(
  explicit: ClientDownloads,
  updatesDir: string | undefined,
): Promise<ClientDownloads> {
  const hasExplicit = Object.keys(explicit ?? {}).length > 0;
  const synced = await readDownloadsFile(updatesDir);
  // An operator who set any CLIENT_URL_* is choosing where players go; do not mix in GitHub links for the rest.
  return hasExplicit ? explicit : synced;
}
