import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import type { AudioRouter } from './audioRouter.js';
import { PartyState, type Party } from './partyState.js';

export interface PartyDeps {
  store: Store;
  /** Without a router (no LiveKit) parties are tracked and announced but nothing is enforced. */
  router: AudioRouter | undefined;
  emit: (campaignId: string, type: string, data: unknown) => void;
  log?: (line: string) => void;
}

/**
 * Voice groups for each table: the party model (partyState.ts) plus enforcing it in LiveKit.
 *
 * Enforcement (decided: one room, the DM controls who hears whom): for every listener the server
 * unsubscribes them from the tracks of people they must not hear, and re-subscribes them when the
 * split ends. A track that appears later is auto-subscribed by LiveKit, so a check every couple of
 * seconds while the table is split removes it again. This is **cooperative isolation, not a security
 * boundary**: a tampered client could subscribe itself. All groups are still recorded (Egress records
 * what each person publishes, whoever is listening).
 */
export class PartyService {
  private readonly tables = new Map<string, PartyState>();
  /** Per table: tracks we have unsubscribed each listener from, so changes are applied as a diff. */
  private readonly unsubscribed = new Map<string, Map<string, Set<string>>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private reconciling = new Map<string, Promise<void>>();

  constructor(private readonly deps: PartyDeps) {}

  private state(campaignId: string): PartyState {
    let s = this.tables.get(campaignId);
    if (!s) {
      s = new PartyState();
      this.tables.set(campaignId, s);
    }
    return s;
  }

  snapshot(campaignId: string) {
    return (
      this.tables.get(campaignId)?.snapshot() ?? { parties: [], assignments: {}, split: false }
    );
  }

  private announce(campaignId: string): void {
    this.deps.emit(campaignId, 'party.state', { campaignId, ...this.snapshot(campaignId) });
  }

  /** Runs `change`, tells the table, and applies it in LiveKit. */
  private async changed(campaignId: string, change: (s: PartyState) => void): Promise<void> {
    change(this.state(campaignId));
    this.announce(campaignId);
    await this.reconcile(campaignId);
  }

  async create(campaignId: string, name: string): Promise<Party> {
    let party: Party | undefined;
    await this.changed(campaignId, (s) => {
      party = s.create(name);
    });
    return party as unknown as Party;
  }
  rename(campaignId: string, partyId: string, name: string) {
    return this.changed(campaignId, (s) => void s.rename(partyId, name));
  }
  delete(campaignId: string, partyId: string) {
    return this.changed(campaignId, (s) => s.delete(partyId));
  }
  reset(campaignId: string) {
    return this.changed(campaignId, (s) => s.reset());
  }

  /** Puts a player in a party (or back at the main table). Only players can be moved: the DM is in every group. */
  async move(campaignId: string, userId: string, partyId: string | null): Promise<void> {
    const m = await this.deps.store.getMembership(campaignId, userId);
    if (!m) throw new DomainError('invalid_input', 'that person is not in this campaign');
    if (m.role === 'dm')
      throw new DomainError('invalid_input', 'the DM is in every group and cannot be moved');
    await this.changed(campaignId, (s) => s.move(userId, partyId));
  }

  /** A player left the campaign: take them out of any party. */
  async forget(campaignId: string, userId: string): Promise<void> {
    const s = this.tables.get(campaignId);
    if (!s) return;
    s.forget(userId);
    this.announce(campaignId);
    await this.reconcile(campaignId);
  }

  /** Applies the current groups to LiveKit. Calls for one table run one at a time. */
  reconcile(campaignId: string): Promise<void> {
    const previous = this.reconciling.get(campaignId) ?? Promise.resolve();
    const next = previous
      .then(() => this.apply(campaignId))
      .catch((error: unknown) => {
        this.deps.log?.(
          `party enforcement (${campaignId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    this.reconciling.set(campaignId, next);
    return next;
  }

  private async apply(campaignId: string): Promise<void> {
    const { router, store } = this.deps;
    const state = this.tables.get(campaignId);
    const applied = this.unsubscribed.get(campaignId);
    if (!router || !state || (!state.split && !applied)) return;

    const dmIds = new Set(
      (await store.listMemberships(campaignId)).filter((m) => m.role === 'dm').map((m) => m.userId),
    );
    const people = await router.participants(campaignId);
    const owner = new Map<string, string>(); // track sid → who publishes it
    for (const p of people) for (const sid of p.audioTrackSids) owner.set(sid, p.identity);

    const nextApplied = new Map<string, Set<string>>();
    for (const listener of people) {
      const before = applied?.get(listener.identity) ?? new Set<string>();
      const mustNotHear = new Set<string>();
      if (state.split) {
        for (const [sid, speaker] of owner) {
          if (speaker !== listener.identity && !state.hears(listener.identity, speaker, dmIds))
            mustNotHear.add(sid);
        }
      }
      const toUnsubscribe = [...mustNotHear].filter((sid) => !before.has(sid));
      // Re-subscribe what we had cut off and may now be heard again (and only tracks that still exist).
      const toSubscribe = [...before].filter((sid) => !mustNotHear.has(sid) && owner.has(sid));
      if (toUnsubscribe.length > 0)
        await router.setSubscription(campaignId, listener.identity, toUnsubscribe, false);
      if (toSubscribe.length > 0)
        await router.setSubscription(campaignId, listener.identity, toSubscribe, true);
      if (mustNotHear.size > 0) nextApplied.set(listener.identity, mustNotHear);
    }
    if (nextApplied.size === 0 && !state.split) this.unsubscribed.delete(campaignId);
    else this.unsubscribed.set(campaignId, nextApplied);
  }

  /** While a table is split, re-check every few seconds so a newly published track is cut off again. */
  startTicking(intervalMs = 2000): void {
    this.timer ??= setInterval(() => {
      for (const [campaignId, s] of this.tables) if (s.split) void this.reconcile(campaignId);
    }, intervalMs);
    this.timer.unref();
  }

  /** Nobody is connected to this table any more: forget its groups. */
  forgetTable(campaignId: string): void {
    this.tables.delete(campaignId);
    this.unsubscribed.delete(campaignId);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
