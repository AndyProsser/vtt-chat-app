import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatBytes, freePercent, isLow, measureDisk } from './storage.js';

describe('storage figures', () => {
  it('works out the free share and flags a nearly full disk', () => {
    expect(freePercent({ totalBytes: 1000, freeBytes: 250 })).toBe(25);
    expect(isLow({ totalBytes: 1000, freeBytes: 99 }, 10)).toBe(true);
    expect(isLow({ totalBytes: 1000, freeBytes: 100 }, 10)).toBe(false);
  });
  it('treats an unreadable (zero-size) disk as not low rather than raising a false alarm', () => {
    expect(freePercent({ totalBytes: 0, freeBytes: 0 })).toBe(100);
    expect(isLow({ totalBytes: 0, freeBytes: 0 }, 10)).toBe(false);
  });
  it('prints sizes people can read', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5.0 GB');
  });
});

describe('measureDisk', () => {
  it('reports the volume and, when asked, how much one folder holds', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'vtt-storage-'));
    await mkdir(path.join(dir, 'a'));
    await writeFile(path.join(dir, 'a', 'x.bin'), Buffer.alloc(100));
    await writeFile(path.join(dir, 'y.bin'), Buffer.alloc(50));
    const fake = async () => ({ bsize: 10, blocks: 1000, bavail: 400 });
    const use = await measureDisk(dir, { statfs: fake as never, walk: true });
    expect(use).toEqual({ totalBytes: 10_000, freeBytes: 4_000, dirBytes: 150 });
    const quick = await measureDisk(dir, { statfs: fake as never });
    expect(quick.dirBytes).toBeUndefined();
  });
  it('returns null for a folder that is not there', async () => {
    expect(await measureDisk('/definitely/not/here')).toBeNull();
  });
});
