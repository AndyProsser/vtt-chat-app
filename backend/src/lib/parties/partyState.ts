import { randomUUID } from 'node:crypto';

import { DomainError } from '../errors.js';

export const MAX_PARTIES = 8;

export interface Party {
  id: string;
  name: string;
}

export interface PartySnapshot {
  parties: Party[];
  /** Player id → party id. Players not listed are at the main table. */
  assignments: Record<string, string>;
  /** `true` while any party exists: the table is split. */
  split: boolean;
}

/**
 * Who is in which voice group at one table. The model is the one Andy chose (2026-11-07): one room,
 * the **DM is in every group** (hears everyone, heard by everyone), and **players hear only their own
 * group**; players not placed anywhere are at the "main table" together. Pure and in memory — a
 * server restart returns everyone to the main table, which is the safe direction.
 */
export class PartyState {
  private parties = new Map<string, Party>();
  private assignments = new Map<string, string>();

  constructor(private readonly newId: () => string = randomUUID) {}

  get split(): boolean {
    return this.parties.size > 0;
  }

  create(name: string): Party {
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 60)
      throw new DomainError('invalid_input', 'a party name must be 1–60 characters');
    if (this.parties.size >= MAX_PARTIES)
      throw new DomainError('conflict', `at most ${MAX_PARTIES} parties`);
    const party = { id: this.newId(), name: clean };
    this.parties.set(party.id, party);
    return party;
  }

  rename(partyId: string, name: string): Party {
    const party = this.require(partyId);
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 60)
      throw new DomainError('invalid_input', 'a party name must be 1–60 characters');
    party.name = clean;
    return { ...party };
  }

  /** Removes a party; its players return to the main table. */
  delete(partyId: string): void {
    this.require(partyId);
    this.parties.delete(partyId);
    for (const [user, party] of [...this.assignments])
      if (party === partyId) this.assignments.delete(user);
  }

  /** Puts a player in a party, or back at the main table with `null`. The caller checks they are a player here. */
  move(userId: string, partyId: string | null): void {
    if (partyId === null) {
      this.assignments.delete(userId);
      return;
    }
    this.require(partyId);
    this.assignments.set(userId, partyId);
  }

  /** Everyone back together. */
  reset(): void {
    this.parties.clear();
    this.assignments.clear();
  }

  /** Drops a player who left the campaign. */
  forget(userId: string): void {
    this.assignments.delete(userId);
  }

  /** Which group a player is in: a party id, or `null` for the main table. */
  groupOf(userId: string): string | null {
    return this.assignments.get(userId) ?? null;
  }

  /**
   * Whether `listener` hears `speaker`. The DM (`dmIds`) hears and is heard by everyone; two players
   * hear each other only in the same group; the main table counts as one group.
   */
  hears(listener: string, speaker: string, dmIds: ReadonlySet<string>): boolean {
    if (listener === speaker) return false;
    if (dmIds.has(listener) || dmIds.has(speaker)) return true;
    return this.groupOf(listener) === this.groupOf(speaker);
  }

  snapshot(): PartySnapshot {
    return {
      parties: [...this.parties.values()].map((p) => ({ ...p })),
      assignments: Object.fromEntries(this.assignments),
      split: this.split,
    };
  }

  private require(partyId: string): Party {
    const party = this.parties.get(partyId);
    if (!party) throw new DomainError('not_found', 'no such party');
    return party;
  }
}
