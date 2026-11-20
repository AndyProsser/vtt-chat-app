// The phone app's table page, Invite page (with its QR code) and Leave, in a real browser, as a DM and as a player.
// Local smoke-stack tooling like ui-smoke.mjs (see README.md); uses the throwaway accounts and the "E2E: Protocol 4"
// campaign that infra/records-smoke/protocol4-e2e.ts makes (run that first). Takes screenshots into $OUT: look at them.
//
//   NODE_PATH=~/scratch/ui-tests/node_modules NODE_EXTRA_CA_CERTS=<caddy root.crt> OUT=~/scratch/ui-shots \
//     node web/e2e/campaign-screens.mjs
import {
  admin,
  api,
  clickText,
  ensureUser,
  launch,
  newPage,
  noOverflow,
  sessionFor,
  shot,
  sleep,
  waitText,
} from './lib.mjs';

const problems = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const DM = 'p4-dm@example.com';
const ANN = 'p4-ann@example.com';
const BO = 'p4-bo@example.com';
for (const [e, n] of [
  [DM, 'P4 Dungeon Master'],
  [ANN, 'P4 Ann'],
  [BO, 'P4 Bo'],
])
  ensureUser(e, n);

const browser = await launch();
try {
  const dmCookie = await sessionFor(DM);
  const mine = (await api(dmCookie, 'GET', '/api/campaigns')).json.campaigns;
  const campaignId = mine.find((c) => c.campaign.name.startsWith('E2E: Protocol 4'))?.campaign.id;
  if (!campaignId) throw new Error('run infra/records-smoke/protocol4-e2e.ts first');
  const original = mine.find((c) => c.campaign.id === campaignId).campaign;

  for (const scheme of ['light', 'dark']) {
    // ---- the Game Master ----
    const dm = await newPage(browser, {
      view: 'mobile',
      scheme,
      cookie: dmCookie,
      tag: `dm/${scheme}`,
      problems,
    });
    await dm.goto(`${new URL('/app', 'https://localhost')}`, { waitUntil: 'networkidle2' });
    await dm.waitForSelector('.phone-title-btn', { timeout: 15000 });
    await dm.click('.phone-title-btn');
    await waitText(dm, /About this table|This table/i);
    await waitText(dm, /Storyteller/);
    check(
      `dm/${scheme}: the table page shows the name and the storyteller`,
      /E2E: Protocol 4/.test(await dm.evaluate(() => document.body.innerText)),
    );
    check(
      `dm/${scheme}: the DM can edit`,
      !!(await dm.$('button[aria-label="Edit the name and description"]')),
    );
    check(`dm/${scheme}: no sideways scrolling`, await noOverflow(dm));
    await shot(dm, `campaign-dm-${scheme}`);

    if (scheme === 'light') {
      await dm.click('button[aria-label="Edit the name and description"]');
      await dm.waitForSelector('#campaign-name');
      await dm.$eval('#campaign-name', (e) => (e.value = ''));
      await dm.type('#campaign-name', 'E2E: Protocol 4 (edited)');
      await dm.type('#campaign-description', 'A **test** table.');
      await shot(dm, 'campaign-dm-edit');
      await clickText(dm, /^Save$/);
      await waitText(dm, /\(edited\)/);
      const after = (await api(dmCookie, 'GET', '/api/campaigns')).json.campaigns.find(
        (c) => c.campaign.id === campaignId,
      ).campaign;
      check(
        'dm: saving changes the name and the description on the server',
        after.name.endsWith('(edited)') && /test/.test(after.description),
      );
      // put it back
      await api(dmCookie, 'PATCH', `/api/campaigns/${campaignId}`, {
        name: original.name,
        description: original.description ?? '',
      });
    }

    // ---- Invite ----
    await dm.goto('https://localhost/app', { waitUntil: 'networkidle2' });
    await dm.waitForSelector('.phone-burger');
    await dm.click('.phone-burger');
    await clickText(dm, /^Invite$/);
    await waitText(dm, /Make an invite link/);
    await clickText(dm, /Make an invite link/);
    await dm.waitForSelector('img.phone-qr', { timeout: 10000 });
    const link = await dm.$eval('.phone-invite-link', (e) => e.textContent);
    check(
      `dm/${scheme}: the invite link and QR code appear`,
      /\/join\/[A-Z0-9-]+/i.test(link),
      link,
    );
    const qr = await dm.$eval('img.phone-qr', (e) => ({
      w: e.naturalWidth,
      src: e.src.slice(0, 22),
    }));
    check(
      `dm/${scheme}: the QR code is an image`,
      qr.w > 100 && qr.src.startsWith('data:image/png'),
    );
    await clickText(dm, /Copy link/);
    await waitText(dm, /link copied/i);
    const copied = await dm.evaluate(() => navigator.clipboard.readText());
    check(`dm/${scheme}: Copy link copies the link`, copied === link);
    check(`dm/${scheme}: no sideways scrolling on the invite page`, await noOverflow(dm));
    await shot(dm, `invite-dm-${scheme}`);
    if (scheme === 'dark') {
      await dm.click('button[aria-label="Stop all invite links…"]');
      await clickText(dm, /Yes, stop them all/);
      await waitText(dm, /stopped working/);
      check('dm: stopping the links works', true);
    }
    await dm.__context.close();
  }

  // ---- a player ----
  const annCookie = await sessionFor(ANN);
  const ann = await newPage(browser, {
    view: 'mobile',
    scheme: 'dark',
    cookie: annCookie,
    tag: 'player',
    problems,
  });
  await ann.goto('https://localhost/app', { waitUntil: 'networkidle2' });
  await ann.waitForSelector('.phone-title-btn', { timeout: 15000 });
  await ann.click('.phone-title-btn');
  await waitText(ann, /Storyteller/);
  check(
    'player: no edit button',
    !(await ann.$('button[aria-label="Edit the name and description"]')),
  );
  check('player: can leave', !!(await ann.$('button[aria-label="Leave this table…"]')));
  await ann.click('.phone-burger');
  const menu = await ann.evaluate(() => document.body.innerText);
  check('player: no Invite in the menu', !/\bInvite\b/.test(menu.split('Home')[0] ?? ''));
  await ann.keyboard.press('Escape');
  await shot(ann, 'campaign-player');
  await ann.__context.close();

  // ---- leaving (Bo leaves, then is invited back) ----
  const boCookie = await sessionFor(BO);
  const bo = await newPage(browser, {
    view: 'mobile',
    scheme: 'light',
    cookie: boCookie,
    tag: 'leaver',
    problems,
  });
  await bo.goto('https://localhost/app', { waitUntil: 'networkidle2' });
  await bo.waitForSelector('.phone-title-btn', { timeout: 15000 });
  await bo.click('.phone-title-btn');
  await bo.waitForSelector('button[aria-label="Leave this table…"]');
  await bo.click('button[aria-label="Leave this table…"]');
  await waitText(bo, /Yes, leave/);
  await shot(bo, 'campaign-leave-confirm');
  await clickText(bo, /Yes, leave/);
  await sleep(1500);
  const left = (await api(boCookie, 'GET', '/api/campaigns')).json.campaigns.some(
    (c) => c.campaign.id === campaignId,
  );
  check('player: leaving removes them from the table', !left);
  await bo.__context.close();
  const invite = (await api(dmCookie, 'POST', `/api/campaigns/${campaignId}/invites`, {})).json
    .code;
  await api(boCookie, 'POST', '/api/campaigns/join', { code: invite });
  void admin;
} finally {
  await browser.close();
}
for (const p of problems) console.log('PROBLEM', p);
console.log(
  failed === 0 && problems.length === 0
    ? 'ALL PASSED'
    : `${failed} FAILED, ${problems.length} problems`,
);
process.exit(failed === 0 && problems.length === 0 ? 0 : 1);
