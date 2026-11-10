import { campaignFile } from './tauriBridge.js';

const cache = new Map<string, Promise<string>>();

/** Forget a handout's cached pictures (their positions changed, or one was removed). */
export function forgetHandoutPictures(id: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${id}:`)) cache.delete(key);
}

/** One of a handout's files as a data URL, fetched once per file for the life of the window. */
export function handoutPicture(id: string, index = 0): Promise<string> {
  const key = `${id}:${index}`;
  let found = cache.get(key);
  if (!found) {
    found = campaignFile(`handouts/${id}/files/${index}`);
    cache.set(key, found);
    found.catch(() => cache.delete(key)); // a failed fetch may be tried again
  }
  return found;
}
