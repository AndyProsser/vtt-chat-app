import { DEFAULT_INSTANCE_SETTINGS } from '../../consts/index.js';
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
import type { Store } from './store.js';

const membershipKey = (campaignId: string, userId: string): string => `${campaignId}:${userId}`;

interface Data {
  settings: InstanceSettings;
  users: Map<string, User>;
  sessions: Map<string, Session>;
  magicLinks: Map<string, MagicLink>;
  deviceRequests: Map<string, DeviceRequest>;
  campaigns: Map<string, Campaign>;
  memberships: Map<string, Membership>;
  characters: Map<string, Character>;
  avatarFiles: Map<string, { userId: string; createdAt: number }>;
  chat: ChatMessage[];
  invites: Map<string, Invite>;
}

function emptyData(): Data {
  return {
    settings: { ...DEFAULT_INSTANCE_SETTINGS },
    users: new Map(),
    sessions: new Map(),
    magicLinks: new Map(),
    deviceRequests: new Map(),
    campaigns: new Map(),
    memberships: new Map(),
    characters: new Map(),
    avatarFiles: new Map(),
    chat: [],
    invites: new Map(),
  };
}

/** Copies on the way in and out so callers can't mutate stored rows by accident. */
const copy = <T>(value: T): T => structuredClone(value);

export class MemoryStore implements Store {
  private data: Data = emptyData();

  getSettings = async (): Promise<InstanceSettings> => copy(this.data.settings);
  putSettings = async (settings: InstanceSettings): Promise<void> => {
    this.data.settings = copy(settings);
  };

  countUsers = async (): Promise<number> => this.data.users.size;
  listUsers = async (): Promise<User[]> =>
    [...this.data.users.values()].sort((a, b) => a.createdAt - b.createdAt).map(copy);
  getUser = async (id: string): Promise<User | undefined> =>
    copyOrUndefined(this.data.users.get(id));
  getUserByEmail = async (email: string): Promise<User | undefined> =>
    copyOrUndefined([...this.data.users.values()].find((user) => user.email === email));
  putUser = async (user: User): Promise<void> => {
    this.data.users.set(user.id, copy(user));
  };

  getSession = async (id: string): Promise<Session | undefined> =>
    copyOrUndefined(this.data.sessions.get(id));
  listSessionsForUser = async (userId: string): Promise<Session[]> =>
    [...this.data.sessions.values()].filter((s) => s.userId === userId).map(copy);
  putSession = async (session: Session): Promise<void> => {
    this.data.sessions.set(session.id, copy(session));
  };

  getMagicLinkByHash = async (tokenHash: string): Promise<MagicLink | undefined> =>
    copyOrUndefined([...this.data.magicLinks.values()].find((l) => l.tokenHash === tokenHash));
  putMagicLink = async (link: MagicLink): Promise<void> => {
    this.data.magicLinks.set(link.id, copy(link));
  };

  putDeviceRequest = async (request: DeviceRequest): Promise<void> => {
    this.data.deviceRequests.set(request.id, copy(request));
  };
  getDeviceRequest = async (id: string): Promise<DeviceRequest | undefined> =>
    copyOrUndefined(this.data.deviceRequests.get(id));
  getDeviceRequestByCodeHash = async (hash: string): Promise<DeviceRequest | undefined> =>
    copyOrUndefined([...this.data.deviceRequests.values()].find((r) => r.userCodeHash === hash));
  deleteExpiredDeviceRequests = async (now: number): Promise<void> => {
    for (const [id, r] of this.data.deviceRequests) {
      if (r.expiresAt <= now) this.data.deviceRequests.delete(id);
    }
  };
  markDeviceRequestDelivered = async (id: string, now: number): Promise<boolean> => {
    const row = this.data.deviceRequests.get(id);
    if (!row || row.deliveredAt !== null) return false;
    row.deliveredAt = now;
    return true;
  };

  getCampaign = async (id: string): Promise<Campaign | undefined> =>
    copyOrUndefined(this.data.campaigns.get(id));
  putCampaign = async (campaign: Campaign): Promise<void> => {
    this.data.campaigns.set(campaign.id, copy(campaign));
  };

  getMembership = async (campaignId: string, userId: string): Promise<Membership | undefined> =>
    copyOrUndefined(this.data.memberships.get(membershipKey(campaignId, userId)));
  listMemberships = async (campaignId: string): Promise<Membership[]> =>
    [...this.data.memberships.values()].filter((m) => m.campaignId === campaignId).map(copy);
  listMembershipsForUser = async (userId: string): Promise<Membership[]> =>
    [...this.data.memberships.values()].filter((m) => m.userId === userId).map(copy);
  putMembership = async (membership: Membership): Promise<void> => {
    this.data.memberships.set(
      membershipKey(membership.campaignId, membership.userId),
      copy(membership),
    );
  };

  removeMembership = async (campaignId: string, userId: string): Promise<void> => {
    this.data.memberships.delete(membershipKey(campaignId, userId));
  };

  getCharacter = async (id: string): Promise<Character | undefined> =>
    copyOrUndefined(this.data.characters.get(id));
  listCharacters = async (userId: string, campaignId: string): Promise<Character[]> =>
    [...this.data.characters.values()]
      .filter((c) => c.userId === userId && c.campaignId === campaignId)
      .map(copy)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  listLinkedCharacters = async (): Promise<Character[]> =>
    [...this.data.characters.values()]
      .filter((c) => c.sourceUrl !== null)
      .map(copy)
      .sort((a, b) => (a.syncedAt ?? 0) - (b.syncedAt ?? 0) || a.id.localeCompare(b.id));
  putCharacter = async (character: Character): Promise<void> => {
    this.data.characters.set(character.id, copy(character));
  };

  recordAvatarFile = async (id: string, userId: string, at: number): Promise<void> => {
    this.data.avatarFiles.set(id, { userId, createdAt: at });
  };
  listUnusedAvatarFiles = async (olderThan: number): Promise<string[]> => {
    const used = new Set<string>();
    const note = (value: string | null | undefined) => {
      if (value?.startsWith('avatar:')) used.add(value.slice('avatar:'.length));
    };
    for (const u of this.data.users.values()) note(u.avatarUrl);
    for (const c of this.data.characters.values()) note(c.avatarUrl);
    return [...this.data.avatarFiles]
      .filter(([id, f]) => f.createdAt < olderThan && !used.has(id))
      .map(([id]) => id);
  };
  deleteAvatarFile = async (id: string): Promise<void> => {
    this.data.avatarFiles.delete(id);
  };

  getInviteByHash = async (codeHash: string): Promise<Invite | undefined> =>
    copyOrUndefined([...this.data.invites.values()].find((i) => i.codeHash === codeHash));
  putInvite = async (invite: Invite): Promise<void> => {
    this.data.invites.set(invite.id, copy(invite));
  };

  putChatMessage = async (m: ChatMessage): Promise<void> => {
    this.data.chat.push(copy(m));
  };

  listChat = async (
    campaignId: string,
    viewerId: string,
    options: { before?: number; limit: number },
  ): Promise<ChatMessage[]> =>
    this.data.chat
      .filter(
        (m) =>
          m.campaignId === campaignId &&
          (m.recipientId === null || m.recipientId === viewerId || m.senderId === viewerId) &&
          (options.before === undefined || m.at < options.before),
      )
      .sort((a, b) => a.at - b.at)
      .slice(-options.limit)
      .map(copy);

  pruneChat = async (campaignId: string, keep: number): Promise<number> => {
    const mine = this.data.chat
      .filter((m) => m.campaignId === campaignId)
      .sort((a, b) => a.at - b.at);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - keep)));
    this.data.chat = this.data.chat.filter((m) => !drop.has(m));
    return drop.size;
  };

  /** Snapshot-and-restore: if `work` throws, every write it made is rolled back. */
  async transaction<T>(work: (store: Store) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.data);
    try {
      return await work(this);
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }
}

function copyOrUndefined<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : copy(value);
}
