/* eslint-disable @typescript-eslint/no-explicit-any -- dev scripts read loosely typed JSON */
// Seeds a development campaign: a DM account to sign in with, four mock players with characters,
// some loot and a handout, and a scheduled session. Safe to run again (it signs in and skips what exists).
//
//   npm run dev:seed        (backend must be running: node backend/dist/index.js)
//
// Passwords are generated into .dev/accounts.json and never printed.

import { call, loadState, saveState, signIn, type Session } from './lib.ts';

const CAMPAIGN = 'The Sunken Crypt';

async function main(): Promise<void> {
  const state = loadState();
  const sessions: Session[] = [];
  for (const person of state.people) sessions.push(await signIn(person));
  saveState(state); // the passwords are now in use; keep them
  const dm = sessions.find((s) => s.person.role === 'dm')!;
  const players = sessions.filter((s) => s.person.role === 'player');

  const mine = await call('GET', '/api/campaigns', dm.token);
  let campaignId: string | undefined = mine.body.campaigns?.find(
    (c: any) => c.campaign.name === CAMPAIGN,
  )?.campaign.id;
  if (!campaignId) {
    const created = await call('POST', '/api/campaigns', dm.token, { name: CAMPAIGN });
    if (created.status !== 201)
      throw new Error(`could not create the campaign (${created.status})`);
    campaignId = created.body.campaign.id as string;
    console.log(`created campaign "${CAMPAIGN}"`);
  }
  state.campaignId = campaignId;
  saveState(state);

  const members = await call('GET', `/api/campaigns/${campaignId}/members`, dm.token);
  const memberIds = new Set((members.body.members ?? []).map((m: any) => m.userId));
  const invite = (await call('POST', `/api/campaigns/${campaignId}/invites`, dm.token, {})).body
    .code;
  for (const p of players) {
    if (!memberIds.has(p.userId)) {
      const joined = await call('POST', '/api/campaigns/join', p.token, { code: invite });
      if (joined.status >= 300)
        throw new Error(`${p.person.key} could not join (${joined.status})`);
    }
    if (p.person.character) {
      const have = (members.body.members ?? []).find((m: any) => m.userId === p.userId);
      if (!have?.activeCharacterId) {
        const made = await call('POST', `/api/campaigns/${campaignId}/characters`, p.token, {
          ...p.person.character,
        });
        if (made.status === 201) {
          await call('PUT', `/api/campaigns/${campaignId}/active-character`, p.token, {
            characterId: made.body.character.id,
          });
        }
      }
    }
  }

  const loot = await call('GET', `/api/campaigns/${campaignId}/loot`, dm.token);
  if ((loot.body.loot ?? []).length === 0) {
    const drops = [
      { name: 'Potion of Healing', quantity: 2 },
      { name: 'Rusted iron key', description: 'Opens something old and damp.' },
      { name: 'gp', quantity: 120, kind: 'coin' },
    ];
    for (const d of drops) await call('POST', `/api/campaigns/${campaignId}/loot`, dm.token, d);
  }

  const handouts = await call('GET', `/api/campaigns/${campaignId}/handouts`, dm.token);
  if ((handouts.body.handouts ?? []).length === 0) {
    const h = await call('POST', `/api/campaigns/${campaignId}/handouts`, dm.token, {
      title: 'The crypt inscription',
      text: 'Those who wake the sleeper pay in water, then in breath.',
    });
    if (h.status === 201) {
      await call(
        'POST',
        `/api/campaigns/${campaignId}/handouts/${h.body.handout.id}/show`,
        dm.token,
        {
          to: 'all',
        },
      );
    }
  }

  const sessionsList = await call('GET', `/api/campaigns/${campaignId}/sessions`, dm.token);
  if ((sessionsList.body.sessions ?? []).length === 0) {
    await call('POST', `/api/campaigns/${campaignId}/sessions`, dm.token, {
      title: 'Session 4 — into the flooded crypt',
      startsAt: Date.now() + 3 * 24 * 3600 * 1000,
    });
  }

  // A second campaign where Aria is the DM and the test DM is just a player: roles are per campaign,
  // so this is what switching campaigns (and a different DM) looks like.
  const aria = sessions.find((x) => x.person.key === 'aria')!;
  const second = 'Embers of Valdris';
  const ariaCampaigns = await call('GET', '/api/campaigns', aria.token);
  let secondId: string | undefined = ariaCampaigns.body.campaigns?.find(
    (c: any) => c.campaign.name === second,
  )?.campaign.id;
  if (!secondId) {
    const made = await call('POST', '/api/campaigns', aria.token, { name: second });
    if (made.status === 201) {
      secondId = made.body.campaign.id as string;
      const code = (await call('POST', `/api/campaigns/${secondId}/invites`, aria.token, {})).body
        .code;
      await call('POST', '/api/campaigns/join', dm.token, { code });
      console.log(`created campaign "${second}" (Aria is its DM)`);
    }
  }

  console.log(`\nSeeded "${CAMPAIGN}" (${campaignId}).`);
  console.log(
    'Sign in to the app as the DM:   dm@vtt.test   (a player in "Embers of Valdris", where Aria is DM)',
  );
  console.log('Players (mock table-mates):     aria@  bram@  cass@  dorn@ vtt.test');
  console.log('Passwords: .dev/accounts.json   (generated; never printed)');
  console.log('Next: npm run dev:mock  to bring the players online with chat and voice.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
