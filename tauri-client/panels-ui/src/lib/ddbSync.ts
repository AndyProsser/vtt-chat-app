/** "just now", "5 minutes ago", "3 hours ago", "2 days ago": how stale a synced character is. */
export function syncedLabel(syncedAt: number | null, now: number): string {
  if (syncedAt === null) return 'Not synced yet';
  const minutes = Math.floor(Math.max(0, now - syncedAt) / 60_000);
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Synced ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} days ago`;
}

/** Whether the text could be a D&D Beyond character link (the server makes the real check). */
export const looksLikeSheetLink = (text: string): boolean =>
  /^\s*(\d{1,12}|https:\/\/(www\.)?dndbeyond\.com\/\S*characters\/\d{1,12}\S*)\s*$/i.test(text);
