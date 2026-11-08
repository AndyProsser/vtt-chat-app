/** An update the server offers, as `update_check` reports it. */
export interface UpdateInfo {
  version: string;
  current: string;
  notes: string | null;
}

/** One line for the banner: the versions, plus the first line of the release notes if any. */
export function updateMessage(info: UpdateInfo): string {
  const base = `Version ${info.version} is ready (you have ${info.current})`;
  const note = info.notes
    ?.split('\n')
    .find((l) => l.trim() !== '')
    ?.trim();
  return note ? `${base}: ${note}` : `${base}.`;
}
