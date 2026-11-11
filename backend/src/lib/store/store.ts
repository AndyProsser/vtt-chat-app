import type {
  Campaign,
  ChatMessage,
  Character,
  Invite,
  InstanceSettings,
  DeviceRequest,
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

  putDeviceRequest(request: DeviceRequest): Promise<void>;
  getDeviceRequest(id: string): Promise<DeviceRequest | undefined>;
  getDeviceRequestByCodeHash(userCodeHash: string): Promise<DeviceRequest | undefined>;
  deleteExpiredDeviceRequests(now: number): Promise<void>;
  /** Marks the request delivered if it was not already; true for exactly one caller. */
  markDeviceRequestDelivered(id: string, now: number): Promise<boolean>;

  getCampaign(id: string): Promise<Campaign | undefined>;
  putCampaign(campaign: Campaign): Promise<void>;

  getMembership(campaignId: string, userId: string): Promise<Membership | undefined>;
  listMemberships(campaignId: string): Promise<Membership[]>;
  listMembershipsForUser(userId: string): Promise<Membership[]>;
  putMembership(membership: Membership): Promise<void>;
  removeMembership(campaignId: string, userId: string): Promise<void>;

  getCharacter(id: string): Promise<Character | undefined>;
  /** One person's characters in one campaign, by name. */
  listCharacters(userId: string, campaignId: string): Promise<Character[]>;
  putCharacter(character: Character): Promise<void>;
  /** Characters linked to a D&D Beyond sheet, least recently synced first. */
  listLinkedCharacters(): Promise<Character[]>;

  /** Notes that `userId` uploaded the portrait stored under `id` (see `listUnusedAvatarFiles`). */
  recordAvatarFile(id: string, userId: string, at: number): Promise<void>;
  /** Uploaded portraits older than `olderThan` that no account or character uses (`avatar:<id>`). */
  listUnusedAvatarFiles(olderThan: number): Promise<string[]>;
  deleteAvatarFile(id: string): Promise<void>;

  getInviteByHash(codeHash: string): Promise<Invite | undefined>;
  putInvite(invite: Invite): Promise<void>;

  putChatMessage(message: ChatMessage): Promise<void>;
  /**
   * The newest `limit` messages **this viewer may see** (the table's, plus whispers they sent or
   * received), oldest first, optionally only those before `before`. The viewer filter lives here so
   * no caller can forget it.
   */
  listChat(
    campaignId: string,
    viewerId: string,
    options: { before?: number; limit: number },
  ): Promise<ChatMessage[]>;
  /** Keeps only the newest `keep` messages of a campaign (bounded retention). Returns how many went. */
  pruneChat(campaignId: string, keep: number): Promise<number>;

  /**
   * Runs `work` as one atomic unit: either every write inside it lands or none does. Used where
   * several rows must change together (a DM swap touches two memberships).
   */
  transaction<T>(work: (store: Store) => Promise<T>): Promise<T>;
}
