import { randomUUID } from 'node:crypto';

import { DAY_MS } from '../../consts/index.js';
import type { Campaign, Character, Invite, Membership, User } from '../../types/index.js';
import { generateCode, hashSecret, normaliseCode } from '../auth/crypto.js';
import type { Clock } from '../auth/accountService.js';
import { AVATAR_VALUE } from '../avatarValue.js';
import { DomainError } from '../errors.js';
import type { Store } from '../store/store.js';

export interface CampaignDeps {
  store: Store;
  clock?: Clock;
  newId?: () => string;
}

/** The D&D Beyond link is never set here; it goes through the sync service, which checks the sheet. */
export type NewCharacter = Omit<
  Character,
  'id' | 'userId' | 'campaignId' | 'sourceUrl' | 'syncedAt' | 'sourceAvatar' | 'sheet'
>;

/** Campaigns, who is in them, invites, characters, and the DM swap. */
export class CampaignService {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly newId: () => string;

  constructor(deps: CampaignDeps) {
    this.store = deps.store;
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.newId = deps.newId ?? randomUUID;
  }

  /**
   * Who may create campaigns is an instance setting: `closed` means only the Admin, `open` means
   * anyone, players included. The creator becomes the campaign's DM.
   */
  async createCampaign(actor: User, name: string): Promise<Campaign> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 120) {
      throw new DomainError('invalid_input', 'campaign name must be 1–120 characters');
    }
    const settings = await this.store.getSettings();
    if (settings.campaignCreation === 'closed' && !actor.isAdmin) {
      throw new DomainError('forbidden', 'only the instance admin can create campaigns here');
    }

    const now = this.clock.now();
    const campaign: Campaign = { id: this.newId(), name: trimmed, createdAt: now, allowJoin: true };
    await this.store.transaction(async (tx) => {
      await tx.putCampaign(campaign);
      await tx.putMembership(newMembership(campaign.id, actor.id, 'dm', now));
    });
    return campaign;
  }

  /**
   * One code for the whole group: any number of people can use it until it expires. The code is
   * returned once; only its hash is stored. Delivery (magic link by email, a side channel, or a QR
   * code of the same string) is the caller's job.
   */
  async createInvite(
    actor: User,
    campaignId: string,
    options: { expiresInDays?: number } = {},
  ): Promise<{ invite: Invite; code: string }> {
    await this.requireDm(actor.id, campaignId);
    const settings = await this.store.getSettings();
    const days = options.expiresInDays ?? settings.inviteExpiryDays;
    if (!(days > 0)) throw new DomainError('invalid_input', 'expiry must be positive');

    const code = generateCode();
    const now = this.clock.now();
    const invite: Invite = {
      id: this.newId(),
      campaignId,
      codeHash: hashSecret(normaliseCode(code)),
      createdBy: actor.id,
      createdAt: now,
      expiresAt: now + days * DAY_MS,
      uses: 0,
      revokedAt: null,
    };
    await this.store.putInvite(invite);
    return { invite, code };
  }

  async revokeInvite(actor: User, campaignId: string, code: string): Promise<void> {
    await this.requireDm(actor.id, campaignId);
    const invite = await this.store.getInviteByHash(hashSecret(normaliseCode(code)));
    if (!invite || invite.campaignId !== campaignId) throw new DomainError('not_found');
    await this.store.putInvite({ ...invite, revokedAt: this.clock.now() });
  }

  /**
   * What the public join page may show for a code: the campaign's name and the consent version the sign-up form must submit. A bad,
   * expired or revoked code is the same `invite_invalid` as when joining, so this can't be used to
   * tell the cases apart.
   */
  async previewInvite(code: string): Promise<{ campaignName: string; consentVersion: string }> {
    const invite = await this.store.getInviteByHash(hashSecret(normaliseCode(code)));
    if (!invite || invite.revokedAt !== null || invite.expiresAt <= this.clock.now()) {
      throw new DomainError('invite_invalid');
    }
    const campaign = await this.store.getCampaign(invite.campaignId);
    if (!campaign) throw new DomainError('invite_invalid');
    const settings = await this.store.getSettings();
    return { campaignName: campaign.name, consentVersion: settings.consentVersion };
  }

  /** Joins as a player. Using the code again while already a member is harmless and not counted. */
  async joinWithInvite(user: User, code: string): Promise<Membership> {
    const invite = await this.store.getInviteByHash(hashSecret(normaliseCode(code)));
    const now = this.clock.now();
    if (!invite || invite.revokedAt !== null || invite.expiresAt <= now) {
      throw new DomainError('invite_invalid');
    }

    const existing = await this.store.getMembership(invite.campaignId, user.id);
    if (existing) return existing;

    const membership = newMembership(invite.campaignId, user.id, 'player', now);
    await this.store.transaction(async (tx) => {
      await tx.putMembership(membership);
      await tx.putInvite({ ...invite, uses: invite.uses + 1 });
    });
    return membership;
  }

  /** Adds a character for the caller in a campaign they belong to. The first one becomes active. */
  async addCharacter(user: User, campaignId: string, input: NewCharacter): Promise<Character> {
    const membership = await this.requireMember(user.id, campaignId);
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw new DomainError('invalid_input', 'character name must be 1–120 characters');
    }
    const character: Character = {
      ...input,
      name,
      id: this.newId(),
      userId: user.id,
      campaignId,
      sourceUrl: null,
      syncedAt: null,
      sourceAvatar: null,
      sheet: null,
    };
    await this.store.transaction(async (tx) => {
      await tx.putCharacter(character);
      // A DM has no active character while DM; theirs is parked and restored on swap-back.
      if (membership.role === 'player' && membership.activeCharacterId === null) {
        await tx.putMembership({ ...membership, activeCharacterId: character.id });
      } else if (membership.role === 'dm' && membership.suspendedCharacterId === null) {
        await tx.putMembership({ ...membership, suspendedCharacterId: character.id });
      }
    });
    return character;
  }

  /** The signed-in member's own characters in this campaign (each campaign keeps its own). */
  async listMyCharacters(user: User, campaignId: string): Promise<Character[]> {
    await this.requireMember(user.id, campaignId);
    return this.store.listCharacters(user.id, campaignId);
  }

  /** Edits one of the member's own characters; only the fields given change. */
  async updateCharacter(
    user: User,
    campaignId: string,
    characterId: string,
    patch: Partial<Pick<Character, 'name' | 'className' | 'race' | 'level' | 'avatarUrl'>>,
  ): Promise<Character> {
    await this.requireMember(user.id, campaignId);
    const existing = await this.store.getCharacter(characterId);
    if (!existing || existing.userId !== user.id || existing.campaignId !== campaignId) {
      throw new DomainError('not_found');
    }
    const next: Character = { ...existing };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0 || name.length > 120) {
        throw new DomainError('invalid_input', 'character name must be 1–120 characters');
      }
      next.name = name;
    }
    if (patch.level !== undefined) {
      const level = patch.level;
      if (level !== null && (!Number.isInteger(level) || level < 1 || level > 30)) {
        throw new DomainError('invalid_input', 'level must be a whole number from 1 to 30');
      }
      next.level = level;
    }
    for (const key of ['className', 'race'] as const) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value !== null && value.length > 80)
        throw new DomainError('invalid_input', `${key} is too long`);
      next[key] = value === null || value.trim() === '' ? null : value.trim();
    }
    if (patch.avatarUrl !== undefined) {
      const url = patch.avatarUrl;
      if (url !== null && url !== '' && !AVATAR_VALUE.test(url)) {
        throw new DomainError(
          'invalid_input',
          'the avatar must be a web address, an uploaded picture or one of the built-in emblems',
        );
      }
      next.avatarUrl = url === null || url === '' ? null : url;
    }
    await this.store.putCharacter(next);
    return next;
  }

  /** Switches the active character (a character died or left; a new one joins). Players only. */
  async setActiveCharacter(
    user: User,
    campaignId: string,
    characterId: string,
  ): Promise<Membership> {
    const membership = await this.requireMember(user.id, campaignId);
    if (membership.role !== 'player') {
      throw new DomainError('forbidden', 'the DM has no active character while running the game');
    }
    const character = await this.store.getCharacter(characterId);
    if (!character || character.userId !== user.id || character.campaignId !== campaignId) {
      throw new DomainError('not_found');
    }
    const updated = { ...membership, activeCharacterId: characterId };
    await this.store.putMembership(updated);
    return updated;
  }

  /**
   * The DM and a player swap places in one step. The old DM becomes a player and gets their
   * parked character back; the new DM's active character is parked. Both rows change together or
   * not at all, and there is always exactly one DM. Swapping back later reverses it, so a group
   * that rotates the DM every session can do it in one tap.
   */
  async swapDm(actor: User, campaignId: string, newDmUserId: string): Promise<void> {
    await this.requireDm(actor.id, campaignId);
    if (newDmUserId === actor.id) throw new DomainError('invalid_input', 'you are already the DM');

    await this.store.transaction(async (tx) => {
      const oldDm = await tx.getMembership(campaignId, actor.id);
      const newDm = await tx.getMembership(campaignId, newDmUserId);
      if (!oldDm || !newDm || newDm.role !== 'player') {
        throw new DomainError('not_found', 'the new DM must be a player in this campaign');
      }
      await tx.putMembership({
        ...oldDm,
        role: 'player',
        activeCharacterId: oldDm.suspendedCharacterId,
        suspendedCharacterId: null,
      });
      await tx.putMembership({
        ...newDm,
        role: 'dm',
        activeCharacterId: null,
        suspendedCharacterId: newDm.activeCharacterId,
      });
    });
  }

  /** Leaving is always allowed for players. A DM must hand over first, so a campaign is never DM-less. */
  async leaveCampaign(user: User, campaignId: string): Promise<void> {
    const membership = await this.requireMember(user.id, campaignId);
    if (membership.role === 'dm') {
      throw new DomainError(
        'dm_must_transfer',
        'swap the DM role to another player before leaving',
      );
    }
    // History and characters stay with the campaign; only the membership goes.
    await this.store.removeMembership(campaignId, user.id);
  }

  async listMembers(actor: User, campaignId: string): Promise<Membership[]> {
    await this.requireMember(actor.id, campaignId);
    return this.store.listMemberships(campaignId);
  }

  private async requireMember(userId: string, campaignId: string): Promise<Membership> {
    const membership = await this.store.getMembership(campaignId, userId);
    if (!membership) throw new DomainError('forbidden', 'not a member of this campaign');
    return membership;
  }

  private async requireDm(userId: string, campaignId: string): Promise<Membership> {
    const membership = await this.requireMember(userId, campaignId);
    if (membership.role !== 'dm') throw new DomainError('forbidden', 'only the DM can do that');
    return membership;
  }
}

function newMembership(
  campaignId: string,
  userId: string,
  role: Membership['role'],
  now: number,
): Membership {
  return {
    campaignId,
    userId,
    role,
    activeCharacterId: null,
    suspendedCharacterId: null,
    joinedAt: now,
  };
}
