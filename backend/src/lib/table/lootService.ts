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
import { visibleLoot } from './lootVisibility.js';
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
  /** Stores a notification for each person (the DM gave someone an item). Never throws into the request. */
  notify?: (
    userIds: string[],
    n: {
      campaignId: string | null;
      kind: string;
      title: string;
      body?: string;
      data?: Record<string, unknown>;
    },
  ) => Promise<void>;
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
    const role = await this.role(user, campaignId);
    return visibleLoot(await this.deps.table.listLoot(campaignId), user.id, role === 'dm').map(
      (i) => withoutOthersFlags(i, user.id, role === 'dm'),
    );
  }

  /** One item as this person may see it: the DM never sees the confirmed flags, a player only their own share's. */
  async view(user: User, campaignId: string, item: LootItem): Promise<LootItem> {
    return withoutOthersFlags(item, user.id, (await this.role(user, campaignId)) === 'dm');
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
      confirmed: false,
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
    const given = await this.deps.table.claimLoot(item.id, assignTo, this.now(), 'assigned');
    if (given) await this.tellGiven(item.campaignId, given);
    return given ?? item;
  }

  /** "The DM gave you X, add it to your sheet": stored, so a player who was away finds it next time. */
  private async tellGiven(campaignId: string, item: LootItem): Promise<void> {
    if (!this.deps.notify || item.claimedBy === null) return;
    const what =
      item.kind === 'coin'
        ? `${item.quantity} ${item.name}`
        : item.quantity > 1
          ? `${item.name} ×${item.quantity}`
          : item.name;
    await this.deps
      .notify([item.claimedBy], {
        campaignId,
        kind: 'loot_given',
        title: `The DM gave you ${what}`,
        body: 'Add it to your sheet, then tick it in the loot window.',
        data: { itemId: item.id },
      })
      .catch(() => undefined);
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
    if (existing.claimedFor === 'party' && forWhom === 'self') {
      // Any player may take from the party stash (decided 2026-11-17).
      const taken = await this.deps.table.takeFromParty(itemId, user.id, this.now());
      if (!taken) throw new DomainError('conflict', 'someone already took that from the stash');
      return taken;
    }
    const claimed = await this.deps.table.claimLoot(itemId, user.id, this.now(), forWhom);
    if (!claimed) throw new DomainError('conflict', 'someone already picked that up');
    return claimed;
  }

  /** The player who took an item (or was given it) moves it into the party stash. */
  async stash(user: User, campaignId: string, itemId: string): Promise<LootItem> {
    return this.change(user, campaignId, itemId, ['self', 'assigned'], 'party');
  }

  /** Puts an item back on the table, unclaimed: the player who took or was given it, or any player for a party-stash item. */
  async giveBack(user: User, campaignId: string, itemId: string): Promise<LootItem> {
    const existing = await this.deps.table.getLoot(itemId);
    if (existing?.campaignId === campaignId && existing.claimedFor === 'party') {
      // Any player (never the DM) may put a party-stash item back on the table.
      if ((await this.role(user, campaignId)) === 'dm') {
        throw new DomainError('forbidden', 'the DM hands loot out and cannot move the stash');
      }
      const back = await this.deps.table.returnFromParty(itemId);
      if (!back) throw new DomainError('conflict', 'it is already back on the table');
      return back;
    }
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
    await this.tellGiven(campaignId, claimed);
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

  /**
   * A player says "I have added this to my game sheet" (or takes it back). Works on what they hold, on the party
   * stash (any player), and on their own share of a split. The DM has no flags to set.
   */
  async confirm(
    user: User,
    campaignId: string,
    itemId: string,
    confirmed: boolean,
  ): Promise<LootItem> {
    if ((await this.role(user, campaignId)) === 'dm')
      throw new DomainError('forbidden', 'the confirmed flag belongs to the players');
    const existing = await this.deps.table.getLoot(itemId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    const changed = await this.deps.table.confirmLoot(itemId, user.id, confirmed);
    if (!changed) throw new DomainError('forbidden', "that is not yours or the party's to confirm");
    return changed;
  }

  /** Who is told a flag changed: every player for the party stash, otherwise only the person who set it. */
  async confirmAudience(campaignId: string, item: LootItem, userId: string): Promise<string[]> {
    if (item.claimedFor !== 'party') return [userId];
    return (await this.deps.store.listMemberships(campaignId))
      .filter((m) => m.role === 'player')
      .map((m) => m.userId);
  }

  /** The DM posts an item that is still on the table into chat again, for anyone who missed it. */
  async redrop(user: User, campaignId: string, itemId: string): Promise<LootItem> {
    await this.requireDm(user, campaignId);
    const existing = await this.deps.table.getLoot(itemId);
    if (!existing || existing.campaignId !== campaignId) throw new DomainError('not_found');
    // The card moves: it is drawn where the item was dropped, so a re-drop is a new drop time.
    const moved = await this.deps.table.redropLoot(itemId, this.now());
    if (!moved)
      throw new DomainError('conflict', 'only an item still on the table can be dropped again');
    return moved;
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

/** Hides what a viewer must not see: the DM no flags at all, a player only their own share's. */
export function withoutOthersFlags(item: LootItem, viewerId: string, dm: boolean): LootItem {
  const { confirmed, ...rest } = item;
  const shown = dm ? ({ ...rest, confirmed: false } as LootItem) : { ...rest, confirmed };
  if (!item.split) return shown;
  return {
    ...shown,
    split: {
      ...item.split,
      shares: item.split.shares.map((s) => {
        const { confirmed: flag, ...bare } = s;
        return !dm && s.userId === viewerId && flag !== undefined
          ? { ...bare, confirmed: flag }
          : bare;
      }),
    },
  };
}
