import { avatarImage } from './tauriBridge.js';

const MAX_CACHED = 64;
const cache = new Map<string, Promise<string>>();

/**
 * A portrait as a `data:` URL, fetched once through Rust. The cache is bounded (oldest dropped first),
 * and a failed fetch is forgotten so the next look tries again.
 */
export function loadAvatar(id: string): Promise<string> {
  const hit = cache.get(id);
  if (hit) return hit;
  const pending = avatarImage(id);
  cache.set(id, pending);
  pending.catch(() => cache.delete(id));
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  return pending;
}

/** Shrinks a picked file to a square of `size` pixels (centre crop) and returns it as base64 PNG. */
export async function shrinkToSquare(file: Blob, size = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('this window cannot resize pictures');
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
