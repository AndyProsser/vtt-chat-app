import { campaignFile } from './tauriBridge.js';

const cache = new Map<string, Promise<string>>();

/** A handout's picture as a data URL, fetched once per id for the life of the window. */
export function handoutPicture(id: string): Promise<string> {
  let found = cache.get(id);
  if (!found) {
    found = campaignFile(`handouts/${id}/file`);
    cache.set(id, found);
    found.catch(() => cache.delete(id)); // a failed fetch may be tried again
  }
  return found;
}
