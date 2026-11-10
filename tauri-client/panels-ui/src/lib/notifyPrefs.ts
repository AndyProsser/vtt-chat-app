/** What a player wants to hear about while the window is closed. Mirrors `notify_prefs.rs`. */
export interface QuietHours {
  /** Minutes after local midnight. A window may cross midnight (from 22:00 to 08:00). */
  from: number;
  to: number;
}

export interface NotifyPrefs {
  chat: boolean;
  whispers: boolean;
  table: boolean;
  sessions: boolean;
  quiet: QuietHours | null;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  chat: true,
  whispers: true,
  table: true,
  sessions: true,
  quiet: null,
};

export const minuteOf = (time: string): number => {
  const [h = '0', m = '0'] = time.split(':');
  return Number(h) * 60 + Number(m);
};

export const timeOf = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export const withQuiet = (p: NotifyPrefs): NotifyPrefs => ({
  ...p,
  quiet: { from: 22 * 60, to: 8 * 60 },
});

export const withoutQuiet = (p: NotifyPrefs): NotifyPrefs => ({ ...p, quiet: null });

export const quietLabel = (q: QuietHours): string => `${timeOf(q.from)} to ${timeOf(q.to)}`;
