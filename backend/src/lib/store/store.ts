import type {
  Campaign,
  Character,
  Invite,
  InstanceSettings,
  MagicLink,
  Membership,
  Session,
  User,
} from '../../types/index.js';

/**
 * Everything the services need from storage. Postgres implements it for real
 * (`migrations/0001_init.sql`); `MemoryStore` implements it for tests and for running the
 * services without a database. Kept to plain get/put/list so both are trivial to keep honest.
 */
export interface Store {
  getSettings(): Promise<InstanceSettings>;
  putSettings(settings: InstanceSettings): Promise<void>;

  countUsers(): Promise<number>;
  /** Every account, oldest first. For the Admin CLI; not used on a request path. */
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  putUser(user: User): Promise<void>;

  getSession(id: string): Promise<Session | undefined>;
  listSessionsForUser(userId: string): Promise<Session[]>;
  putSession(session: Session): Promise<void>;

  getMagicLinkByHash(tokenHash: string): Promise<MagicLink | undefined>;
  putMagicLink(link: MagicLink): Promise<void>;

  getCampaign(id: string): Promise<Campaign | undefined>;
  putCampaign(campaign: Campaign): Promise<void>;

  getMembership(campaignId: string, userId: string): Promise<Membership | undefined>;
  listMemberships(campaignId: string): Promise<Membership[]>;
  listMembershipsForUser(userId: string): Promise<Membership[]>;
  putMembership(membership: Membership): Promise<void>;
  removeMembership(campaignId: string, userId: string): Promise<void>;

  getCharacter(id: string): Promise<Character | undefined>;
  putCharacter(character: Character): Promise<void>;

  getInviteByHash(codeHash: string): Promise<Invite | undefined>;
  putInvite(invite: Invite): Promise<void>;

  /**
   * Runs `work` as one atomic unit: either every write inside it lands or none does. Used where
   * several rows must change together (a DM swap touches two memberships).
   */
  transaction<T>(work: (store: Store) => Promise<T>): Promise<T>;
}
