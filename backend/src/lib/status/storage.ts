import { readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';

/** The volume a folder lives on. `dirBytes` is only filled when the caller asked for a walk. */
export interface DiskUse {
  totalBytes: number;
  freeBytes: number;
  dirBytes?: number;
}

/** Below this share of free space the status page says storage is low. */
export const LOW_FREE_PERCENT = 10;

export const freePercent = (u: Pick<DiskUse, 'totalBytes' | 'freeBytes'>): number =>
  u.totalBytes > 0 ? Math.round((u.freeBytes / u.totalBytes) * 100) : 100;

export const isLow = (
  u: Pick<DiskUse, 'totalBytes' | 'freeBytes'>,
  warnPercent = LOW_FREE_PERCENT,
): boolean => u.totalBytes > 0 && (u.freeBytes / u.totalBytes) * 100 < warnPercent;

export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return i === 0 ? `${n} B` : `${value.toFixed(1)} ${units[i]}`;
}

async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await folderBytes(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

/** Free and total space of the volume holding `dir`; null when it cannot be read. */
export async function measureDisk(
  dir: string,
  options: { statfs?: typeof statfs; walk?: boolean } = {},
): Promise<DiskUse | null> {
  try {
    const fs = await (options.statfs ?? statfs)(dir);
    const use: DiskUse = {
      totalBytes: Number(fs.blocks) * Number(fs.bsize),
      freeBytes: Number(fs.bavail) * Number(fs.bsize),
    };
    if (options.walk) use.dirBytes = await folderBytes(dir);
    return use;
  } catch {
    return null;
  }
}
