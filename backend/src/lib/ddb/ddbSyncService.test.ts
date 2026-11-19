import { randomBytes } from 'node:crypto';

import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FetchOutcome } from '@vtt-chat-app/ddb';

import { CampaignService } from '../campaigns/campaignService.js';
import { MemoryStore } from '../store/memoryStore.js';
import { AccountService } from '../auth/accountService.js';
import { DdbSyncService } from './ddbSyncService.js';
import type { MediaStorage } from '../media/mediaStorage.js';

let PNG: Buffer;
/** What D&D Beyond really serves: the original upload, here a noisy picture well over the avatar size limit. */
let BIG_PNG: Buffer;
beforeAll(async () => {
  PNG = await sharp({
    create: { width: 600, height: 400, channels: 3, background: '#a33' },
  })
    .png()
    .toBuffer();
  const noise = randomBytes(900 * 900 * 3);
  BIG_PNG = await sharp(noise, { raw: { width: 900, height: 900, channels: 3 } })
    .png()
    .toBuffer();
});

async function setup(opts: { enabled?: boolean; image?: () => Promise<Buffer | undefined> } = {}) {
  const store = new MemoryStore();
  const accounts = new AccountService({ store });
  const campaigns = new CampaignService({ store });
  const user = await accounts.register({
    email: 'a@example.com',
    displayName: 'Andy',
    password: 'correct horse battery',
    acceptedConsentVersion: '1',
  });
  const campaign = await campaigns.createCampaign(user, 'Test');
  const character = await campaigns.addCharacter(user, campaign.id, {
    name: 'Old Name',
    className: null,
    race: null,
    level: null,
    avatarUrl: null,
  });
  const stored = new Map<string, Buffer>();
  const media: MediaStorage = {
    put: async (id, b) => void stored.set(id, b),
    get: async (id) => stored.get(id),
    delete: async (id) => void stored.delete(id),
  };
  let sheet: FetchOutcome = {
    ok: true,
    character: {
      name: 'Thessaly',
      race: 'Half-Elf',
      className: 'Fighter',
      level: 5,
      portraitUrl: 'https://www.dndbeyond.com/a.png',
      sheet: null,
    },
  };
  let clock = 1_000;
  const changed: string[] = [];
  const service = new DdbSyncService({
    store,
    campaigns,
    media,
    enabled: opts.enabled ?? true,
    intervalMs: 1_000,
    now: () => clock,
    onChanged: (id) => changed.push(id),
    fetchSheet: async () => sheet,
    fetchImage: opts.image ?? (async () => PNG),
  });
  return {
    store,
    service,
    user,
    campaign,
    character,
    stored,
    changed,
    setSheet: (s: FetchOutcome) => (sheet = s),
    tick: (ms: number) => (clock += ms),
  };
}

const URL1 = 'https://www.dndbeyond.com/characters/123';

const SHEET = {
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
  maxHp: 50,
  armorClass: 16,
  passivePerception: 11,
  senses: [{ kind: 'darkvision' as const, range: 60 }],
  classes: [{ name: 'Fighter', level: 5, subclass: 'Champion' }],
};

describe('DdbSyncService', () => {
  it('keeps the at-a-glance numbers, and the last good ones when a later read has none', async () => {
    const t = await setup();
    t.setSheet({
      ok: true,
      character: {
        name: 'T',
        race: null,
        className: null,
        level: 5,
        portraitUrl: null,
        sheet: SHEET,
      },
    });
    const linked = await t.service.link(t.user, t.campaign.id, t.character.id, URL1);
    expect(linked.sheet).toEqual(SHEET);
    t.setSheet({
      ok: true,
      character: {
        name: 'T',
        race: null,
        className: null,
        level: 5,
        portraitUrl: null,
        sheet: null,
      },
    });
    t.tick(5_000);
    const again = await t.service.syncNow(t.user, t.campaign.id, t.character.id);
    expect(again.sheet).toEqual(SHEET);
    expect((await t.store.getCharacter(t.character.id))?.sheet).toEqual(SHEET);
  });

  it('links a character, copying its details and portrait', async () => {
    const t = await setup();
    const c = await t.service.link(t.user, t.campaign.id, t.character.id, URL1);
    expect(c).toMatchObject({
      name: 'Thessaly',
      race: 'Half-Elf',
      className: 'Fighter',
      level: 5,
      sourceUrl: URL1,
      syncedAt: 1_000,
    });
    expect(c.avatarUrl).toMatch(/^avatar:/);
    expect(t.stored.size).toBe(1);
    expect(t.changed).toEqual([t.campaign.id]);
  });

  it('refuses when disabled, for a bad link, and for a private sheet', async () => {
    const off = await setup({ enabled: false });
    await expect(
      off.service.link(off.user, off.campaign.id, off.character.id, URL1),
    ).rejects.toThrow(/not enabled/);
    const t = await setup();
    await expect(
      t.service.link(t.user, t.campaign.id, t.character.id, 'https://evil.example/characters/1'),
    ).rejects.toThrow(/not a D&D Beyond/);
    t.setSheet({ ok: false, reason: 'private' });
    await expect(t.service.link(t.user, t.campaign.id, t.character.id, URL1)).rejects.toThrow(
      /private/,
    );
  });

  it('only lets the owner link their own character', async () => {
    const t = await setup();
    const accounts = new AccountService({ store: t.store });
    const other = await accounts.register({
      email: 'b@example.com',
      displayName: 'B',
      password: 'correct horse battery',
      acceptedConsentVersion: '1',
    });
    await expect(t.service.link(other, t.campaign.id, t.character.id, URL1)).rejects.toThrow();
  });

  it("syncs progress, and re-imports the portrait only when the sheet's own changes", async () => {
    const t = await setup();
    await t.service.link(t.user, t.campaign.id, t.character.id, URL1);
    const mine = await t.store.getCharacter(t.character.id);
    await t.store.putCharacter({ ...mine!, avatarUrl: 'emblem:dragon' });
    t.setSheet({
      ok: true,
      character: {
        name: 'Thessaly',
        race: 'Half-Elf',
        className: 'Fighter',
        level: 6,
        portraitUrl: 'https://www.dndbeyond.com/a.png',
        sheet: null,
      },
    });
    const after = await t.service.syncNow(t.user, t.campaign.id, t.character.id);
    expect(after.level).toBe(6);
    expect(after.avatarUrl).toBe('emblem:dragon');
    t.setSheet({
      ok: true,
      character: {
        name: 'Thessaly',
        race: null,
        className: null,
        level: 6,
        portraitUrl: 'https://www.dndbeyond.com/b.png',
        sheet: null,
      },
    });
    const next = await t.service.syncNow(t.user, t.campaign.id, t.character.id);
    expect(next.avatarUrl).toMatch(/^avatar:/);
    expect(next.race).toBe('Half-Elf'); // missing in the reply: keep what we had
  });

  it('shrinks a portrait that is far over the size limit to a small square', async () => {
    const t = await setup({ image: async () => BIG_PNG });
    expect(BIG_PNG.length).toBeGreaterThan(256 * 1024);
    const c = await t.service.link(t.user, t.campaign.id, t.character.id, URL1);
    expect(c.avatarUrl).toMatch(/^avatar:/);
    const [bytes] = [...t.stored.values()];
    const meta = await sharp(bytes).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(bytes!.length).toBeLessThanOrEqual(256 * 1024);
  });

  it('tries the portrait again on the next sync when the first import failed', async () => {
    let fail = true;
    const t = await setup({ image: async () => (fail ? undefined : PNG) });
    const c = await t.service.link(t.user, t.campaign.id, t.character.id, URL1);
    expect(c.avatarUrl).toBeNull();
    expect(c.sourceAvatar).toBeNull();
    fail = false;
    const next = await t.service.syncNow(t.user, t.campaign.id, t.character.id);
    expect(next.avatarUrl).toMatch(/^avatar:/);
  });

  it('keeps the last good data and syncedAt when D&D Beyond fails', async () => {
    const t = await setup();
    await t.service.link(t.user, t.campaign.id, t.character.id, URL1);
    t.setSheet({ ok: false, reason: 'unavailable' });
    await expect(t.service.syncNow(t.user, t.campaign.id, t.character.id)).rejects.toThrow(
      /could not be reached/,
    );
    const c = await t.store.getCharacter(t.character.id);
    expect(c).toMatchObject({ name: 'Thessaly', syncedAt: 1_000 });
  });

  it('the timer refreshes only stale linked characters', async () => {
    const t = await setup();
    await t.service.link(t.user, t.campaign.id, t.character.id, URL1);
    expect(await t.service.syncDue()).toBe(0);
    t.tick(5_000);
    expect(await t.service.syncDue()).toBe(1);
    expect((await t.store.getCharacter(t.character.id))?.syncedAt).toBe(6_000);
  });

  it('does not store a picture that is not an image or is too large', async () => {
    const t = await setup();
    const svc = new DdbSyncService({
      store: t.store,
      campaigns: new CampaignService({ store: t.store }),
      media: {
        put: async () => undefined,
        get: async () => undefined,
        delete: async () => undefined,
      },
      enabled: true,
      intervalMs: 1,
      fetchSheet: async () => ({
        ok: true,
        character: {
          name: 'X',
          race: null,
          className: null,
          level: null,
          portraitUrl: 'https://www.dndbeyond.com/x.svg',
          sheet: null,
        },
      }),
      fetchImage: async () => Buffer.from('<svg onload=alert(1)>'),
    });
    const c = await svc.link(t.user, t.campaign.id, t.character.id, URL1);
    expect(c.avatarUrl).toBeNull();
  });

  it('unlinking clears the link but keeps the character as it is', async () => {
    const t = await setup();
    await t.service.link(t.user, t.campaign.id, t.character.id, URL1);
    const c = await t.service.unlink(t.user, t.campaign.id, t.character.id);
    expect(c).toMatchObject({ sourceUrl: null, syncedAt: null, name: 'Thessaly' });
  });

  it('makes a linked character in one step, and leaves nothing behind when the sheet cannot be read (protocol 4)', async () => {
    const t = await setup();
    t.setSheet({ ok: false, reason: 'private' });
    await expect(t.service.createLinked(t.user, t.campaign.id, URL1)).rejects.toThrow(/private/);
    expect(await t.store.listCharacters(t.user.id, t.campaign.id)).toHaveLength(1); // only the one setup made

    t.setSheet({
      ok: true,
      character: {
        name: 'Thessaly',
        race: 'Half-Elf',
        className: 'Fighter',
        level: 5,
        portraitUrl: null,
        sheet: SHEET,
      },
    });
    const made = await t.service.createLinked(t.user, t.campaign.id, URL1);
    expect(made).toMatchObject({
      name: 'Thessaly',
      race: 'Half-Elf',
      className: 'Fighter',
      level: 5,
      sourceUrl: URL1,
      syncedAt: 1_000,
      sheet: SHEET,
    });
    expect(await t.store.listCharacters(t.user.id, t.campaign.id)).toHaveLength(2);
    await expect(
      t.service.createLinked(t.user, t.campaign.id, 'https://example.com/x'),
    ).rejects.toThrow(/not a D&D Beyond/);
  });
});
