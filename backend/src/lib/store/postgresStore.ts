import { normaliseAiSettings } from '@vtt-chat-app/shared';
import pg from 'pg';

import { DEFAULT_INSTANCE_SETTINGS } from '../../consts/index.js';
import type {
  Campaign,
  ChatMessage,
  Character,
  InstanceSettings,
  Invite,
  MagicLink,
  Membership,
  Session,
  User,
} from '../../types/index.js';
import type { Store } from './store.js';

/** The slice of `pg.Pool` / `pg.PoolClient` the store uses, so a transaction can reuse the same code. */
interface Queryable {
  query<R extends pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

type Row = Record<string, unknown>;

/** BIGINT (OID 20) arrives as a string by default; epoch milliseconds fit a JS number exactly. */
const BIGINT_OID = 20;
/** SQLSTATE for a malformed value, e.g. a non-UUID string compared against a UUID column. */
const INVALID_TEXT_REPRESENTATION = '22P02';
const parseBigint = (value: string): number => Number(value);

export function createPool(connectionString: string, extra: pg.PoolConfig = {}): pg.Pool {
  return new pg.Pool({
    connectionString,
    ...extra,
    types: {
      getTypeParser: (oid, format) =>
        oid === BIGINT_OID ? parseBigint : pg.types.getTypeParser(oid, format),
    },
  });
}

const nullable = <T>(value: T | null | undefined): T | null => value ?? null;

const toUser = (r: Row): User => ({
  id: r.id as string,
  email: r.email as string,
  displayName: r.display_name as string,
  avatarUrl: nullable(r.avatar_url as string | null),
  passwordHash: nullable(r.password_hash as string | null),
  isAdmin: r.is_admin as boolean,
  consentVersion: r.consent_version as string,
  consentAt: r.consent_at as number,
  createdAt: r.created_at as number,
});

const toSession = (r: Row): Session => ({
  id: r.id as string,
  userId: r.user_id as string,
  tokenHash: r.token_hash as string,
  deviceLabel: nullable(r.device_label as string | null),
  createdAt: r.created_at as number,
  lastSeenAt: r.last_seen_at as number,
  revokedAt: nullable(r.revoked_at as number | null),
});

const toMagicLink = (r: Row): MagicLink => ({
  id: r.id as string,
  email: r.email as string,
  purpose: r.purpose as MagicLink['purpose'],
  tokenHash: r.token_hash as string,
  createdAt: r.created_at as number,
  expiresAt: r.expires_at as number,
  usedAt: nullable(r.used_at as number | null),
});

const toCampaign = (r: Row): Campaign => ({
  id: r.id as string,
  name: r.name as string,
  createdAt: r.created_at as number,
});

const toMembership = (r: Row): Membership => ({
  campaignId: r.campaign_id as string,
  userId: r.user_id as string,
  role: r.role as Membership['role'],
  activeCharacterId: nullable(r.active_character_id as string | null),
  suspendedCharacterId: nullable(r.suspended_character_id as string | null),
  joinedAt: r.joined_at as number,
});

const toCharacter = (r: Row): Character => ({
  id: r.id as string,
  userId: r.user_id as string,
  campaignId: r.campaign_id as string,
  name: r.name as string,
  className: nullable(r.class_name as string | null),
  race: nullable(r.race as string | null),
  level: nullable(r.level as number | null),
  avatarUrl: nullable(r.avatar_url as string | null),
  sourceUrl: nullable(r.source_url as string | null),
  syncedAt: r.synced_at === null || r.synced_at === undefined ? null : Number(r.synced_at),
  sourceAvatar: nullable(r.source_avatar as string | null),
  sheet: (r.sheet as Character['sheet'] | null | undefined) ?? null,
});

const toChat = (r: Row): ChatMessage => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  senderId: nullable(r.sender_id as string | null),
  senderName: r.sender_name as string,
  recipientId: nullable(r.recipient_id as string | null),
  text: r.text as string,
  at: r.at as number,
});

const toInvite = (r: Row): Invite => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  codeHash: r.code_hash as string,
  createdBy: r.created_by as string,
  createdAt: r.created_at as number,
  expiresAt: r.expires_at as number,
  uses: r.uses as number,
  revokedAt: nullable(r.revoked_at as number | null),
});

/**
 * The real `Store`: plain get/put/list over the tables in `migrations/`. Every `put` is an upsert
 * keyed on the primary key, matching how `MemoryStore` behaves. Construct with a pool from
 * {@link createPool}; run migrations first (`migrate.ts`).
 */
export class PostgresStore implements Store {
  /** `pool` is set only on the root store; inside a transaction `db` is the one checked-out client. */
  constructor(
    private readonly db: Queryable,
    private readonly pool: pg.Pool | undefined = db instanceof pg.Pool ? db : undefined,
  ) {}

  /**
   * Reads take ids that arrive from clients (a token's session id, a campaign id in a URL). A value
   * that isn't a UUID can't match any row, so Postgres' "invalid input syntax for type uuid"
   * (22P02) means "not found", not a server error. Writes are not wrapped: they always carry ids we minted.
   */
  private async select(text: string, values: unknown[]): Promise<Row[]> {
    try {
      return (await this.db.query<Row>(text, values)).rows;
    } catch (error) {
      if ((error as { code?: string }).code === INVALID_TEXT_REPRESENTATION) return [];
      throw error;
    }
  }

  private async one<T>(
    map: (r: Row) => T,
    text: string,
    values: unknown[],
  ): Promise<T | undefined> {
    const rows = await this.select(text, values);
    return rows[0] === undefined ? undefined : map(rows[0]);
  }

  private async many<T>(map: (r: Row) => T, text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.select(text, values)).map(map);
  }

  async getSettings(): Promise<InstanceSettings> {
    const { rows } = await this.db.query<Row>('SELECT * FROM instance_settings WHERE id = 1');
    const r = rows[0];
    if (r === undefined) return { ...DEFAULT_INSTANCE_SETTINGS };
    return {
      campaignCreation: r.campaign_creation as InstanceSettings['campaignCreation'],
      offlineLimitDays: r.offline_limit_days as number,
      inviteExpiryDays: r.invite_expiry_days as number,
      consentVersion: r.consent_version as string,
      ai: normaliseAiSettings(r.ai),
    };
  }

  async putSettings(s: InstanceSettings): Promise<void> {
    await this.db.query(
      `INSERT INTO instance_settings (id, campaign_creation, offline_limit_days, invite_expiry_days, consent_version, ai)
       VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET campaign_creation = $1, offline_limit_days = $2,
         invite_expiry_days = $3, consent_version = $4, ai = $5`,
      [
        s.campaignCreation,
        s.offlineLimitDays,
        s.inviteExpiryDays,
        s.consentVersion,
        JSON.stringify(s.ai),
      ],
    );
  }

  async countUsers(): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM users');
    return Number(rows[0]?.n ?? 0);
  }

  listUsers = (): Promise<User[]> =>
    this.many(toUser, 'SELECT * FROM users ORDER BY created_at, id');

  getUser = (id: string): Promise<User | undefined> =>
    this.one(toUser, 'SELECT * FROM users WHERE id = $1', [id]);

  getUserByEmail = (email: string): Promise<User | undefined> =>
    this.one(toUser, 'SELECT * FROM users WHERE email = $1', [email]);

  async putUser(u: User): Promise<void> {
    await this.db.query(
      `INSERT INTO users (id, email, display_name, password_hash, is_admin, consent_version, consent_at, created_at, avatar_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET email = $2, display_name = $3, password_hash = $4,
         is_admin = $5, consent_version = $6, consent_at = $7, created_at = $8, avatar_url = $9`,
      [
        u.id,
        u.email,
        u.displayName,
        u.passwordHash,
        u.isAdmin,
        u.consentVersion,
        u.consentAt,
        u.createdAt,
        u.avatarUrl ?? null,
      ],
    );
  }

  getSession = (id: string): Promise<Session | undefined> =>
    this.one(toSession, 'SELECT * FROM sessions WHERE id = $1', [id]);

  listSessionsForUser = (userId: string): Promise<Session[]> =>
    this.many(toSession, 'SELECT * FROM sessions WHERE user_id = $1 ORDER BY created_at, id', [
      userId,
    ]);

  async putSession(s: Session): Promise<void> {
    await this.db.query(
      `INSERT INTO sessions (id, user_id, token_hash, device_label, created_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET user_id = $2, token_hash = $3, device_label = $4,
         created_at = $5, last_seen_at = $6, revoked_at = $7`,
      [s.id, s.userId, s.tokenHash, s.deviceLabel, s.createdAt, s.lastSeenAt, s.revokedAt],
    );
  }

  getMagicLinkByHash = (tokenHash: string): Promise<MagicLink | undefined> =>
    this.one(toMagicLink, 'SELECT * FROM magic_links WHERE token_hash = $1', [tokenHash]);

  async putMagicLink(l: MagicLink): Promise<void> {
    await this.db.query(
      `INSERT INTO magic_links (id, email, purpose, token_hash, created_at, expires_at, used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET email = $2, purpose = $3, token_hash = $4,
         created_at = $5, expires_at = $6, used_at = $7`,
      [l.id, l.email, l.purpose, l.tokenHash, l.createdAt, l.expiresAt, l.usedAt],
    );
  }

  getCampaign = (id: string): Promise<Campaign | undefined> =>
    this.one(toCampaign, 'SELECT * FROM campaigns WHERE id = $1', [id]);

  async putCampaign(c: Campaign): Promise<void> {
    await this.db.query(
      `INSERT INTO campaigns (id, name, created_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = $2, created_at = $3`,
      [c.id, c.name, c.createdAt],
    );
  }

  getMembership = (campaignId: string, userId: string): Promise<Membership | undefined> =>
    this.one(toMembership, 'SELECT * FROM memberships WHERE campaign_id = $1 AND user_id = $2', [
      campaignId,
      userId,
    ]);

  listMemberships = (campaignId: string): Promise<Membership[]> =>
    this.many(
      toMembership,
      'SELECT * FROM memberships WHERE campaign_id = $1 ORDER BY joined_at, user_id',
      [campaignId],
    );

  listMembershipsForUser = (userId: string): Promise<Membership[]> =>
    this.many(
      toMembership,
      'SELECT * FROM memberships WHERE user_id = $1 ORDER BY joined_at, campaign_id',
      [userId],
    );

  async putMembership(m: Membership): Promise<void> {
    await this.db.query(
      `INSERT INTO memberships (campaign_id, user_id, role, active_character_id, suspended_character_id, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (campaign_id, user_id) DO UPDATE SET role = $3, active_character_id = $4,
         suspended_character_id = $5, joined_at = $6`,
      [m.campaignId, m.userId, m.role, m.activeCharacterId, m.suspendedCharacterId, m.joinedAt],
    );
  }

  async removeMembership(campaignId: string, userId: string): Promise<void> {
    await this.db.query('DELETE FROM memberships WHERE campaign_id = $1 AND user_id = $2', [
      campaignId,
      userId,
    ]);
  }

  getCharacter = (id: string): Promise<Character | undefined> =>
    this.one(toCharacter, 'SELECT * FROM characters WHERE id = $1', [id]);

  async listCharacters(userId: string, campaignId: string): Promise<Character[]> {
    const { rows } = await this.db.query<Row>(
      'SELECT * FROM characters WHERE user_id = $1 AND campaign_id = $2 ORDER BY name, id',
      [userId, campaignId],
    );
    return rows.map(toCharacter);
  }

  async recordAvatarFile(id: string, userId: string, at: number): Promise<void> {
    await this.db.query(
      'INSERT INTO avatar_files (id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [id, userId, at],
    );
  }

  async listUnusedAvatarFiles(olderThan: number): Promise<string[]> {
    const { rows } = await this.db.query(
      `SELECT f.id FROM avatar_files f
       WHERE f.created_at < $1
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.avatar_url = 'avatar:' || f.id)
         AND NOT EXISTS (SELECT 1 FROM characters c WHERE c.avatar_url = 'avatar:' || f.id)`,
      [olderThan],
    );
    return rows.map((r) => r.id as string);
  }

  async deleteAvatarFile(id: string): Promise<void> {
    await this.db.query('DELETE FROM avatar_files WHERE id = $1', [id]);
  }

  async listLinkedCharacters(): Promise<Character[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM characters WHERE source_url IS NOT NULL ORDER BY synced_at NULLS FIRST, id',
    );
    return rows.map(toCharacter);
  }

  async putCharacter(c: Character): Promise<void> {
    await this.db.query(
      `INSERT INTO characters (id, user_id, campaign_id, name, class_name, race, level, avatar_url, source_url, synced_at, source_avatar, sheet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET user_id = $2, campaign_id = $3, name = $4, class_name = $5,
         race = $6, level = $7, avatar_url = $8, source_url = $9, synced_at = $10, source_avatar = $11, sheet = $12`,
      [
        c.id,
        c.userId,
        c.campaignId,
        c.name,
        c.className,
        c.race,
        c.level,
        c.avatarUrl,
        c.sourceUrl,
        c.syncedAt,
        c.sourceAvatar,
        c.sheet === null ? null : JSON.stringify(c.sheet),
      ],
    );
  }

  getInviteByHash = (codeHash: string): Promise<Invite | undefined> =>
    this.one(toInvite, 'SELECT * FROM invites WHERE code_hash = $1', [codeHash]);

  async putInvite(i: Invite): Promise<void> {
    await this.db.query(
      `INSERT INTO invites (id, campaign_id, code_hash, created_by, created_at, expires_at, uses, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET campaign_id = $2, code_hash = $3, created_by = $4,
         created_at = $5, expires_at = $6, uses = $7, revoked_at = $8`,
      [i.id, i.campaignId, i.codeHash, i.createdBy, i.createdAt, i.expiresAt, i.uses, i.revokedAt],
    );
  }

  async putChatMessage(m: ChatMessage): Promise<void> {
    await this.db.query(
      `INSERT INTO chat_messages (id, campaign_id, sender_id, sender_name, recipient_id, text, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [m.id, m.campaignId, m.senderId, m.senderName, m.recipientId, m.text, m.at],
    );
  }

  listChat(
    campaignId: string,
    viewerId: string,
    options: { before?: number; limit: number },
  ): Promise<ChatMessage[]> {
    // Newest `limit` the viewer may see, returned oldest first. The visibility rule is the WHERE clause.
    return this.many(
      toChat,
      `SELECT * FROM (
         SELECT * FROM chat_messages
          WHERE campaign_id = $1
            AND (recipient_id IS NULL OR recipient_id = $2 OR sender_id = $2)
            AND ($3::bigint IS NULL OR at < $3)
          ORDER BY at DESC, id DESC
          LIMIT $4) newest
        ORDER BY at, id`,
      [campaignId, viewerId, options.before ?? null, options.limit],
    );
  }

  async pruneChat(campaignId: string, keep: number): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM chat_messages WHERE campaign_id = $1 AND id NOT IN (
         SELECT id FROM chat_messages WHERE campaign_id = $1 ORDER BY at DESC, id DESC LIMIT $2)`,
      [campaignId, keep],
    );
    return result.rowCount ?? 0;
  }

  /**
   * One real database transaction on one checked-out connection. Called from inside a transaction
   * it simply joins it (no savepoints — nothing nests transactions today).
   */
  async transaction<T>(work: (store: Store) => Promise<T>): Promise<T> {
    if (this.pool === undefined) return work(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PostgresStore(client, undefined));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Releases the pool. Only meaningful on the root store. */
  async close(): Promise<void> {
    await this.pool?.end();
  }
}
