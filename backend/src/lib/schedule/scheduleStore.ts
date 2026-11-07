export interface ScheduledSession {
  id: string;
  campaignId: string;
  /** UTC epoch milliseconds. */
  startsAt: number;
  title: string;
  notes: string;
  createdBy: string | null;
  createdAt: number;
  cancelledAt: number | null;
}

export type RsvpStatus = 'yes' | 'late' | 'no';

export interface Rsvp {
  sessionId: string;
  userId: string;
  status: RsvpStatus;
  updatedAt: number;
}

export interface Notification {
  id: string;
  userId: string;
  campaignId: string | null;
  /** e.g. `session.scheduled`, `session.reminder`, `summary.ready`. */
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  createdAt: number;
  readAt: number | null;
  pushedAt: number | null;
}

/** Schedule, RSVPs, reminders and stored notifications. Postgres is the real one. */
export interface ScheduleStore {
  putSession(session: ScheduledSession): Promise<void>;
  getSession(id: string): Promise<ScheduledSession | undefined>;
  /** A campaign's sessions starting at or after `from`, soonest first (cancelled ones included, marked). */
  listSessions(campaignId: string, from: number): Promise<ScheduledSession[]>;
  /** Every not-cancelled session starting in `[from, to]`, across campaigns, for the reminder scheduler. */
  sessionsStartingBetween(from: number, to: number): Promise<ScheduledSession[]>;

  putRsvp(rsvp: Rsvp): Promise<void>;
  listRsvps(sessionId: string): Promise<Rsvp[]>;

  /** Forget which reminders were sent (the session was rescheduled, so they apply afresh). */
  clearReminders(sessionId: string): Promise<void>;
  /** Claims a reminder slot exactly once: `true` for the first caller, `false` ever after. */
  claimReminder(sessionId: string, offsetMin: number, at: number): Promise<boolean>;

  addNotification(n: Notification): Promise<void>;
  /** A user's newest notifications, oldest first; `unreadOnly` keeps just the unread. */
  listNotifications(
    userId: string,
    options: { unreadOnly: boolean; limit: number },
  ): Promise<Notification[]>;
  markRead(userId: string, id: string, at: number): Promise<boolean>;
  markAllRead(userId: string, at: number): Promise<number>;
  /** Not yet sent to a live socket, oldest first. */
  unpushedNotifications(limit: number): Promise<Notification[]>;
  markPushed(ids: string[], at: number): Promise<void>;
}
