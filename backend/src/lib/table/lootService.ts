import { randomUUID } from 'node:crypto';

import type { User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import type { LootItem, TableStore } from './tableStore.js';

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
    input: { name: string; description?: string; quantity?: number },
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
      name,
      description,
      quantity,
      droppedBy: user.id,
      droppedAt: this.now(),
      claimedBy: null,
      claimedAt: null,
    };
    await this.deps.table.putLoot(item);
    return item;
  }

  /** The first caller gets the item; everyone after is told it is already taken. */
  async claim(user: User, campaignId: string, itemId: string): Promise<LootItem> {
    if ((await this.role(user, campaignId)) === 'dm') {
      throw new DomainError('forbidden', 'the DM hands loot out and cannot claim it');
    }
    const existing = await this.deps.table.getLoot(itemId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    const claimed = await this.deps.table.claimLoot(itemId, user.id, this.now());
    if (!claimed) throw new DomainError('conflict', 'someone already picked that up');
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
