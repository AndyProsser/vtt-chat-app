/** An update the server offers, as `update_check` reports it. */
export interface UpdateInfo {
  version: string;
  current: string;
  notes: string | null;
}

/**
 * One short line for the banner and for Settings: that an update exists, and nothing else. The release
 * notes are behind "More info" (`UpdateNotes`): a banner that carried their first paragraph took a
 * third of a small window.
 */
export function updateMessage(info: UpdateInfo): string {
  return `Version ${info.version} is available (you have ${info.current}).`;
}

/** Whether there are release notes worth a "More info" link. */
export function hasNotes(info: UpdateInfo): boolean {
  return (info.notes ?? '').trim() !== '';
}
