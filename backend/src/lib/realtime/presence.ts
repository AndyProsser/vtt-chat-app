export interface Stats {
  rttMs: number;
  jitterMs: number;
  packetLossPct: number;
  at: number;
}

export interface UserPresence {
  userId: string;
  /** At least one open, authenticated connection subscribed to the campaign. */
  online: boolean;
  /** Connected to the voice room. Only voice clients report anything beyond online/offline. */
  inVoice: boolean;
  muted: boolean;
  speaking: boolean;
  /** Latest sample only — this is a status screen, not a metrics database. */
  stats: Stats | null;
}

interface Entry {
  connections: Set<string>;
  inVoice: boolean;
  muted: boolean;
  speaking: boolean;
  stats: Stats | null;
}

/**
 * Live connection state, kept in the backend process (SYNC-PROTOCOL.md, "Where live state
 * lives"). It is rebuilt for free after a restart because every client reconnects and re-announces,
 * so it needs no persistence and no fallback store.
 */
export class PresenceTracker {
  private readonly campaigns = new Map<string, Map<string, Entry>>();

  /** Returns `true` if this connection made the user newly online in the campaign. */
  connect(campaignId: string, userId: string, connectionId: string): boolean {
    const entry = this.entry(campaignId, userId);
    const wasOnline = entry.connections.size > 0;
    entry.connections.add(connectionId);
    return !wasOnline;
  }

  /** Returns `true` if that was the user's last connection (they just went offline). */
  disconnect(campaignId: string, userId: string, connectionId: string): boolean {
    const users = this.campaigns.get(campaignId);
    const entry = users?.get(userId);
    if (!users || !entry) return false;
    entry.connections.delete(connectionId);
    if (entry.connections.size > 0) return false;
    // Offline means no voice state either; forget it all so a stale "speaking" can't linger.
    users.delete(userId);
    if (users.size === 0) this.campaigns.delete(campaignId);
    return true;
  }

  setAudio(campaignId: string, userId: string, inVoice: boolean, muted: boolean): void {
    const entry = this.existing(campaignId, userId);
    if (!entry) return;
    entry.inVoice = inVoice;
    entry.muted = muted;
    if (!inVoice) {
      entry.speaking = false;
      entry.stats = null;
    }
  }

  /** Returns `true` if the value changed (so callers can skip redundant broadcasts). */
  setSpeaking(campaignId: string, userId: string, speaking: boolean): boolean {
    const entry = this.existing(campaignId, userId);
    if (!entry?.inVoice || entry.speaking === speaking) return false;
    entry.speaking = speaking;
    return true;
  }

  setStats(campaignId: string, userId: string, stats: Stats): boolean {
    const entry = this.existing(campaignId, userId);
    if (!entry?.inVoice) return false;
    entry.stats = stats;
    return true;
  }

  isOnline(campaignId: string, userId: string): boolean {
    return (this.campaigns.get(campaignId)?.get(userId)?.connections.size ?? 0) > 0;
  }

  /** Everyone currently online in a campaign. */
  snapshot(campaignId: string): UserPresence[] {
    const users = this.campaigns.get(campaignId);
    if (!users) return [];
    return [...users.entries()].map(([userId, entry]) => ({
      userId,
      online: entry.connections.size > 0,
      inVoice: entry.inVoice,
      muted: entry.muted,
      speaking: entry.speaking,
      stats: entry.stats,
    }));
  }

  private entry(campaignId: string, userId: string): Entry {
    let users = this.campaigns.get(campaignId);
    if (!users) {
      users = new Map();
      this.campaigns.set(campaignId, users);
    }
    let entry = users.get(userId);
    if (!entry) {
      entry = { connections: new Set(), inVoice: false, muted: true, speaking: false, stats: null };
      users.set(userId, entry);
    }
    return entry;
  }

  private existing(campaignId: string, userId: string): Entry | undefined {
    return this.campaigns.get(campaignId)?.get(userId);
  }
}
