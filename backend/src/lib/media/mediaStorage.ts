import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type MediaKind = 'image' | 'pdf' | 'audio';

export interface DetectedMedia {
  kind: MediaKind;
  mime: string;
}

/**
 * What a file really is, from its first bytes — never from the name or the client's Content-Type.
 * Only these formats are accepted; anything else (HTML, SVG, scripts, executables) is rejected, so
 * an upload can never become something a browser would run.
 */
export function detectMedia(b: Buffer): DetectedMedia | undefined {
  const starts = (...bytes: number[]): boolean => bytes.every((v, i) => b[i] === v);
  const ascii = (offset: number, text: string): boolean =>
    b.subarray(offset, offset + text.length).toString('latin1') === text;
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
    return { kind: 'image', mime: 'image/png' };
  if (starts(0xff, 0xd8, 0xff)) return { kind: 'image', mime: 'image/jpeg' };
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { kind: 'image', mime: 'image/gif' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', mime: 'image/webp' };
  if (ascii(0, '%PDF-')) return { kind: 'pdf', mime: 'application/pdf' };
  if (ascii(0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' };
  if (ascii(0, 'fLaC')) return { kind: 'audio', mime: 'audio/flac' };
  if (ascii(0, 'ID3') || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0))
    return { kind: 'audio', mime: 'audio/mpeg' };
  return undefined;
}

/** Where file bytes live. Metadata and permissions are in the database; this only holds bytes by id. */
export interface MediaStorage {
  put(id: string, bytes: Buffer): Promise<void>;
  get(id: string): Promise<Buffer | undefined>;
  delete(id: string): Promise<void>;
}

const SAFE_ID = /^[0-9a-fA-F-]{8,64}$/;

/** Files in a directory, named by id. Ids are validated so a name can never escape the directory. */
export class DiskMediaStorage implements MediaStorage {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error('invalid media id');
    return path.join(this.dir, id);
  }

  async put(id: string, bytes: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(id), bytes, { mode: 0o640 });
  }

  async get(id: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.file(id));
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await rm(this.file(id), { force: true });
  }
}

export class MemoryMediaStorage implements MediaStorage {
  readonly files = new Map<string, Buffer>();
  put = async (id: string, bytes: Buffer): Promise<void> =>
    void this.files.set(id, Buffer.from(bytes));
  get = async (id: string): Promise<Buffer | undefined> => this.files.get(id);
  delete = async (id: string): Promise<void> => void this.files.delete(id);
}
