import { beforeEach, describe, expect, it } from 'vitest';

import { DAY_MS, MAGIC_LINK_TTL_MINUTES, MINUTE_MS } from '../consts/index.js';
import type { User } from '../types/index.js';
import { AccountService } from './auth/accountService.js';
import {
  generateCode,
  hashPassword,
  hashSecret,
  normaliseCode,
  verifyPassword,
} from './auth/crypto.js';
import { CampaignService } from './campaigns/campaignService.js';
import { DomainError } from './errors.js';
import { MemoryStore } from './store/memoryStore.js';

class FakeClock {
  constructor(public time = 1_700_000_000_000) {}
  now = (): number => this.time;
  advance(ms: number): void {
    this.time += ms;
  }
}

let counter = 0;
const newId = (): string => `id-${++counter}`;

interface World {
  store: MemoryStore;
  clock: FakeClock;
  accounts: AccountService;
  campaigns: CampaignService;
}

function world(): World {
  const store = new MemoryStore();
  const clock = new FakeClock();
  return {
    store,
    clock,
    accounts: new AccountService({ store, clock, newId }),
    campaigns: new CampaignService({ store, clock, newId }),
  };
}

const PASSWORD = 'correct horse battery';

async function register(w: World, name: string, password: string | null = PASSWORD): Promise<User> {
  return w.accounts.register({
    email: `${name}@example.com`,
    displayName: name,
    ...(password === null ? {} : { password }),
    acceptedConsentVersion: '1',
  });
}

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

describe('crypto helpers', () => {
  it('hashes passwords so they verify, never twice the same, and reject wrong ones', async () => {
    const a = await hashPassword('hunter2hunter2');
    const b = await hashPassword('hunter2hunter2');
    expect(a).not.toBe(b);
    expect(await verifyPassword('hunter2hunter2', a)).toBe(true);
    expect(await verifyPassword('hunter2hunter3', a)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });

  it('makes speakable codes without look-alike characters, and normalises them', () => {
    const code = generateCode(40);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]+$/);
    expect(normaliseCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(hashSecret('a')).toBe(hashSecret('a'));
    expect(hashSecret('a')).not.toBe(hashSecret('b'));
  });
});

describe('registration', () => {
  let w: World;
  beforeEach(() => {
    w = world();
  });

  it('makes the first account Admin and nobody after', async () => {
    const first = await register(w, 'first');
    const second = await register(w, 'second');
    expect(first.isAdmin).toBe(true);
    expect(second.isAdmin).toBe(false);
  });

  it('requires the current consent text and records it', async () => {
    await rejects(
      w.accounts.register({ email: 'a@b.co', displayName: 'A', acceptedConsentVersion: '0' }),
      'consent_required',
    );
    const user = await register(w, 'ok');
    expect(user.consentVersion).toBe('1');
    expect(user.consentAt).toBe(w.clock.time);
  });

  it('rejects bad input and duplicate emails (case-insensitively)', async () => {
    await register(w, 'dup');
    await rejects(register(w, 'dup'), 'email_taken');
    await rejects(
      w.accounts.register({
        email: 'DUP@Example.com',
        displayName: 'x',
        acceptedConsentVersion: '1',
      }),
      'email_taken',
    );
    await rejects(
      w.accounts.register({ email: 'nope', displayName: 'x', acceptedConsentVersion: '1' }),
      'invalid_input',
    );
    await rejects(register(w, 'short', 'tiny'), 'invalid_input');
    await rejects(
      w.accounts.register({ email: 'a@b.co', displayName: '  ', acceptedConsentVersion: '1' }),
      'invalid_input',
    );
  });

  it('stores a hash, never the password', async () => {
    const user = await register(w, 'pw');
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.passwordHash?.startsWith('scrypt$')).toBe(true);
  });

  it('allows a magic-link-only account with no password', async () => {
    const user = await register(w, 'linkonly', null);
    expect(user.passwordHash).toBeNull();
    await rejects(
      w.accounts.signInWithPassword(user.email, 'anything at all'),
      'invalid_credentials',
    );
  });
});

describe('sign-in, sessions and revocation', () => {
  let w: World;
  let user: User;
  beforeEach(async () => {
    w = world();
    user = await register(w, 'sam');
  });

  it('signs in with the right password and rejects wrong ones the same way as unknown users', async () => {
    const ok = await w.accounts.signInWithPassword('SAM@example.com', PASSWORD, 'laptop');
    expect(ok.user.id).toBe(user.id);
    expect(ok.needsConsent).toBe(false);
    await rejects(
      w.accounts.signInWithPassword(user.email, 'wrong wrong wrong'),
      'invalid_credentials',
    );
    await rejects(
      w.accounts.signInWithPassword('ghost@example.com', PASSWORD),
      'invalid_credentials',
    );
  });

  it('keeps a regularly-used device signed in indefinitely', async () => {
    const { sessionToken } = await w.accounts.signInWithPassword(user.email, PASSWORD);
    for (let i = 0; i < 6; i += 1) {
      w.clock.advance(20 * DAY_MS); // 120 days in total, but never idle for 30
      await w.accounts.authenticate(sessionToken, { ping: true });
    }
    await expect(w.accounts.authenticate(sessionToken)).resolves.toBeDefined();
  });

  it('signs a device out after the offline limit', async () => {
    const { sessionToken } = await w.accounts.signInWithPassword(user.email, PASSWORD);
    w.clock.advance(31 * DAY_MS);
    await rejects(w.accounts.authenticate(sessionToken), 'session_invalid');
  });

  it('does not extend a session unless the client pings', async () => {
    const { sessionToken } = await w.accounts.signInWithPassword(user.email, PASSWORD);
    w.clock.advance(20 * DAY_MS);
    await w.accounts.authenticate(sessionToken); // a check, not a ping
    w.clock.advance(20 * DAY_MS);
    await rejects(w.accounts.authenticate(sessionToken), 'session_invalid');
  });

  it('honours a changed offline limit', async () => {
    await w.store.putSettings({ ...(await w.store.getSettings()), offlineLimitDays: 2 });
    const { sessionToken } = await w.accounts.signInWithPassword(user.email, PASSWORD);
    w.clock.advance(3 * DAY_MS);
    await rejects(w.accounts.authenticate(sessionToken), 'session_invalid');
  });

  it('rejects tampered, malformed and unknown tokens', async () => {
    const { sessionToken } = await w.accounts.signInWithPassword(user.email, PASSWORD);
    const [id] = sessionToken.split('.');
    await rejects(w.accounts.authenticate(`${id}.wrongsecret`), 'session_invalid');
    await rejects(w.accounts.authenticate('garbage'), 'session_invalid');
    await rejects(w.accounts.authenticate('nope.nope'), 'session_invalid');
  });

  it('revokes one device remotely and leaves the others signed in', async () => {
    const phone = await w.accounts.signInWithPassword(user.email, PASSWORD, 'phone');
    const laptop = await w.accounts.signInWithPassword(user.email, PASSWORD, 'laptop');
    const sessions = await w.accounts.listSessions(user.id);
    expect(sessions.map((s) => s.deviceLabel).sort()).toEqual(['laptop', 'phone']);

    const phoneSession = sessions.find((s) => s.deviceLabel === 'phone');
    await w.accounts.revokeSession(user.id, phoneSession?.id ?? '');
    await rejects(w.accounts.authenticate(phone.sessionToken), 'session_invalid');
    await expect(w.accounts.authenticate(laptop.sessionToken)).resolves.toBeDefined();
    expect(await w.accounts.listSessions(user.id)).toHaveLength(1);
  });

  it('will not let one user revoke another user’s session', async () => {
    const other = await register(w, 'other');
    const { session } = await w.accounts.authenticate(
      (await w.accounts.signInWithPassword(user.email, PASSWORD)).sessionToken,
    );
    await rejects(w.accounts.revokeSession(other.id, session.id), 'not_found');
  });

  it('flags a user who has not accepted a changed consent text', async () => {
    await w.store.putSettings({ ...(await w.store.getSettings()), consentVersion: '2' });
    const result = await w.accounts.signInWithPassword(user.email, PASSWORD);
    expect(result.needsConsent).toBe(true);
    await rejects(w.accounts.acceptConsent(user.id, '1'), 'consent_required');
    const updated = await w.accounts.acceptConsent(user.id, '2');
    expect(updated.consentVersion).toBe('2');
    expect((await w.accounts.signInWithPassword(user.email, PASSWORD)).needsConsent).toBe(false);
  });
});

describe('magic links', () => {
  let w: World;
  let user: User;
  beforeEach(async () => {
    w = world();
    user = await register(w, 'mia');
  });

  it('signs in once, then the link is dead', async () => {
    const link = await w.accounts.requestMagicLink(user.email, 'signin');
    expect(link).toBeDefined();
    const result = await w.accounts.redeemMagicLink(link?.token ?? '');
    expect(result.user.id).toBe(user.id);
    await rejects(w.accounts.redeemMagicLink(link?.token ?? ''), 'invalid_token');
  });

  it('expires', async () => {
    const link = await w.accounts.requestMagicLink(user.email, 'signin');
    w.clock.advance((MAGIC_LINK_TTL_MINUTES + 1) * MINUTE_MS);
    await rejects(w.accounts.redeemMagicLink(link?.token ?? ''), 'invalid_token');
  });

  it('says nothing for an unknown address', async () => {
    expect(await w.accounts.requestMagicLink('ghost@example.com', 'signin')).toBeUndefined();
  });

  it('rejects a made-up token', async () => {
    await rejects(w.accounts.redeemMagicLink('not-a-real-token'), 'invalid_token');
  });

  it('resets a password, signs out every other device, and the old password stops working', async () => {
    const old = await w.accounts.signInWithPassword(user.email, PASSWORD, 'old device');
    const link = await w.accounts.requestMagicLink(user.email, 'reset');

    await rejects(w.accounts.redeemMagicLink(link?.token ?? ''), 'invalid_input'); // no new password
    await rejects(
      w.accounts.redeemMagicLink(link?.token ?? '', { newPassword: 'short' }),
      'invalid_input',
    );
    // A rejected attempt must not burn the link.
    const reset = await w.accounts.redeemMagicLink(link?.token ?? '', {
      newPassword: 'a brand new password',
    });

    await rejects(w.accounts.authenticate(old.sessionToken), 'session_invalid');
    await expect(w.accounts.authenticate(reset.sessionToken)).resolves.toBeDefined();
    await rejects(w.accounts.signInWithPassword(user.email, PASSWORD), 'invalid_credentials');
    await expect(
      w.accounts.signInWithPassword(user.email, 'a brand new password'),
    ).resolves.toBeDefined();
  });

  it('stores only a hash of the token', async () => {
    const link = await w.accounts.requestMagicLink(user.email, 'signin');
    const stored = await w.store.getMagicLinkByHash(hashSecret(link?.token ?? ''));
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(link?.token ?? 'x');
  });
});

describe('campaigns', () => {
  let w: World;
  let admin: User;
  let alice: User;
  let bob: User;
  beforeEach(async () => {
    w = world();
    admin = await register(w, 'admin');
    alice = await register(w, 'alice');
    bob = await register(w, 'bob');
  });

  it('lets only the Admin create campaigns while creation is closed', async () => {
    await rejects(w.campaigns.createCampaign(alice, 'Nope'), 'forbidden');
    const campaign = await w.campaigns.createCampaign(admin, 'Curse of Strahd');
    const members = await w.campaigns.listMembers(admin, campaign.id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ userId: admin.id, role: 'dm' });
  });

  it('lets anyone create campaigns when creation is open, and they become its DM', async () => {
    await w.store.putSettings({ ...(await w.store.getSettings()), campaignCreation: 'open' });
    const campaign = await w.campaigns.createCampaign(alice, 'Alice’s game');
    expect((await w.campaigns.listMembers(alice, campaign.id))[0]?.role).toBe('dm');
  });

  it('validates campaign names', async () => {
    await rejects(w.campaigns.createCampaign(admin, '   '), 'invalid_input');
  });

  it('shares one multi-use invite with the whole group until it expires', async () => {
    const campaign = await w.campaigns.createCampaign(admin, 'Group');
    const { code, invite } = await w.campaigns.createInvite(admin, campaign.id);
    expect(invite.expiresAt - invite.createdAt).toBe(7 * DAY_MS);

    await w.campaigns.joinWithInvite(alice, code);
    await w.campaigns.joinWithInvite(bob, code.toLowerCase().replace(/(.{4})/g, '$1 '));
    const members = await w.campaigns.listMembers(admin, campaign.id);
    expect(members.map((m) => m.role).sort()).toEqual(['dm', 'player', 'player']);

    w.clock.advance(8 * DAY_MS);
    const carol = await register(w, 'carol');
    await rejects(w.campaigns.joinWithInvite(carol, code), 'invite_invalid');
  });

  it('does not count a repeat join, and honours a custom expiry', async () => {
    const campaign = await w.campaigns.createCampaign(admin, 'Group');
    const { code, invite } = await w.campaigns.createInvite(admin, campaign.id, {
      expiresInDays: 1,
    });
    expect(invite.expiresAt - invite.createdAt).toBe(DAY_MS);
    await w.campaigns.joinWithInvite(alice, code);
    await w.campaigns.joinWithInvite(alice, code);
    const stored = await w.store.getInviteByHash(hashSecret(normaliseCode(code)));
    expect(stored?.uses).toBe(1);
  });

  it('only lets the DM invite, and a revoked or unknown code fails', async () => {
    const campaign = await w.campaigns.createCampaign(admin, 'Group');
    const { code } = await w.campaigns.createInvite(admin, campaign.id);
    await w.campaigns.joinWithInvite(alice, code);
    await rejects(w.campaigns.createInvite(alice, campaign.id), 'forbidden');
    await rejects(w.campaigns.joinWithInvite(bob, 'WRONGCODE1'), 'invite_invalid');
    await w.campaigns.revokeInvite(admin, campaign.id, code);
    await rejects(w.campaigns.joinWithInvite(bob, code), 'invite_invalid');
  });

  it('keeps campaign member lists private to members', async () => {
    const campaign = await w.campaigns.createCampaign(admin, 'Private');
    await rejects(w.campaigns.listMembers(alice, campaign.id), 'forbidden');
  });

  describe('characters', () => {
    const sheet = {
      name: 'Aria',
      className: 'Rogue',
      race: 'Elf',
      level: 3,
      avatarUrl: null,
      sourceUrl: null,
    };

    async function table(): Promise<{ campaignId: string }> {
      const campaign = await w.campaigns.createCampaign(admin, 'Table');
      const { code } = await w.campaigns.createInvite(admin, campaign.id);
      await w.campaigns.joinWithInvite(alice, code);
      await w.campaigns.joinWithInvite(bob, code);
      return { campaignId: campaign.id };
    }

    it('makes the first character active, keeps later ones benched, and switches on request', async () => {
      const { campaignId } = await table();
      const first = await w.campaigns.addCharacter(alice, campaignId, sheet);
      const second = await w.campaigns.addCharacter(alice, campaignId, { ...sheet, name: 'Brin' });
      expect((await w.store.getMembership(campaignId, alice.id))?.activeCharacterId).toBe(first.id);

      const switched = await w.campaigns.setActiveCharacter(alice, campaignId, second.id);
      expect(switched.activeCharacterId).toBe(second.id);
    });

    it('will not activate someone else’s character', async () => {
      const { campaignId } = await table();
      const theirs = await w.campaigns.addCharacter(bob, campaignId, sheet);
      await rejects(w.campaigns.setActiveCharacter(alice, campaignId, theirs.id), 'not_found');
    });

    it('swaps the DM role, parking the new DM’s character and restoring the old DM’s', async () => {
      const { campaignId } = await table();
      const aliceChar = await w.campaigns.addCharacter(alice, campaignId, sheet);
      const adminChar = await w.campaigns.addCharacter(admin, campaignId, {
        ...sheet,
        name: 'Zed',
      });

      // The DM's own character is parked from the start.
      expect(await w.store.getMembership(campaignId, admin.id)).toMatchObject({
        role: 'dm',
        activeCharacterId: null,
        suspendedCharacterId: adminChar.id,
      });

      await w.campaigns.swapDm(admin, campaignId, alice.id);

      expect(await w.store.getMembership(campaignId, alice.id)).toMatchObject({
        role: 'dm',
        activeCharacterId: null,
        suspendedCharacterId: aliceChar.id,
      });
      expect(await w.store.getMembership(campaignId, admin.id)).toMatchObject({
        role: 'player',
        activeCharacterId: adminChar.id,
        suspendedCharacterId: null,
      });

      // …and back again restores everyone.
      await w.campaigns.swapDm(alice, campaignId, admin.id);
      expect(await w.store.getMembership(campaignId, alice.id)).toMatchObject({
        role: 'player',
        activeCharacterId: aliceChar.id,
      });
      expect(await w.store.getMembership(campaignId, admin.id)).toMatchObject({
        role: 'dm',
        suspendedCharacterId: adminChar.id,
      });
    });

    it('always leaves exactly one DM, and only the DM can swap', async () => {
      const { campaignId } = await table();
      await rejects(w.campaigns.swapDm(alice, campaignId, bob.id), 'forbidden');
      await rejects(w.campaigns.swapDm(admin, campaignId, admin.id), 'invalid_input');
      const stranger = await register(w, 'stranger');
      await rejects(w.campaigns.swapDm(admin, campaignId, stranger.id), 'not_found');

      await w.campaigns.swapDm(admin, campaignId, bob.id);
      const dms = (await w.campaigns.listMembers(bob, campaignId)).filter((m) => m.role === 'dm');
      expect(dms.map((m) => m.userId)).toEqual([bob.id]);
    });

    it('stops a DM from setting an active character while running the game', async () => {
      const { campaignId } = await table();
      const mine = await w.campaigns.addCharacter(admin, campaignId, sheet);
      await rejects(w.campaigns.setActiveCharacter(admin, campaignId, mine.id), 'forbidden');
    });
  });

  it('lets players leave but makes the DM hand over first', async () => {
    const campaign = await w.campaigns.createCampaign(admin, 'Leaving');
    const { code } = await w.campaigns.createInvite(admin, campaign.id);
    await w.campaigns.joinWithInvite(alice, code);

    await rejects(w.campaigns.leaveCampaign(admin, campaign.id), 'dm_must_transfer');
    await w.campaigns.leaveCampaign(alice, campaign.id);
    expect(await w.store.getMembership(campaign.id, alice.id)).toBeUndefined();
  });
});

describe('MemoryStore transactions', () => {
  it('rolls back every write if the work throws', async () => {
    const store = new MemoryStore();
    await expect(
      store.transaction(async (tx) => {
        await tx.putCampaign({ id: 'c', name: 'x', createdAt: 1 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.getCampaign('c')).toBeUndefined();
  });
});
