import { randomUUID } from 'node:crypto';

import type { User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import type { ClaimedFor, LootItem, LootKind, TableStore } from './tableStore.js';

export interface LootDeps {
  store: Store;
  table: TableStore;
  now?: () => number;
  newId?: () => string;
}

/**
 * Loot the DM drops and players pick up. Dropping shows it to every member at once; the first
 * player to claim an item gets it, exactly once, and who and when is kept ("so it is known an item
 * was collected" — CLAUDE.md §8.6). The DM cannot claim: they are handing it out, not collecting.
 */
export class LootService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: LootDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  private async role(user: User, campaignId: string): Promise<'dm' | 'player'> {
    const m = await this.deps.store.getMembership(campaignId, user.id);
    if (!m) throw new DomainError('forbidden', 'not a member of this campaign');
    return m.role;
  }

  async list(user: User, campaignId: string): Promise<LootItem[]> {
    await this.role(user, campaignId);
    return this.deps.table.listLoot(campaignId);
  }

  async drop(
    user: User,
    campaignId: string,
    input: { name: string; description?: string; quantity?: number; kind?: LootKind },
  ): Promise<LootItem> {
    if ((await this.role(user, campaignId)) !== 'dm')
      throw new DomainError('forbidden', 'only the DM can drop loot');
    const name = input.name.trim();
    if (name.length < 1 || name.length > 200)
      throw new DomainError('invalid_input', 'name must be 1–200 characters');
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
      throw new DomainError('invalid_input', 'quantity must be a whole number from 1 to 100000');
    }
    const description = (input.description ?? '').trim();
    if (description.length > 2000)
      throw new DomainError('invalid_input', 'description is too long');
    const item: LootItem = {
      id: this.newId(),
      campaignId,
      kind: input.kind ?? 'item',
      name,
      description,
      quantity,
      droppedBy: user.id,
      droppedAt: this.now(),
      claimedBy: null,
      claimedAt: null,
      claimedFor: null,
      split: null,
    };
    await this.deps.table.putLoot(item);
    return item;
  }

  /**
   * The first caller gets the item; everyone after is told it is already taken. `forWhom` says
   * whether they took it for themselves or for the party (it stays in the shared pool, marked with
   * who took it — the app is a record of the table, not of anyone's character sheet).
   */
  async claim(
    user: User,
    campaignId: string,
    itemId: string,
    forWhom: Exclude<ClaimedFor, 'split'> = 'self',
  ): Promise<LootItem> {
    if ((await this.role(user, campaignId)) === 'dm') {
      throw new DomainError('forbidden', 'the DM hands loot out and cannot claim it');
    }
    const existing = await this.deps.table.getLoot(itemId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    const claimed = await this.deps.table.claimLoot(itemId, user.id, this.now(), forWhom);
    if (!claimed) throw new DomainError('conflict', 'someone already picked that up');
    return claimed;
  }

  /**
   * Splits a pile of coin equally. Recipients default to **every player in the campaign, online or
   * not** (the DM is handing coin out, so is not a recipient); a caller may name a subset. Each
   * player gets `floor(amount / n)`; what does not divide stays in the pool as the remainder. The
   * DM or any player may split; like a claim it can happen once, atomically.
   */
  async split(
    user: User,
    campaignId: string,
    itemId: string,
    userIds?: string[],
  ): Promise<LootItem> {
    await this.role(user, campaignId);
    const existing = await this.deps.table.getLoot(itemId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    if (existing.kind !== 'coin') throw new DomainError('invalid_input', 'only coin can be split');
    const players = (await this.deps.store.listMemberships(campaignId))
      .filter((m) => m.role === 'player')
      .map((m) => m.userId);
    const recipients = userIds === undefined ? players : [...new Set(userIds)];
    if (recipients.length === 0 || recipients.some((id) => !players.includes(id))) {
      throw new DomainError(
        'invalid_input',
        'a split goes to one or more players in this campaign',
      );
    }
    const each = Math.floor(existing.quantity / recipients.length);
    const split = {
      shares: recipients.map((id) => ({ userId: id, amount: each })),
      remainder: existing.quantity - each * recipients.length,
    };
    const claimed = await this.deps.table.claimLoot(itemId, user.id, this.now(), 'split', split);
    if (!claimed) throw new DomainError('conflict', 'that pile was already taken or split');
    return claimed;
  }

  /** The DM takes an item back off the table, claimed or not. */
  async remove(user: User, campaignId: string, itemId: string): Promise<LootItem> {
    if ((await this.role(user, campaignId)) !== 'dm')
      throw new DomainError('forbidden', 'only the DM can remove loot');
    const existing = await this.deps.table.getLoot(itemId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    await this.deps.table.deleteLoot(itemId);
    return existing;
  }
}
