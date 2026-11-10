import { randomUUID } from 'node:crypto';

import {
  findItem,
  isItemType,
  isRarity,
  searchItems,
  type ItemQuery,
  type ItemType,
  type Rarity,
  type SrdItem,
} from '@vtt-chat-app/shared';

import { rerollDraft, rollHoard, rollIndividual, type Draft } from '../loot/generator.js';

import type { User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';
import type { ClaimedFor, LootItem, LootKind, TableStore } from './tableStore.js';

/** What the DM sends to drop something. Give an SRD `srdId`, or a `name` for a custom item. */
export interface DropInput {
  name?: string;
  description?: string;
  quantity?: number;
  kind?: LootKind;
  itemType?: string;
  rarity?: string | null;
  srdId?: string;
  /** Give it straight to this player (a player of the campaign) instead of leaving it in the pool. */
  assignTo?: string;
}

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

  /** Checks one drop and turns it into an item (not yet stored). */
  private build(user: User, campaignId: string, input: DropInput): LootItem {
    const srd = input.srdId === undefined ? undefined : findItem(input.srdId);
    if (input.srdId !== undefined && !srd) {
      throw new DomainError('invalid_input', 'that is not an item in the SRD');
    }
    const name = (input.name ?? srd?.name ?? '').trim();
    if (name.length < 1 || name.length > 200)
      throw new DomainError('invalid_input', 'name must be 1–200 characters');
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
      throw new DomainError('invalid_input', 'quantity must be a whole number from 1 to 100000');
    }
    const description = (input.description ?? srd?.blurb ?? '').trim();
    if (description.length > 2000)
      throw new DomainError('invalid_input', 'description is too long');
    const kind = input.kind ?? 'item';
    if (input.itemType !== undefined && !isItemType(input.itemType)) {
      throw new DomainError('invalid_input', 'unknown item type');
    }
    if (input.rarity != null && !isRarity(input.rarity)) {
      throw new DomainError('invalid_input', 'unknown rarity');
    }
    const itemType: ItemType =
      kind === 'coin' ? 'coin' : ((input.itemType as ItemType | undefined) ?? srd?.type ?? 'other');
    const rarity: Rarity | null =
      kind === 'coin'
        ? null
        : input.rarity !== undefined
          ? (input.rarity as Rarity | null)
          : (srd?.rarity ?? null);
    return {
      id: this.newId(),
      campaignId,
      kind,
      itemType,
      rarity,
      srdId: srd?.id ?? null,
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
  }

  private async requireDm(user: User, campaignId: string): Promise<void> {
    if ((await this.role(user, campaignId)) !== 'dm')
      throw new DomainError('forbidden', 'only the DM can drop loot');
  }

  /** The SRD item catalog, for picking something to drop. Any member of the campaign may look. */
  async catalog(user: User, campaignId: string, query: ItemQuery): Promise<SrdItem[]> {
    await this.role(user, campaignId);
    return searchItems(query);
  }

  /** A random treasure roll for the DM to look over. Nothing is stored until it is dropped. */
  async roll(
    user: User,
    campaignId: string,
    input: { cr: number; kind: 'individual' | 'hoard' },
  ): Promise<Draft[]> {
    await this.requireDm(user, campaignId);
    return input.kind === 'hoard' ? rollHoard(input.cr) : rollIndividual(input.cr);
  }

  /** Swaps one entry of a preview for another of the same kind. */
  async rerollEntry(user: User, campaignId: string, cr: number, draft: Draft): Promise<Draft> {
    await this.requireDm(user, campaignId);
    return rerollDraft(draft, cr);
  }

  /** Every recipient must be a player of this campaign; checked before anything is stored. */
  private async requirePlayers(campaignId: string, ids: string[]): Promise<void> {
    for (const id of new Set(ids)) {
      const m = await this.deps.store.getMembership(campaignId, id);
      if (!m || m.role !== 'player') {
        throw new DomainError(
          'invalid_input',
          'an item can only be given to a player in this campaign',
        );
      }
    }
  }

  private async store(item: LootItem, assignTo: string | undefined): Promise<LootItem> {
    await this.deps.table.putLoot(item);
    if (assignTo === undefined) return item;
    return (await this.deps.table.claimLoot(item.id, assignTo, this.now(), 'assigned')) ?? item;
  }

  async drop(user: User, campaignId: string, input: DropInput): Promise<LootItem> {
    await this.requireDm(user, campaignId);
    const item = this.build(user, campaignId, input);
    if (input.assignTo !== undefined) await this.requirePlayers(campaignId, [input.assignTo]);
    return this.store(item, input.assignTo);
  }

  /** Drops several at once: every entry is checked first, so a bad one means none are dropped. */
  async dropMany(user: User, campaignId: string, inputs: DropInput[]): Promise<LootItem[]> {
    await this.requireDm(user, campaignId);
    if (inputs.length < 1 || inputs.length > 50) {
      throw new DomainError('invalid_input', 'drop between 1 and 50 things at a time');
    }
    const items = inputs.map((input) => this.build(user, campaignId, input));
    await this.requirePlayers(
      campaignId,
      inputs.flatMap((i) => (i.assignTo === undefined ? [] : [i.assignTo])),
    );
    const stored: LootItem[] = [];
    for (const [index, item] of items.entries())
      stored.push(await this.store(item, inputs[index]!.assignTo));
    return stored;
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
    forWhom: Extract<ClaimedFor, 'self' | 'party'> = 'self',
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

  /** The player who took an item (or was given it) moves it into the party stash. */
  async stash(user: User, campaignId: string, itemId: string): Promise<LootItem> {
    return this.change(user, campaignId, itemId, ['self', 'assigned'], 'party');
  }

  /** The player who took, stored, or was given an item puts it back on the table, unclaimed. */
  async giveBack(user: User, campaignId: string, itemId: string): Promise<LootItem> {
    return this.change(user, campaignId, itemId, ['self', 'party', 'assigned'], null);
  }

  private async change(
    user: User,
    campaignId: string,
    itemId: string,
    from: ClaimedFor[],
    to: 'party' | null,
  ): Promise<LootItem> {
    await this.role(user, campaignId);
    const existing = await this.deps.table.getLoot(itemId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    if (existing.claimedBy === null) throw new DomainError('conflict', 'nobody has taken that');
    if (existing.claimedBy !== user.id || existing.claimedFor === 'split')
      throw new DomainError('forbidden', 'only the player who took it can do that');
    const changed = await this.deps.table.changeClaim(itemId, user.id, from, to);
    if (!changed) throw new DomainError('conflict', 'it is already stored, or already back');
    return changed;
  }

  /** The DM hands an unclaimed item straight to one player of this campaign. */
  async assign(
    user: User,
    campaignId: string,
    itemId: string,
    playerId: string,
  ): Promise<LootItem> {
    await this.requireDm(user, campaignId);
    const existing = await this.deps.table.getLoot(itemId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    const target = await this.deps.store.getMembership(campaignId, playerId);
    if (!target || target.role !== 'player') {
      throw new DomainError(
        'invalid_input',
        'an item can only be given to a player in this campaign',
      );
    }
    const claimed = await this.deps.table.claimLoot(itemId, playerId, this.now(), 'assigned');
    if (!claimed) throw new DomainError('conflict', 'that was already taken, split or given out');
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
