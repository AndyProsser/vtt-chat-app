import { randomUUID } from 'node:crypto';

import { CHAT_RETENTION_MESSAGES } from '../../consts/index.js';
import type { ChatMessage, Session, User } from '../../types/index.js';
import type { AccountService } from '../auth/accountService.js';
import { DomainError } from '../errors.js';
import { RateLimiter } from '../http/rateLimit.js';
import type { Store } from '../store/store.js';
import { PresenceTracker } from './presence.js';
import {
  parseClientFrame,
  serverFrame,
  clientData,
  type ClientData,
  type ClientFrame,
  type ClientType,
} from './protocol.js';
import { MemoryAckStore, type AckStore } from '../recording/ackStore.js';
import { SoundboardRuntime } from '../soundboard/runtime.js';
import type { PartyService } from '../parties/partyService.js';
import type { ScheduleStore } from '../schedule/scheduleStore.js';
import { notificationView } from '../schedule/relay.js';
import { handoutExcerpt } from '../table/handoutExcerpt.js';
import type { SoundStore } from '../soundboard/soundStore.js';
import { RecordingState, type RecordingChange } from '../recording/recordingState.js';
import type { BufferedEvent, ReplayBuffer } from './replayBuffer.js';

/** What the hub needs from a socket. The `ws` adapter and the tests each implement it. */
export interface Connection {
  readonly id: string;
  send(data: string): void;
  close(code: number, reason: string): void;
}

/** Close codes (4000–4999 is the application range). */
export const CloseCode = {
  BadRequest: 4400,
  Unauthorized: 4401,
  AuthTimeout: 4408,
  TooManyErrors: 4429,
} as const;

export interface HubOptions {
  store: Store;
  accounts: AccountService;
  replay: ReplayBuffer;
  presence?: PresenceTracker;
  /** Whether each campaign is recording. Shared with the REST layer, which changes it. */
  recording?: RecordingState;
  /** Who has heard the recording-start cue. */
  acks?: AckStore;
  /** Told after every recording change and every acknowledgement (the audio capture follows these). */
  onRecordingChange?: (change: RecordingChange) => void;
  onRecordingAck?: (campaignId: string, recordingId: string, userId: string) => void;
  /** Told about every soundboard frame sent to a table, for the recording's timeline. */
  onTableEvent?: (campaignId: string, type: string, data: unknown) => void;
  /**
   * How long (ms) a recording tolerates the DM being away before players may step in, and nobody being
   * connected before it stops by itself. Default 30 s (RECORDING_GRACE_SECONDS).
   */
  recordingGraceMs?: number;
  /** Told about every line typed into the public chat (never a whisper), for a recording's transcript. */
  onPublicChat?: (
    campaignId: string,
    line: { senderId: string; senderName: string; text: string; at: number },
  ) => void;
  /** The DM's sound library, to play from. Omit and the soundboard frames are refused. */
  sounds?: SoundStore;
  /** Stored notifications, delivered in the snapshot on connect. */
  schedule?: ScheduleStore;
  /** Voice groups. Omit and the party frames are refused. */
  parties?: PartyService;
  /** Called when someone who was subscribed to a campaign turns out no longer to be a member. */
  onMemberRemoved?: (campaignId: string, userId: string) => void;
  now?: () => number;
  /** Drop a connection that hasn't authenticated within this long. */
  authTimeoutMs?: number;
  /** Malformed frames tolerated per connection before it is dropped. */
  maxBadFrames?: number;
}

interface ConnState {
  conn: Connection;
  auth: { user: User; session: Session; token: string } | null;
  campaigns: Set<string>;
  authTimer: ReturnType<typeof setTimeout> | null;
  badFrames: number;
  chatLimiter: RateLimiter;
  /** Frames from one connection are handled strictly in order. */
  queue: Promise<void>;
}

const CHAT_KINDS = new Set(['chat.message']);

/**
 * The realtime core: authenticates sockets, subscribes them to campaigns, tracks presence, relays
 * live events, and serves replays/snapshots. Transport-agnostic — it never touches a real socket,
 * which keeps every rule here testable without a network.
 *
 * Division of labour (SYNC-PROTOCOL.md): frequent, live things (speaking, typing, mute, stats,
 * chat) come in here over the WebSocket; rare, heavy things stay on REST.
 */
export class Hub {
  readonly presence: PresenceTracker;
  readonly recording: RecordingState;
  private readonly acks: AckStore;
  private readonly soundboard: SoundboardRuntime | undefined;
  private readonly soundLimiter = new RateLimiter(30, 10_000);
  private readonly connections = new Map<string, ConnState>();
  private readonly now: () => number;
  private readonly authTimeoutMs: number;
  private readonly maxBadFrames: number;
  private readonly graceMs: number;
  private readonly startedAt: number;
  /** When each person last had no connection to a campaign (`campaign:user`), for "how long has the DM been away". */
  private readonly lastOnline = new Map<string, number>();
  private readonly emptyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: HubOptions) {
    this.presence = options.presence ?? new PresenceTracker();
    this.recording = options.recording ?? new RecordingState();
    this.acks = options.acks ?? new MemoryAckStore({ now: options.now ?? Date.now });
    this.soundboard = options.sounds
      ? new SoundboardRuntime({
          sounds: options.sounds,
          now: options.now ?? Date.now,
          events: {
            emit: (campaignId, type, data, only) => {
              options.onTableEvent?.(campaignId, type, data);
              this.broadcast(
                campaignId,
                type,
                data,
                only ? { only: (s) => s.auth !== null && only.has(s.auth.user.id) } : {},
              );
            },
          },
        })
      : undefined;
    this.now = options.now ?? Date.now;
    this.authTimeoutMs = options.authTimeoutMs ?? 5_000;
    this.maxBadFrames = options.maxBadFrames ?? 20;
    this.graceMs = options.recordingGraceMs ?? 30_000;
    this.startedAt = this.now();
  }

  /** Registers a new socket. It must authenticate before the timeout or it is dropped. */
  accept(conn: Connection): void {
    const state: ConnState = {
      conn,
      auth: null,
      campaigns: new Set(),
      authTimer: null,
      badFrames: 0,
      chatLimiter: new RateLimiter(10, 10_000, this.now),
      queue: Promise.resolve(),
    };
    state.authTimer = setTimeout(() => {
      if (!state.auth) conn.close(CloseCode.AuthTimeout, 'authentication timed out');
    }, this.authTimeoutMs);
    this.connections.set(conn.id, state);
  }

  /** Feeds one text frame from a socket. Resolves once it has been handled. */
  receive(connectionId: string, raw: string): Promise<void> {
    const state = this.connections.get(connectionId);
    if (!state) return Promise.resolve();
    // Chain, don't run concurrently: two quick frames must be applied in the order sent.
    state.queue = state.queue
      .then(() => this.handle(state, raw))
      .catch((error: unknown) => {
        console.error('[realtime] unhandled error', error);
      });
    return state.queue;
  }

  /** Call when a socket has closed, for any reason. */
  closed(connectionId: string): void {
    const state = this.connections.get(connectionId);
    if (!state) return;
    if (state.authTimer) clearTimeout(state.authTimer);
    this.connections.delete(connectionId);
    if (!state.auth) return;
    for (const campaignId of state.campaigns) {
      this.leave(state, campaignId);
    }
  }

  /** Remote sign-out: drop every live connection that belongs to this session. */
  revokeSession(sessionId: string): void {
    for (const state of [...this.connections.values()]) {
      if (state.auth?.session.id === sessionId) this.drop(state, 'session revoked');
    }
  }

  /**
   * Re-checks every authenticated connection against the account service, which drops any whose
   * session was revoked or aged out. Doubles as the "ping": a connection that is open counts as the
   * device being seen, so a player who leaves the app running stays signed in.
   */
  async recheckSessions(): Promise<void> {
    for (const state of [...this.connections.values()]) {
      if (!state.auth) continue;
      try {
        await this.options.accounts.authenticate(state.auth.token, { ping: true });
      } catch (error) {
        if (error instanceof DomainError) this.drop(state, 'session revoked');
        else throw error;
      }
    }
  }

  /**
   * Tells everyone in the campaign the recording changed (STARTED / PAUSED / RESUMED / STOPPED).
   * Every client plays its own local cue in response; the server never plays audio.
   */
  announceRecording(change: RecordingChange): void {
    this.options.onRecordingChange?.(change);
    this.broadcast(change.campaignId, 'recording.status', {
      campaignId: change.campaignId,
      recordingId: change.recordingId,
      status: change.event,
      startedAt: change.startedAt,
    });
  }

  /** A handout was just shown: tell exactly the people who may now see it (the DM's own sockets included). */
  announceHandoutShown(
    campaignId: string,
    handout: {
      id: string;
      title: string;
      kind: string;
      body?: string | null;
      mediaIds?: string[];
    },
    audience: { everyone: boolean; userIds: string[] },
    dmIds: string[],
  ): void {
    const allowed = new Set([...audience.userIds, ...dmIds]);
    this.broadcast(
      campaignId,
      'handout.shown',
      {
        campaignId,
        handoutId: handout.id,
        title: handout.title,
        kind: handout.kind,
        excerpt: handoutExcerpt(handout.kind, handout.body),
        fileCount: handout.mediaIds?.length ?? 0,
      },
      audience.everyone ? {} : { only: (s) => s.auth !== null && allowed.has(s.auth.user.id) },
    );
  }

  /** Loot changed on the table: everyone sees drops, claims (with who) and removals as they happen. */
  announceLoot(
    event: 'dropped' | 'claimed' | 'removed',
    item: {
      id: string;
      campaignId: string;
      name: string;
      description?: string;
      quantity: number;
      claimedBy: string | null;
      kind: 'item' | 'coin';
      itemType: string;
      rarity: string | null;
      claimedFor: 'self' | 'party' | 'split' | 'assigned' | null;
      split: { shares: { userId: string; amount: number }[]; remainder: number } | null;
    },
  ): void {
    this.broadcast(item.campaignId, `loot.${event}`, {
      campaignId: item.campaignId,
      itemId: item.id,
      name: item.name,
      // The start of the description, for the chat card's expanded view.
      ...(item.description ? { description: item.description.slice(0, 500) } : {}),
      quantity: item.quantity,
      kind: item.kind,
      itemType: item.itemType,
      rarity: item.rarity,
      ...(event === 'claimed'
        ? { claimedBy: item.claimedBy, claimedFor: item.claimedFor, split: item.split }
        : {}),
    });
  }

  /** A handout was hidden or deleted: every client drops it (an unknown id is ignored). */
  announceHandoutRemoved(campaignId: string, handoutId: string): void {
    this.broadcast(campaignId, 'handout.removed', { campaignId, handoutId });
  }

  /** Sends a frame to everyone connected to a campaign (for services that live outside the hub). */
  broadcastToCampaign(campaignId: string, type: string, data: unknown): void {
    this.broadcast(campaignId, type, data);
  }

  /** Sends one frame to every live socket of a person (all their devices), whatever campaign it is about. */
  sendToUser(userId: string, type: string, data: unknown): void {
    for (const state of this.connections.values()) {
      if (state.auth?.user.id === userId) this.send(state, type, data);
    }
  }

  /** Tells a campaign's subscribers that roles/characters changed (e.g. after a DM swap). */
  async announceRosterChanged(campaignId: string): Promise<void> {
    this.broadcast(campaignId, 'roster.changed', { campaignId });
    // And the roster itself, so a changed character or role shows up without a reconnect. Each
    // viewer gets their own view (link stats are the DM's alone).
    const dmIds = await this.dmUserIds(campaignId);
    const forDm = await this.rosterMembers(campaignId, true);
    const forPlayers = await this.rosterMembers(campaignId, false);
    const memberIds = new Set(
      (await this.options.store.listMemberships(campaignId)).map((m) => m.userId),
    );
    for (const state of [...this.connections.values()]) {
      if (!state.auth || !state.campaigns.has(campaignId)) continue;
      // Someone who left (or was removed) must stop hearing the table at once, not at their next
      // reconnect: a live subscription is not a membership.
      if (!memberIds.has(state.auth.user.id)) {
        this.leave(state, campaignId);
        this.options.onMemberRemoved?.(campaignId, state.auth.user.id);
        continue;
      }
      const isDm = dmIds.has(state.auth.user.id);
      this.send(state, 'roster.update', {
        campaignId,
        members: isDm ? forDm : forPlayers,
      });
    }
  }

  close(): void {
    for (const timer of this.emptyTimers.values()) clearTimeout(timer);
    this.emptyTimers.clear();
    this.soundboard?.close();
    for (const state of this.connections.values()) {
      if (state.authTimer) clearTimeout(state.authTimer);
    }
    this.connections.clear();
  }

  // ---- frame handling ----

  private async handle(state: ConnState, raw: string): Promise<void> {
    const parsed = parseClientFrame(raw);
    if (!parsed.ok) {
      this.send(state, 'error', { code: parsed.code, message: parsed.message });
      if (parsed.code === 'unsupported_version') {
        state.conn.close(CloseCode.BadRequest, 'unsupported protocol version');
      } else if (++state.badFrames > this.maxBadFrames) {
        state.conn.close(CloseCode.TooManyErrors, 'too many invalid frames');
      }
      return;
    }

    const { frame } = parsed;
    if (!state.auth) {
      if (frame.type !== 'auth') {
        this.send(state, 'error', { code: 'unauthorized', message: 'authenticate first' });
        state.conn.close(CloseCode.Unauthorized, 'not authenticated');
        return;
      }
      await this.authenticate(state, frame);
      return;
    }

    switch (frame.type) {
      case 'auth':
        this.send(state, 'error', { code: 'already_authenticated', message: 'already signed in' });
        return;
      case 'resume':
        await this.resume(state, frame.data as ClientData<'resume'>);
        return;
      case 'audio.state':
        this.audioState(state, frame.data as ClientData<'audio.state'>);
        return;
      case 'speaking.set':
        this.speaking(state, frame.data as ClientData<'speaking.set'>);
        return;
      case 'stats.report':
        await this.stats(state, frame.data as ClientData<'stats.report'>);
        return;
      case 'chat.message':
        await this.chat(state, frame.data as ClientData<'chat.message'>);
        return;
      case 'recording.ack':
        await this.recordingAck(state, frame.data as ClientData<'recording.ack'>);
        return;
      case 'sound.play':
      case 'sound.stop':
      case 'scene.start':
      case 'scene.stop':
      case 'sound.volume':
        await this.soundFrame(state, frame.type, frame.data);
        return;
      case 'party.create':
      case 'party.rename':
      case 'party.delete':
      case 'party.move':
      case 'party.reset':
        await this.partyFrame(state, frame.type, frame.data);
        return;
    }
  }

  private async authenticate(state: ConnState, frame: ClientFrame): Promise<void> {
    const { token } = frame.data as ClientData<'auth'>;
    try {
      const { user, session } = await this.options.accounts.authenticate(token, { ping: true });
      if (state.authTimer) clearTimeout(state.authTimer);
      state.authTimer = null;
      state.auth = { user, session, token };
      this.send(state, 'auth.ok', { userId: user.id }, { id: frame.id });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      this.send(state, 'auth.revoked', { code: error.code });
      state.conn.close(CloseCode.Unauthorized, 'authentication failed');
    }
  }

  private async resume(state: ConnState, data: ClientData<'resume'>): Promise<void> {
    const auth = state.auth;
    if (!auth) return;
    const { campaignId, lastSeq, epoch } = data;

    const membership = await this.options.store.getMembership(campaignId, auth.user.id);
    if (!membership) {
      this.send(state, 'error', { code: 'forbidden', message: 'not a member of this campaign' });
      return;
    }

    this.cancelAutoStop(campaignId);
    const newlyOnline = !state.campaigns.has(campaignId)
      ? this.presence.connect(campaignId, auth.user.id, state.conn.id)
      : false;
    state.campaigns.add(campaignId);

    const missed =
      lastSeq === undefined
        ? undefined
        : await this.options.replay.since(campaignId, lastSeq, epoch);
    if (missed) {
      for (const event of missed) this.sendEvent(state, campaignId, event);
      this.send(state, 'resumed', {
        campaignId,
        epoch: await this.options.replay.epoch(campaignId),
        seq: await this.options.replay.latestSeq(campaignId),
        replayed: missed.length,
      });
      // Whispers are not in the shared stream, so a replay cannot carry them; send this viewer's own.
      this.send(state, 'chat.whispers', {
        campaignId,
        whispers: await this.recentWhispers(campaignId, auth.user.id),
      });
    } else {
      this.send(
        state,
        'snapshot',
        await this.snapshot(campaignId, membership.role === 'dm', auth.user.id),
      );
    }

    // Who is in which voice group, so a joiner or a reconnect shows the same table.
    if (this.options.parties) {
      this.send(state, 'party.state', { campaignId, ...this.options.parties.snapshot(campaignId) });
    }

    // What is playing now (loops, the scene, volumes), so a late joiner or a reconnect catches up.
    if (this.soundboard) {
      this.send(state, 'sound.state', {
        campaignId,
        ...this.soundboard.snapshot(campaignId, auth.user.id),
      });
    }

    // Always follows the snapshot or the replay, so a client that rejoined mid-recording learns the
    // current state either way — a replay doesn't carry recording changes it missed.
    this.send(state, 'recording.state', {
      campaignId,
      recording: await this.recordingSnapshot(campaignId, auth.user.id),
    });

    if (newlyOnline) {
      this.broadcast(
        campaignId,
        'presence.update',
        { campaignId, userId: auth.user.id, online: true },
        { exclude: state.conn.id },
      );
    }
  }

  private audioState(state: ConnState, data: ClientData<'audio.state'>): void {
    const auth = state.auth;
    if (!auth || !this.subscribed(state, data.campaignId)) return;
    const status = this.presence.setAudio(
      data.campaignId,
      auth.user.id,
      data.inVoice,
      data.muted,
      data.status,
    );
    this.broadcast(data.campaignId, 'audio.update', {
      campaignId: data.campaignId,
      userId: auth.user.id,
      inVoice: data.inVoice,
      muted: data.muted,
      status,
    });
    if (!data.inVoice) {
      // Leaving voice also ends "speaking" and drops stats; tell everyone the speaking bit cleared.
      this.broadcast(data.campaignId, 'speaking.update', {
        campaignId: data.campaignId,
        userId: auth.user.id,
        speaking: false,
      });
    }
  }

  private speaking(state: ConnState, data: ClientData<'speaking.set'>): void {
    const auth = state.auth;
    if (!auth || !this.subscribed(state, data.campaignId)) return;
    if (!this.presence.setSpeaking(data.campaignId, auth.user.id, data.speaking)) return;
    // Ephemeral: broadcast but never buffered for replay (a replayed "speaking" would be a lie).
    this.broadcast(data.campaignId, 'speaking.update', {
      campaignId: data.campaignId,
      userId: auth.user.id,
      speaking: data.speaking,
    });
  }

  /** Connection stats go to the DM only (the connection-status screen), never to all players. */
  private async stats(state: ConnState, data: ClientData<'stats.report'>): Promise<void> {
    const auth = state.auth;
    if (!auth || !this.subscribed(state, data.campaignId)) return;
    const stats = {
      rttMs: data.rttMs,
      jitterMs: data.jitterMs,
      packetLossPct: data.packetLossPct,
      at: this.now(),
    };
    if (!this.presence.setStats(data.campaignId, auth.user.id, stats)) return;

    const dmIds = await this.dmUserIds(data.campaignId);
    this.broadcast(
      data.campaignId,
      'stats.update',
      { campaignId: data.campaignId, userId: auth.user.id, stats },
      { only: (other) => other.auth !== null && dmIds.has(other.auth.user.id) },
    );
  }

  /**
   * A player reports that the start cue finished playing on their machine. Recorded per player per
   * recording (with an expiry), and shown to the DM so they can see who has heard it.
   */
  private async recordingAck(state: ConnState, data: ClientData<'recording.ack'>): Promise<void> {
    const auth = state.auth;
    if (!auth || !this.subscribed(state, data.campaignId)) return;
    const current = this.recording.current(data.campaignId);
    // An ack for a recording that has since ended (or a different one) is stale; say so.
    if (!current || current.recordingId !== data.recordingId) {
      this.send(state, 'error', {
        code: 'stale_recording',
        message: 'that recording is no longer in progress',
      });
      return;
    }
    await this.acks.ack(data.campaignId, data.recordingId, auth.user.id);
    this.options.onRecordingAck?.(data.campaignId, data.recordingId, auth.user.id);
    const dmIds = await this.dmUserIds(data.campaignId);
    this.broadcast(
      data.campaignId,
      'recording.ack.update',
      { campaignId: data.campaignId, recordingId: data.recordingId, userId: auth.user.id },
      { only: (other) => other.auth !== null && dmIds.has(other.auth.user.id) },
    );
  }

  private async chat(state: ConnState, data: ClientData<'chat.message'>): Promise<void> {
    const auth = state.auth;
    if (!auth || !this.subscribed(state, data.campaignId)) return;
    if (!state.chatLimiter.allow('chat')) {
      this.send(state, 'error', { code: 'rate_limited', message: 'slow down' });
      return;
    }
    const name = await this.displayName(data.campaignId, auth.user);
    const id = randomUUID();
    const at = this.now();
    if (data.to !== undefined) {
      await this.whisper(state, data.campaignId, data.to, { id, name, text: data.text, at });
      return;
    }
    await this.options.store.putChatMessage({
      id,
      campaignId: data.campaignId,
      senderId: auth.user.id,
      senderName: name,
      recipientId: null,
      text: data.text,
      at,
    });
    // `id` lets a client that sees the same line twice (replay + history) keep one copy.
    const event = await this.options.replay.append(data.campaignId, 'chat.message', {
      id,
      campaignId: data.campaignId,
      from: { userId: auth.user.id, name },
      text: data.text,
      at,
    });
    this.broadcast(data.campaignId, event.t, event.d, { seq: event.seq });
    this.options.onPublicChat?.(data.campaignId, {
      senderId: auth.user.id,
      senderName: name,
      text: data.text,
      at,
    });
    this.pruneChatSometimes(data.campaignId);
  }

  /**
   * A whisper is private to its sender and recipient (decided 2026-11-07; the DM cannot read
   * player-to-player whispers). It is persisted, but it deliberately does **not** go into the shared
   * replay buffer — every resuming client would be replayed it — and it is sent only to the two
   * people's own sockets. Missed whispers come back per viewer on resume (`recentWhispers`).
   */
  private async whisper(
    state: ConnState,
    campaignId: string,
    toUserId: string,
    line: { id: string; name: string; text: string; at: number },
  ): Promise<void> {
    const auth = state.auth;
    if (!auth) return;
    const recipient =
      toUserId === auth.user.id ? undefined : await this.options.store.getUser(toUserId);
    const membership = recipient
      ? await this.options.store.getMembership(campaignId, recipient.id)
      : undefined;
    if (!recipient || !membership) {
      // Same answer for "not a member" and "yourself", so this cannot be used to probe membership.
      this.send(state, 'error', {
        code: 'invalid_recipient',
        message: 'cannot whisper to that person',
      });
      return;
    }
    await this.options.store.putChatMessage({
      id: line.id,
      campaignId,
      senderId: auth.user.id,
      senderName: line.name,
      recipientId: recipient.id,
      text: line.text,
      at: line.at,
    });
    const payload = {
      id: line.id,
      campaignId,
      from: { userId: auth.user.id, name: line.name },
      to: { userId: recipient.id, name: await this.displayName(campaignId, recipient) },
      text: line.text,
      at: line.at,
    };
    this.broadcast(campaignId, 'chat.whisper', payload, {
      only: (s) => s.auth?.user.id === auth.user.id || s.auth?.user.id === recipient.id,
    });
    this.pruneChatSometimes(campaignId);
  }

  private chatWrites = 0;
  /** Bounded retention (STATE-AND-RESILIENCE.md): trim a campaign's history every so often, not on every line. */
  private pruneChatSometimes(campaignId: string): void {
    if (++this.chatWrites % 50 !== 0) return;
    void this.options.store.pruneChat(campaignId, CHAT_RETENTION_MESSAGES).catch(() => undefined);
  }

  /** This viewer's recent whispers (sent or received), oldest first. Never anyone else's. */
  private async recentWhispers(campaignId: string, viewerId: string) {
    const lines = await this.options.store.listChat(campaignId, viewerId, { limit: 200 });
    const names = new Map<string, string>();
    const nameOf = async (userId: string | null): Promise<string> => {
      if (userId === null) return 'unknown';
      const cached = names.get(userId);
      if (cached !== undefined) return cached;
      const user = await this.options.store.getUser(userId);
      const name = user ? await this.displayName(campaignId, user) : 'unknown';
      names.set(userId, name);
      return name;
    };
    const whispers: ChatMessage[] = lines.filter((m) => m.recipientId !== null).slice(-50);
    return Promise.all(
      whispers.map(async (m) => ({
        id: m.id,
        campaignId,
        from: { userId: m.senderId, name: m.senderName },
        to: { userId: m.recipientId, name: await nameOf(m.recipientId) },
        text: m.text,
        at: m.at,
      })),
    );
  }

  /**
   * The DM's soundboard controls. Only the campaign's DM may send these, and only for sounds and
   * scenes in their own library (the runtime checks); a player's attempt is refused, not ignored.
   */
  private async soundFrame(state: ConnState, type: string, raw: unknown): Promise<void> {
    const auth = state.auth;
    const data = raw as { campaignId: string };
    if (!auth || !this.subscribed(state, data.campaignId)) return;
    const refuse = (code: string, message: string) => this.send(state, 'error', { code, message });
    if (!this.soundboard)
      return refuse('unavailable', 'the soundboard is not enabled on this server');
    const membership = await this.options.store.getMembership(data.campaignId, auth.user.id);
    if (membership?.role !== 'dm') return refuse('forbidden', 'only the DM can use the soundboard');
    if (!this.soundLimiter.allow(`${state.conn.id}`)) return refuse('rate_limited', 'slow down');
    const c = data.campaignId;
    try {
      switch (type) {
        case 'sound.play': {
          const d = raw as ClientData<'sound.play'>;
          await this.soundboard.play(c, auth.user.id, {
            soundId: d.soundId,
            ...(d.takeId !== undefined ? { takeId: d.takeId } : {}),
            ...(d.mode !== undefined ? { mode: d.mode } : {}),
            ...(d.volume !== undefined ? { volume: d.volume } : {}),
            ...(d.to !== undefined ? { to: d.to } : {}),
          });
          return;
        }
        case 'sound.stop':
          this.soundboard.stop(c, (raw as ClientData<'sound.stop'>).playId);
          return;
        case 'scene.start':
          await this.soundboard.startScene(
            c,
            auth.user.id,
            (raw as ClientData<'scene.start'>).sceneId,
          );
          return;
        case 'scene.stop':
          this.soundboard.stopScene(c);
          return;
        case 'sound.volume': {
          const d = raw as ClientData<'sound.volume'>;
          if (d.master !== undefined) this.soundboard.setMaster(c, d.master);
          if (d.player) this.soundboard.setPlayerGain(c, d.player.userId, d.player.gain);
          return;
        }
      }
    } catch (error) {
      if (error instanceof DomainError) return refuse(error.code, error.message);
      throw error;
    }
  }

  /** Voice-group controls: the campaign's DM only. Players are refused, not ignored. */
  private async partyFrame(state: ConnState, type: string, raw: unknown): Promise<void> {
    const auth = state.auth;
    const data = raw as { campaignId: string };
    if (!auth || !this.subscribed(state, data.campaignId)) return;
    const refuse = (code: string, message: string) => this.send(state, 'error', { code, message });
    const parties = this.options.parties;
    if (!parties) return refuse('unavailable', 'voice groups are not enabled on this server');
    const membership = await this.options.store.getMembership(data.campaignId, auth.user.id);
    if (membership?.role !== 'dm')
      return refuse('forbidden', 'only the DM can manage voice groups');
    if (!this.soundLimiter.allow(`party:${state.conn.id}`))
      return refuse('rate_limited', 'slow down');
    const c = data.campaignId;
    try {
      switch (type) {
        case 'party.create':
          {
            const d = raw as ClientData<'party.create'>;
            await parties.create(c, d.name, d.members);
          }
          return;
        case 'party.rename': {
          const d = raw as ClientData<'party.rename'>;
          await parties.rename(c, d.partyId, d.name);
          return;
        }
        case 'party.delete':
          await parties.delete(c, (raw as ClientData<'party.delete'>).partyId);
          return;
        case 'party.move': {
          const d = raw as ClientData<'party.move'>;
          await parties.move(c, d.userId, d.partyId);
          return;
        }
        case 'party.reset':
          await parties.reset(c);
          return;
      }
    } catch (error) {
      if (error instanceof DomainError) return refuse(error.code, error.message);
      throw error;
    }
  }

  // ---- helpers ----

  private subscribed(state: ConnState, campaignId: string): boolean {
    if (state.campaigns.has(campaignId)) return true;
    this.send(state, 'error', {
      code: 'not_subscribed',
      message: 'send "resume" for this campaign first',
    });
    return false;
  }

  /**
   * How long (ms) the campaign's DM has had no connection: 0 while they are connected. Players may only
   * step in on a recording once this passes the grace period.
   */
  async dmAwayMs(campaignId: string): Promise<number> {
    const dm = (await this.options.store.listMemberships(campaignId)).find((m) => m.role === 'dm');
    if (!dm) return 0;
    if (this.presence.snapshot(campaignId).some((p) => p.userId === dm.userId && p.online))
      return 0;
    const since = this.lastOnline.get(`${campaignId}:${dm.userId}`) ?? this.startedAt;
    return Math.max(0, this.now() - since);
  }

  /** Nobody connected to a recorded campaign: stop it if that lasts longer than the grace period. */
  private maybeAutoStop(campaignId: string): void {
    if (this.presence.snapshot(campaignId).some((p) => p.online)) return;
    if (!this.recording.current(campaignId) || this.emptyTimers.has(campaignId)) return;
    const timer = setTimeout(() => {
      this.emptyTimers.delete(campaignId);
      if (this.presence.snapshot(campaignId).some((p) => p.online)) return;
      if (!this.recording.current(campaignId)) return;
      console.warn(`[recording] ${campaignId}: nobody connected for the grace period; stopping`);
      this.announceRecording(this.recording.stop(campaignId));
    }, this.graceMs);
    timer.unref();
    this.emptyTimers.set(campaignId, timer);
  }

  private cancelAutoStop(campaignId: string): void {
    const timer = this.emptyTimers.get(campaignId);
    if (timer) clearTimeout(timer);
    this.emptyTimers.delete(campaignId);
  }

  private leave(state: ConnState, campaignId: string): void {
    const auth = state.auth;
    if (!auth) return;
    state.campaigns.delete(campaignId);
    // Nobody left at this table: stop its scene timers rather than let them run for no one.
    if (![...this.connections.values()].some((s) => s !== state && s.campaigns.has(campaignId))) {
      this.soundboard?.reset(campaignId);
      this.options.parties?.forgetTable(campaignId);
    }
    if (this.presence.disconnect(campaignId, auth.user.id, state.conn.id)) {
      this.lastOnline.set(`${campaignId}:${auth.user.id}`, this.now());
      this.maybeAutoStop(campaignId);
      this.broadcast(campaignId, 'presence.update', {
        campaignId,
        userId: auth.user.id,
        online: false,
      });
    }
  }

  private drop(state: ConnState, reason: string): void {
    this.send(state, 'auth.revoked', { code: 'session_invalid' });
    state.conn.close(CloseCode.Unauthorized, reason);
    this.closed(state.conn.id);
  }

  /** Everyone in the campaign as a client lists them: account, active character, presence, and (for the DM) link stats. */
  private async rosterMembers(campaignId: string, viewerIsDm: boolean) {
    const { store } = this.options;
    const memberships = await store.listMemberships(campaignId);
    const live = new Map(this.presence.snapshot(campaignId).map((p) => [p.userId, p]));
    const members = [];
    for (const membership of memberships) {
      const user = await store.getUser(membership.userId);
      if (!user) continue;
      const character = membership.activeCharacterId
        ? await store.getCharacter(membership.activeCharacterId)
        : undefined;
      const presence = live.get(user.id);
      members.push({
        userId: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl ?? null,
        role: membership.role,
        character: character
          ? {
              name: character.name,
              avatarUrl: character.avatarUrl,
              className: character.className,
              race: character.race,
              level: character.level,
            }
          : null,
        online: presence?.online ?? false,
        inVoice: presence?.inVoice ?? false,
        muted: presence?.muted ?? true,
        status: presence?.status ?? 'offline',
        speaking: presence?.speaking ?? false,
        ...(viewerIsDm ? { stats: presence?.stats ?? null } : {}),
      });
    }
    return members;
  }

  private async snapshot(campaignId: string, viewerIsDm: boolean, viewerId: string) {
    const { replay } = this.options;
    const members = await this.rosterMembers(campaignId, viewerIsDm);

    const recent = await replay.recent(campaignId, 50);
    return {
      campaignId,
      epoch: await replay.epoch(campaignId),
      seq: await replay.latestSeq(campaignId),
      members,
      recentChat: recent
        .filter((event) => CHAT_KINDS.has(event.t))
        .map((event) => ({ seq: event.seq, ...(event.d as object) })),
      // Unread notifications, the viewer's own (missed while the app was closed).
      notifications: this.options.schedule
        ? (
            await this.options.schedule.listNotifications(viewerId, { unreadOnly: true, limit: 50 })
          ).map(notificationView)
        : [],
      // Only this viewer's own whispers; never part of the shared stream.
      recentWhispers: await this.recentWhispers(campaignId, viewerId),
    };
  }

  /**
   * The *current* recording state for a joining client, including whether this person has already
   * heard the cue. The client decides from `acknowledged` whether to play it — a blip-reconnect
   * says `true` and stays quiet; a late joiner says `false` and hears it before being captured.
   */
  private async recordingSnapshot(campaignId: string, viewerId: string) {
    const current = this.recording.current(campaignId);
    if (!current) return null;
    return {
      recordingId: current.recordingId,
      status: current.status,
      startedAt: current.startedAt,
      graceSeconds: Math.round(this.graceMs / 1000),
      acknowledged: await this.acks.hasAcked(campaignId, current.recordingId, viewerId),
    };
  }

  private async dmUserIds(campaignId: string): Promise<Set<string>> {
    const memberships = await this.options.store.listMemberships(campaignId);
    return new Set(memberships.filter((m) => m.role === 'dm').map((m) => m.userId));
  }

  private async displayName(campaignId: string, user: User): Promise<string> {
    const membership = await this.options.store.getMembership(campaignId, user.id);
    const character = membership?.activeCharacterId
      ? await this.options.store.getCharacter(membership.activeCharacterId)
      : undefined;
    return character?.name ?? user.displayName;
  }

  private send(
    state: ConnState,
    t: string,
    d: unknown,
    options: { seq?: number; id?: string | undefined } = {},
  ): void {
    state.conn.send(
      serverFrame(t, d, {
        ts: this.now(),
        ...(options.seq === undefined ? {} : { seq: options.seq }),
        ...(options.id === undefined ? {} : { id: options.id }),
      }),
    );
  }

  private sendEvent(state: ConnState, _campaignId: string, event: BufferedEvent): void {
    this.send(state, event.t, event.d, { seq: event.seq });
  }

  private broadcast(
    campaignId: string,
    t: string,
    d: unknown,
    options: { seq?: number; exclude?: string; only?: (state: ConnState) => boolean } = {},
  ): void {
    for (const state of this.connections.values()) {
      if (!state.auth || !state.campaigns.has(campaignId)) continue;
      if (options.exclude === state.conn.id) continue;
      if (options.only && !options.only(state)) continue;
      this.send(state, t, d, options.seq === undefined ? {} : { seq: options.seq });
    }
  }
}

// Re-exported so the transport adapter and tests share one source of truth for valid frame types.
export const CLIENT_FRAME_TYPES = Object.keys(clientData) as ClientType[];
