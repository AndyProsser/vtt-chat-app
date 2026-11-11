import type {
  Campaign,
  ChatMessage,
  Character,
  Invite,
  InstanceSettings,
  JoinRequest,
  JoinRequestStatus,
  OpenCampaign,
  DeviceRequest,
  SignupRequest,
  SignupRequestStatus,
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
  /** Records the approver if the request is still unexpired and unapproved; true for exactly one caller. */
  markDeviceRequestApproved(id: string, userId: string, now: number): Promise<boolean>;
  /** Marks the request delivered if it was not already; true for exactly one caller. */
  markDeviceRequestDelivered(id: string, now: number): Promise<boolean>;

  putSignupRequest(request: SignupRequest): Promise<void>;
  getSignupRequest(id: string): Promise<SignupRequest | undefined>;
  /** Oldest first; every status when none is given. */
  listSignupRequests(status?: SignupRequestStatus): Promise<SignupRequest[]>;

  getCampaign(id: string): Promise<Campaign | undefined>;
  putCampaign(campaign: Campaign): Promise<void>;
  /** How many campaigns the instance has, of any kind. */
  countCampaigns(): Promise<number>;

  /** The DM's Allow-join switch. False when the campaign does not exist. */
  setCampaignAllowJoin(campaignId: string, allowJoin: boolean): Promise<boolean>;
  /**
   * Campaigns whose DM allows joining, by name: the DM's display name and how many players, nothing
   * about who they are. The instance master switch is the caller's to check.
   */
  listOpenCampaigns(): Promise<OpenCampaign[]>;

  /** Stores a new pending request; false (nothing stored) if that person already has one pending there. */
  createJoinRequest(request: JoinRequest): Promise<boolean>;
  getJoinRequest(id: string): Promise<JoinRequest | undefined>;
  /** Oldest first; every status when none is given. */
  listJoinRequestsForCampaign(
    campaignId: string,
    status?: JoinRequestStatus,
  ): Promise<JoinRequest[]>;
  /** Oldest first; every status when none is given. */
  listJoinRequestsForUser(userId: string, status?: JoinRequestStatus): Promise<JoinRequest[]>;
  /** Moves a still-pending request to `status`; true for exactly one caller, so a double click decides once. */
  decideJoinRequest(
    id: string,
    status: Exclude<JoinRequestStatus, 'pending'>,
    decidedBy: string | null,
    at: number,
  ): Promise<boolean>;
  countOpenJoinRequestsByUser(userId: string): Promise<number>;

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
