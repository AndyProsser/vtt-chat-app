import type { Notification, Rsvp, ScheduledSession, ScheduleStore } from './scheduleStore.js';

const copy = <T>(v: T): T => structuredClone(v);

export class MemoryScheduleStore implements ScheduleStore {
  private sessions = new Map<string, ScheduledSession>();
  private rsvps = new Map<string, Rsvp>();
  private reminders = new Set<string>();
  private notifications: Notification[] = [];

  putSession = async (s: ScheduledSession) => void this.sessions.set(s.id, copy(s));
  getSession = async (id: string) => {
    const s = this.sessions.get(id);
    return s ? copy(s) : undefined;
  };
  listSessions = async (campaignId: string, from: number) =>
    [...this.sessions.values()]
      .filter((s) => s.campaignId === campaignId && s.startsAt >= from)
      .sort((a, b) => a.startsAt - b.startsAt)
      .map(copy);
  sessionsStartingBetween = async (from: number, to: number) =>
    [...this.sessions.values()]
      .filter((s) => s.cancelledAt === null && s.startsAt >= from && s.startsAt <= to)
      .sort((a, b) => a.startsAt - b.startsAt)
      .map(copy);

  putRsvp = async (r: Rsvp) => void this.rsvps.set(`${r.sessionId}:${r.userId}`, copy(r));
  listRsvps = async (sessionId: string) =>
    [...this.rsvps.values()].filter((r) => r.sessionId === sessionId).map(copy);

  clearReminders = async (sessionId: string) => {
    for (const key of [...this.reminders])
      if (key.startsWith(`${sessionId}:`)) this.reminders.delete(key);
  };

  claimReminder = async (sessionId: string, offsetMin: number) => {
    const key = `${sessionId}:${offsetMin}`;
    if (this.reminders.has(key)) return false;
    this.reminders.add(key);
    return true;
  };

  addNotification = async (n: Notification) => void this.notifications.push(copy(n));
  listNotifications = async (userId: string, o: { unreadOnly: boolean; limit: number }) =>
    this.notifications
      .filter((n) => n.userId === userId && (!o.unreadOnly || n.readAt === null))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-o.limit)
      .map(copy);
  markRead = async (userId: string, id: string, at: number) => {
    const n = this.notifications.find((x) => x.id === id && x.userId === userId);
    if (!n) return false;
    n.readAt ??= at;
    return true;
  };
  markAllRead = async (userId: string, at: number) => {
    let count = 0;
    for (const n of this.notifications)
      if (n.userId === userId && n.readAt === null) {
        n.readAt = at;
        count += 1;
      }
    return count;
  };
  unpushedNotifications = async (limit: number) =>
    this.notifications
      .filter((n) => n.pushedAt === null)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, limit)
      .map(copy);
  markPushed = async (ids: string[], at: number) => {
    for (const n of this.notifications) if (ids.includes(n.id)) n.pushedAt = at;
  };
}
