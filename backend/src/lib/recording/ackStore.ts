/**
 * "This player has heard the recording-start cue for this recording." Tracked per player per
 * recording, and it **expires**: a network blip doesn't replay the cue, but someone who was away
 * for a while hears it again (CLAUDE.md §8.4).
 *
 * The state is ephemeral by design, which is why the plan is Valkey with a TTL; the in-memory
 * implementation is the fallback and the test double. Sign-up consent (the standing agreement) is
 * a separate, durable record on the user.
 */
export interface AckStore {
  ack(campaignId: string, recordingId: string, userId: string): Promise<void>;
  hasAcked(campaignId: string, recordingId: string, userId: string): Promise<boolean>;
  /** Who has heard the cue for this recording — shown to the DM. */
  ackedBy(campaignId: string, recordingId: string): Promise<string[]>;
}

export interface MemoryAckStoreOptions {
  ttlMs?: number;
  now?: () => number;
}

/**
 * 30 minutes: long enough to ride out a Wi-Fi drop or a laptop sleep during a session, short
 * enough that someone who wandered off for the evening hears it again. An assumption pending
 * Andy's say-so — it is one constant.
 */
export const DEFAULT_ACK_TTL_MS = 30 * 60_000;

export class MemoryAckStore implements AckStore {
  private readonly acks = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: MemoryAckStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_ACK_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async ack(campaignId: string, recordingId: string, userId: string): Promise<void> {
    this.acks.set(key(campaignId, recordingId, userId), this.now() + this.ttlMs);
    this.prune();
  }

  async hasAcked(campaignId: string, recordingId: string, userId: string): Promise<boolean> {
    const expiresAt = this.acks.get(key(campaignId, recordingId, userId));
    return expiresAt !== undefined && expiresAt > this.now();
  }

  async ackedBy(campaignId: string, recordingId: string): Promise<string[]> {
    const prefix = `${campaignId}:${recordingId}:`;
    const now = this.now();
    const users: string[] = [];
    for (const [k, expiresAt] of this.acks) {
      if (k.startsWith(prefix) && expiresAt > now) users.push(k.slice(prefix.length));
    }
    return users;
  }

  private prune(): void {
    if (this.acks.size < 1_000) return;
    const now = this.now();
    for (const [k, expiresAt] of this.acks) if (expiresAt <= now) this.acks.delete(k);
  }
}

const key = (campaignId: string, recordingId: string, userId: string): string =>
  `${campaignId}:${recordingId}:${userId}`;
