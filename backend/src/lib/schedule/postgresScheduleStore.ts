import type pg from 'pg';

import type {
  Notification,
  Rsvp,
  RsvpStatus,
  ScheduledSession,
  ScheduleStore,
} from './scheduleStore.js';

type Row = Record<string, unknown>;

const toSession = (r: Row): ScheduledSession => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  startsAt: r.starts_at as number,
  title: r.title as string,
  notes: r.notes as string,
  createdBy: (r.created_by as string | null) ?? null,
  createdAt: r.created_at as number,
  cancelledAt: (r.cancelled_at as number | null) ?? null,
});

const toNotification = (r: Row): Notification => ({
  id: r.id as string,
  userId: r.user_id as string,
  campaignId: (r.campaign_id as string | null) ?? null,
  kind: r.kind as string,
  title: r.title as string,
  body: r.body as string,
  data: (r.data as Record<string, unknown>) ?? {},
  createdAt: r.created_at as number,
  readAt: (r.read_at as number | null) ?? null,
  pushedAt: (r.pushed_at as number | null) ?? null,
});

export class PostgresScheduleStore implements ScheduleStore {
  constructor(private readonly pool: pg.Pool) {}

  async putSession(s: ScheduledSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO scheduled_sessions (id, campaign_id, starts_at, title, notes, created_by, created_at, cancelled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET starts_at = $3, title = $4, notes = $5, cancelled_at = $8`,
      [s.id, s.campaignId, s.startsAt, s.title, s.notes, s.createdBy, s.createdAt, s.cancelledAt],
    );
  }

  async getSession(id: string): Promise<ScheduledSession | undefined> {
    try {
      const { rows } = await this.pool.query<Row>(
        'SELECT * FROM scheduled_sessions WHERE id = $1',
        [id],
      );
      return rows[0] ? toSession(rows[0]) : undefined;
    } catch (error) {
      if ((error as { code?: string }).code === '22P02') return undefined;
      throw error;
    }
  }

  async listSessions(campaignId: string, from: number): Promise<ScheduledSession[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM scheduled_sessions WHERE campaign_id = $1 AND starts_at >= $2 ORDER BY starts_at, id',
      [campaignId, from],
    );
    return rows.map(toSession);
  }

  async sessionsStartingBetween(from: number, to: number): Promise<ScheduledSession[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM scheduled_sessions WHERE cancelled_at IS NULL AND starts_at BETWEEN $1 AND $2 ORDER BY starts_at, id',
      [from, to],
    );
    return rows.map(toSession);
  }

  async putRsvp(r: Rsvp): Promise<void> {
    await this.pool.query(
      `INSERT INTO session_rsvps (session_id, user_id, status, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, user_id) DO UPDATE SET status = $3, updated_at = $4`,
      [r.sessionId, r.userId, r.status, r.updatedAt],
    );
  }

  async listRsvps(sessionId: string): Promise<Rsvp[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM session_rsvps WHERE session_id = $1',
      [sessionId],
    );
    return rows.map((r) => ({
      sessionId,
      userId: r.user_id as string,
      status: r.status as RsvpStatus,
      updatedAt: r.updated_at as number,
    }));
  }

  async clearReminders(sessionId: string): Promise<void> {
    await this.pool.query('DELETE FROM session_reminders WHERE session_id = $1', [sessionId]);
  }

  async claimReminder(sessionId: string, offsetMin: number, at: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO session_reminders (session_id, offset_min, sent_at) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [sessionId, offsetMin, at],
    );
    return rowCount === 1;
  }

  async addNotification(n: Notification): Promise<void> {
    await this.pool.query(
      `INSERT INTO notifications (id, user_id, campaign_id, kind, title, body, data, created_at, read_at, pushed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
      [
        n.id,
        n.userId,
        n.campaignId,
        n.kind,
        n.title,
        n.body,
        JSON.stringify(n.data),
        n.createdAt,
        n.readAt,
        n.pushedAt,
      ],
    );
  }

  async listNotifications(
    userId: string,
    o: { unreadOnly: boolean; limit: number },
  ): Promise<Notification[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM (SELECT * FROM notifications WHERE user_id = $1 AND ($2 = FALSE OR read_at IS NULL)
                       ORDER BY created_at DESC, id DESC LIMIT $3) newest ORDER BY created_at, id`,
      [userId, o.unreadOnly, o.limit],
    );
    return rows.map(toNotification);
  }

  async markRead(userId: string, id: string, at: number): Promise<boolean> {
    try {
      const { rowCount } = await this.pool.query(
        'UPDATE notifications SET read_at = COALESCE(read_at, $3) WHERE id = $2 AND user_id = $1',
        [userId, id, at],
      );
      return rowCount === 1;
    } catch (error) {
      if ((error as { code?: string }).code === '22P02') return false;
      throw error;
    }
  }

  async markAllRead(userId: string, at: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      'UPDATE notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL',
      [userId, at],
    );
    return rowCount ?? 0;
  }

  async unpushedNotifications(limit: number): Promise<Notification[]> {
    const { rows } = await this.pool.query<Row>(
      'SELECT * FROM notifications WHERE pushed_at IS NULL ORDER BY created_at, id LIMIT $1',
      [limit],
    );
    return rows.map(toNotification);
  }

  async markPushed(ids: string[], at: number): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query('UPDATE notifications SET pushed_at = $2 WHERE id = ANY($1::uuid[])', [
      ids,
      at,
    ]);
  }
}
