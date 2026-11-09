import { randomUUID } from 'node:crypto';

import type { User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import type {
  Notification,
  Rsvp,
  RsvpStatus,
  ScheduledSession,
  ScheduleStore,
} from './scheduleStore.js';

const MINUTE = 60_000;
const TWO_YEARS = 2 * 365 * 24 * 60 * MINUTE;

/** When reminders go out, in minutes before a session. */
export const REMINDER_OFFSETS_MIN = [24 * 60, 60];
/** A reminder whose moment has passed by more than this is skipped, not sent late ("starts in 24 h" an hour before). */
export const REMINDER_GRACE_MIN = 10;

export interface ScheduleDeps {
  store: Store;
  schedule: ScheduleStore;
  now?: () => number;
  newId?: () => string;
  /** Called after notifications are stored, so live sockets can be told straight away. */
  onNotified?: () => void;
}

export interface SessionView {
  session: ScheduledSession;
  rsvps: { userId: string; status: RsvpStatus }[];
  counts: Record<RsvpStatus, number>;
  mine: RsvpStatus | null;
}

/**
 * Session scheduling, RSVPs and the notifications that carry them. The DM schedules, reschedules and
 * cancels; every member can RSVP (can make it / late / can't) and sees how the table answered.
 * Times are UTC epoch milliseconds; clients show them in the viewer's local time.
 */
/** A session is assumed to run three hours unless the DM says otherwise. */
export const DEFAULT_DURATION_MINUTES = 180;

/** How long after a session starts people may still change their answer. */
const RSVP_WINDOW_AFTER_START_MS = 4 * 60 * MINUTE;

export class ScheduleService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: ScheduleDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  private async role(user: User, campaignId: string): Promise<'dm' | 'player'> {
    const m = await this.deps.store.getMembership(campaignId, user.id);
    if (!m) throw new DomainError('forbidden', 'not a member of this campaign');
    return m.role;
  }

  private async requireDm(user: User, campaignId: string): Promise<void> {
    if ((await this.role(user, campaignId)) !== 'dm')
      throw new DomainError('forbidden', 'only the DM can do that');
  }

  /** Stores a notification for each person. Never throws into the caller's request. */
  async notify(
    userIds: string[],
    n: {
      campaignId: string | null;
      kind: string;
      title: string;
      body?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<void> {
    const at = this.now();
    for (const userId of new Set(userIds)) {
      await this.deps.schedule.addNotification({
        id: this.newId(),
        userId,
        campaignId: n.campaignId,
        kind: n.kind,
        title: n.title,
        body: n.body ?? '',
        data: n.data ?? {},
        createdAt: at,
        readAt: null,
        pushedAt: null,
      });
    }
    this.deps.onNotified?.();
  }

  private async memberIds(campaignId: string, except?: string): Promise<string[]> {
    return (await this.deps.store.listMemberships(campaignId))
      .map((m) => m.userId)
      .filter((id) => id !== except);
  }

  private check(
    input: { startsAt?: number; durationMinutes?: number; title?: string; notes?: string },
    creating: boolean,
  ): void {
    const d = input.durationMinutes;
    if (d !== undefined && (!Number.isInteger(d) || d < 15 || d > 720)) {
      throw new DomainError('invalid_input', 'a session runs from 15 minutes to 12 hours');
    }
    if (creating || input.startsAt !== undefined) {
      const t = input.startsAt;
      if (typeof t !== 'number' || !Number.isFinite(t))
        throw new DomainError('invalid_input', 'startsAt is required');
      if (t < this.now() - 5 * MINUTE)
        throw new DomainError('invalid_input', 'that time has already passed');
      if (t > this.now() + TWO_YEARS)
        throw new DomainError('invalid_input', 'that is too far in the future');
    }
    if (input.title !== undefined && (input.title.trim().length < 1 || input.title.length > 200)) {
      throw new DomainError('invalid_input', 'title must be 1–200 characters');
    }
    if (input.notes !== undefined && input.notes.length > 2000)
      throw new DomainError('invalid_input', 'notes are too long');
  }

  async create(
    user: User,
    campaignId: string,
    input: { startsAt: number; title: string; notes?: string; durationMinutes?: number },
  ): Promise<ScheduledSession> {
    await this.requireDm(user, campaignId);
    this.check(input, true);
    const session: ScheduledSession = {
      id: this.newId(),
      campaignId,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes ?? DEFAULT_DURATION_MINUTES,
      title: input.title.trim(),
      notes: input.notes ?? '',
      createdBy: user.id,
      createdAt: this.now(),
      cancelledAt: null,
    };
    await this.deps.schedule.putSession(session);
    await this.notify(await this.memberIds(campaignId, user.id), {
      campaignId,
      kind: 'session.scheduled',
      title: `Session scheduled: ${session.title}`,
      data: { sessionId: session.id, startsAt: session.startsAt },
    });
    return session;
  }

  async update(
    user: User,
    campaignId: string,
    sessionId: string,
    patch: { startsAt?: number; durationMinutes?: number; title?: string; notes?: string },
  ): Promise<ScheduledSession> {
    await this.requireDm(user, campaignId);
    const session = await this.own(campaignId, sessionId);
    if (session.cancelledAt !== null)
      throw new DomainError('conflict', 'that session was cancelled');
    this.check(patch, false);
    const moved = patch.startsAt !== undefined && patch.startsAt !== session.startsAt;
    const next: ScheduledSession = {
      ...session,
      ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
      ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };
    await this.deps.schedule.putSession(next);
    if (moved) await this.deps.schedule.clearReminders(sessionId); // reminders apply afresh to the new time
    await this.notify(await this.memberIds(campaignId, user.id), {
      campaignId,
      kind: 'session.updated',
      title: `Session updated: ${next.title}`,
      data: { sessionId, startsAt: next.startsAt },
    });
    return next;
  }

  async cancel(user: User, campaignId: string, sessionId: string): Promise<void> {
    await this.requireDm(user, campaignId);
    const session = await this.own(campaignId, sessionId);
    if (session.cancelledAt !== null) return;
    if (session.startsAt <= this.now())
      throw new DomainError('conflict', 'a session that has started cannot be cancelled');
    await this.deps.schedule.putSession({ ...session, cancelledAt: this.now() });
    await this.notify(await this.memberIds(campaignId, user.id), {
      campaignId,
      kind: 'session.cancelled',
      title: `Session cancelled: ${session.title}`,
      data: { sessionId },
    });
  }

  async list(
    user: User,
    campaignId: string,
    options: { includePast?: boolean } = {},
  ): Promise<SessionView[]> {
    await this.role(user, campaignId);
    // By default, anything that has not ended long ago (a session in progress is still listed);
    // `includePast` is the "show previous sessions" view.
    const from = options.includePast ? 0 : this.now() - 6 * 60 * MINUTE;
    const sessions = await this.deps.schedule.listSessions(campaignId, from);
    const out: SessionView[] = [];
    for (const session of sessions) out.push(await this.view(session, user.id));
    return out;
  }

  async rsvp(
    user: User,
    campaignId: string,
    sessionId: string,
    status: RsvpStatus,
  ): Promise<SessionView> {
    const role = await this.role(user, campaignId);
    const session = await this.own(campaignId, sessionId);
    if (session.cancelledAt !== null)
      throw new DomainError('conflict', 'that session was cancelled');
    if (!['yes', 'late', 'no'].includes(status))
      throw new DomainError('invalid_input', 'status must be yes, late or no');
    // Answers can be corrected afterwards (late, or couldn't make it), but not forever: the record of who
    // attended should settle once the session is over.
    if (this.now() > session.startsAt + RSVP_WINDOW_AFTER_START_MS)
      throw new DomainError(
        'conflict',
        'attendance can no longer be changed: the session started more than 4 hours ago',
      );
    await this.deps.schedule.putRsvp({ sessionId, userId: user.id, status, updatedAt: this.now() });
    if (role === 'player' && status !== 'yes') {
      const dms = (await this.deps.store.listMemberships(campaignId))
        .filter((m) => m.role === 'dm')
        .map((m) => m.userId);
      await this.notify(dms, {
        campaignId,
        kind: 'rsvp.changed',
        title: `${user.displayName} ${status === 'no' ? "can't make it" : 'will be late'}: ${session.title}`,
        data: { sessionId, userId: user.id, status },
      });
    }
    return this.view(session, user.id);
  }

  /** Sends due reminders. Called on a timer; safe to call as often as you like (each is claimed once). */
  async sendDueReminders(): Promise<number> {
    const now = this.now();
    const horizon = Math.max(...REMINDER_OFFSETS_MIN) * MINUTE;
    let sent = 0;
    for (const session of await this.deps.schedule.sessionsStartingBetween(now, now + horizon)) {
      for (const offset of REMINDER_OFFSETS_MIN) {
        const due = session.startsAt - offset * MINUTE;
        if (now < due || now >= due + REMINDER_GRACE_MIN * MINUTE) continue;
        if (!(await this.deps.schedule.claimReminder(session.id, offset, now))) continue;
        const declined = new Set(
          (await this.deps.schedule.listRsvps(session.id))
            .filter((r) => r.status === 'no')
            .map((r) => r.userId),
        );
        const who = (await this.memberIds(session.campaignId)).filter((id) => !declined.has(id));
        await this.notify(who, {
          campaignId: session.campaignId,
          kind: 'session.reminder',
          title: `${session.title} starts in ${offset >= 60 ? `${offset / 60} hour${offset === 60 ? '' : 's'}` : `${offset} minutes`}`,
          data: { sessionId: session.id, startsAt: session.startsAt, offsetMin: offset },
        });
        sent += 1;
      }
    }
    return sent;
  }

  // ---- notifications ----

  listNotifications(
    user: User,
    options: { unreadOnly: boolean; limit: number },
  ): Promise<Notification[]> {
    return this.deps.schedule.listNotifications(user.id, options);
  }
  markRead(user: User, id: string): Promise<boolean> {
    return this.deps.schedule.markRead(user.id, id, this.now());
  }
  markAllRead(user: User): Promise<number> {
    return this.deps.schedule.markAllRead(user.id, this.now());
  }

  // ---- helpers ----

  private async own(campaignId: string, sessionId: string): Promise<ScheduledSession> {
    const s = await this.deps.schedule.getSession(sessionId);
    if (!s || s.campaignId !== campaignId) throw new DomainError('not_found');
    return s;
  }

  private async view(session: ScheduledSession, viewerId: string): Promise<SessionView> {
    const rsvps: Rsvp[] = await this.deps.schedule.listRsvps(session.id);
    const counts: Record<RsvpStatus, number> = { yes: 0, late: 0, no: 0 };
    for (const r of rsvps) counts[r.status] += 1;
    return {
      session,
      rsvps: rsvps.map((r) => ({ userId: r.userId, status: r.status })),
      counts,
      mine: rsvps.find((r) => r.userId === viewerId)?.status ?? null,
    };
  }
}
