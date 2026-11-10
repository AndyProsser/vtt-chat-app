import type { Status } from './statusStore.js';

export const STATUS_LABELS: Record<Status, string> = {
  online: 'Online',
  away: 'Away',
  offline: 'Offline',
};

export const STATUSES: readonly Status[] = ['online', 'away', 'offline'];

/** One line saying what each status does, shown beside the choice. */
export const STATUS_HINTS: Record<Status, string> = {
  online: 'In voice, microphone as you left it',
  away: 'In voice, microphone closed until you return',
  offline: 'Out of voice; chat stays on',
};

/** Whether the microphone can be used at all: there is no voice to mute while Offline. */
export function micAvailable(status: Status): boolean {
  return status !== 'offline';
}

/** The minutes choices for automatic Away, 0 meaning never. */
export const AWAY_MINUTE_CHOICES = [0, 5, 10, 15, 30, 60] as const;

export function awayMinutesLabel(minutes: number): string {
  return minutes === 0 ? 'Never' : `After ${minutes} minutes`;
}
