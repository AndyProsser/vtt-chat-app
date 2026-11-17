// Seeds the screenshot table on the local smoke stack: a Game Master and five players with characters,
// a stretch of chat (in-character lines, actions, a language, out-of-character, whispers), loot in every
// state, two handouts, a scheduled session with answers, and one recorded session with its summaries.
// Safe to run again: each part is skipped when it is already there.   node seed.mjs   (see README.md)
//
// The summaries are real model output from the records end-to-end run (infra/records-smoke), copied
// under this campaign: this script does not run the pipeline. Pass the source recording id as
// SOURCE_RECORDING, and optionally a newer Game Master brief as BRIEF_FILE.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { CAMPAIGN, CAST, admin, ok, openSocket, signInAll, sleep, sql } from './lib.mjs';

const DAY = 24 * 3600 * 1000;
const { seats } = await signInAll();
const gm = seats.get('gm');
const players = CAST.filter((c) => c.key !== 'gm').map((c) => seats.get(c.key));
const id = (key) => seats.get(key).userId;

// ---- campaign, members, characters ----
const mine = await ok('GET', '/api/campaigns', gm.token);
let campaignId = mine.campaigns.find((c) => c.campaign.name === CAMPAIGN)?.campaign.id;
if (!campaignId) {
  const closed = /campaign-creation\s+closed/.test(await admin('settings', 'show'));
  if (closed) await admin('settings', 'set', 'campaign-creation', 'open');
  try {
    campaignId = (await ok('POST', '/api/campaigns', gm.token, { name: CAMPAIGN })).campaign.id;
  } finally {
    if (closed) await admin('settings', 'set', 'campaign-creation', 'closed');
  }
  await ok('PATCH', `/api/campaigns/${campaignId}`, gm.token, {
    description:
      'A drowned temple, a silver key, and a toll paid in blood. **Thursdays, 7:30 pm.** New players welcome: ask to join.',
  }).catch((e) => console.warn('description not set:', e.message));
  console.log('created the campaign');
}
const at = `/api/campaigns/${campaignId}`;

const members = (await ok('GET', `${at}/members`, gm.token)).members;
let invite;
for (const p of players) {
  if (!members.some((m) => m.userId === p.userId)) {
    invite ??= (await ok('POST', `${at}/invites`, gm.token, {})).code;
    await ok('POST', '/api/campaigns/join', p.token, { code: invite });
  }
  const chars = (await ok('GET', `${at}/characters`, p.token)).characters;
  let character = chars.find((c) => c.name === p.character.name);
  character ??= (
    await ok('POST', `${at}/characters`, p.token, {
      ...p.character,
      avatarUrl: `emblem:${p.emblem}`,
    })
  ).character;
  await ok('PUT', `${at}/active-character`, p.token, { characterId: character.id });
}

// ---- handouts ----
if ((await ok('GET', `${at}/handouts`, gm.token)).handouts.length === 0) {
  const shown = await ok('POST', `${at}/handouts`, gm.token, {
    title: 'The vault inscription',
    text: '> *The king keeps what the king was given.*\n> *Who would enter pays the toll in blood;*\n> *who would leave pays it in breath.*\n\nCarved above the hidden door, in a hand older than the temple. Bram reads Dwarvish; this is close to it, but not quite.',
  });
  await ok('POST', `${at}/handouts/${shown.handout.id}/show`, gm.token, { to: 'all' });
  await ok('POST', `${at}/handouts`, gm.token, {
    title: 'GM: what the eel guards',
    text: 'The eel is the drowned king’s **steward**, not a beast. It will bargain if anyone thinks to speak to it.\n\n- Wants: the key returned.\n- Offers: safe passage out.',
  });
}

// ---- chat (and the loot and whispers that happen during it) ----
const have = (await ok('GET', `${at}/chat`, gm.token)).messages ?? [];
if (have.length === 0) {
  const sockets = new Map();
  for (const seat of seats.values()) sockets.set(seat.key, await openSocket(seat, campaignId));
  const say = async (who, text, extra = {}) => {
    sockets.get(who).send('chat.message', { text, ...extra });
    await sleep(350);
  };
  await say(
    'gm',
    'Welcome back. The hidden door behind the altar stands open, and cold air rolls out of it.',
  );
  await say('aria', 'nocks an arrow and edges toward the doorway', { kind: 'do' });
  await say('bram', 'Stay behind the shield. I go first.', { kind: 'say' });
  await say('dorn', 'Doors are just walls that haven’t committed yet.', { kind: 'say' });
  await say('cass', 'Does my patron react to the key?', { to: id('gm') });
  await say('gm', 'It hums against your palm. Something far below is listening.', {
    to: id('cass'),
  });
  await say('cass', 'The toll is paid. Open.', { kind: 'say', lang: 'infernal' });
  await say('elle', 'brb, kettle', { kind: 'ooc' });
  await ok('POST', `${at}/loot`, gm.token, {
    name: 'Silver Key of the Drowned King',
    description: 'Warm to the touch. It opens the vault, for a price.',
    itemType: 'wondrous',
    rarity: 'rare',
  });
  await sleep(350);
  await say('dorn', 'Is that a lever or a trap? Both?', { kind: 'ooc' });
  await say('elle', 'I hum the old hymn the carvings show. Do the statues answer?', {
    kind: 'say',
  });
  await say('gm', 'They turn their heads. All of them. Toward Cassiel.');
  await say('bram', 'By the forge. Nobody move.', { kind: 'say', lang: 'dwarvish' });
  for (const s of sockets.values()) s.close();
}

// ---- loot: one of each state (the key above stays up for grabs) ----
const loot = (await ok('GET', `${at}/loot`, gm.token)).loot;
if (loot.length <= 1) {
  const drop = async (body) => (await ok('POST', `${at}/loot`, gm.token, body)).item.id;
  const potion = await drop({
    name: 'Potion of Healing',
    quantity: 2,
    itemType: 'potion',
    rarity: 'common',
  });
  await ok('POST', `${at}/loot/${potion}/claim`, seats.get('bram').token, { for: 'party' });
  const dagger = await drop({
    name: 'Eel-tooth dagger',
    description: 'Serrated, and never quite dry.',
    itemType: 'weapon',
    rarity: 'uncommon',
  });
  await ok('POST', `${at}/loot/${dagger}/claim`, seats.get('cass').token, { for: 'self' });
  const coin = await drop({ name: 'gp', quantity: 240, kind: 'coin' });
  await ok('POST', `${at}/loot/${coin}/split`, gm.token, {});
  const pearl = await drop({ name: 'Black pearl', quantity: 3, itemType: 'gem' });
  await ok('POST', `${at}/loot/${pearl}/assign`, gm.token, { userId: id('aria') });
  await drop({
    name: 'Waterlogged prayer book',
    description: 'The last pages are in another hand.',
    itemType: 'gear',
  });
}

// ---- the next session, with answers ----
let sessions = (await ok('GET', `${at}/sessions`, gm.token)).sessions;
if (sessions.length === 0) {
  const next = new Date(Date.now() + 4 * DAY);
  next.setHours(19, 30, 0, 0);
  await ok('POST', `${at}/sessions`, gm.token, {
    title: 'Session 12: the vault below',
    startsAt: next.getTime(),
    durationMinutes: 180,
    notes: 'Bring the key. Bring bandages.',
  });
  sessions = (await ok('GET', `${at}/sessions`, gm.token)).sessions;
  const sessionId = sessions[0].id ?? sessions[0].session?.id;
  const answers = { aria: 'yes', bram: 'yes', cass: 'late', dorn: 'yes', elle: 'no' };
  for (const [who, status] of Object.entries(answers)) {
    await ok('PUT', `${at}/sessions/${sessionId}/rsvp`, seats.get(who).token, { status });
  }
}

// ---- one recorded session and its summaries, copied from the end-to-end run ----
const recorded = await sql(`SELECT count(*) FROM recordings WHERE campaign_id = '${campaignId}'`);
const source = process.env.SOURCE_RECORDING;
if (recorded === '0' && source) {
  if (!/^[0-9a-f-]{36}$/.test(source)) throw new Error('SOURCE_RECORDING is not a recording id');
  const recordingId = randomUUID();
  const started = new Date(Date.now() - 3 * DAY);
  started.setHours(19, 34, 0, 0);
  const stopped = started.getTime() + (2 * 60 + 52) * 60 * 1000;
  // The end-to-end cast's Game Master is called "E2E DM"; here it is Morgan.
  await sql(`
    INSERT INTO recordings (id, campaign_id, started_at, stopped_at, status)
      VALUES ('${recordingId}', '${campaignId}', ${started.getTime()}, ${stopped}, 'processed');
    INSERT INTO summaries (id, recording_id, kind, subject, visibility, text, model_calls, created_at)
      SELECT gen_random_uuid(), '${recordingId}', kind, subject, visibility,
             replace(text, 'E2E DM', 'Morgan'), model_calls, ${stopped + 40 * 60 * 1000}
      FROM summaries WHERE recording_id = '${source}';`);
  if (process.env.BRIEF_FILE) {
    const brief = readFileSync(process.env.BRIEF_FILE, 'utf8').trim().replaceAll("'", "''");
    await sql(
      `UPDATE summaries SET text = '${brief}' WHERE recording_id = '${recordingId}' AND kind = 'dm-only'`,
    );
  }
  console.log('copied one recorded session');
}

console.log(`Seeded "${CAMPAIGN}" (${campaignId}).`);
