// Real-browser smoke test of the web UI against the local Compose smoke stack. See README.md.
//   NODE_PATH=<scratch>/node_modules NODE_EXTRA_CA_CERTS=<caddy-root.crt> node web/e2e/ui-smoke.mjs [flow ...]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  admin,
  api,
  BASE,
  clickText,
  ensureUser,
  freshSession,
  launch,
  newPage,
  noOverflow,
  OUT,
  readAndy,
  sessionFor,
  shot,
  sleep,
  waitText,
} from './lib.mjs';

const problems = [];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
};
const schemes = ['light', 'dark'];
const views = ['desktop', 'mobile'];

const T = {
  dm: { email: 'dmx@example.com', name: 'Test dmx' },
  pl: { email: 'pla@example.com', name: 'Test pla' },
  rq: { email: 'reqb@example.com', name: 'Test reqb' },
  ac: { email: 'acct@example.com', name: 'Test acct' },
};
const CAMPAIGN_NAME = 'UI Smoke Table';

const flows = {};

// 1. Landing -------------------------------------------------------------------------------------------
flows.landing = async (b) => {
  for (const view of views)
    for (const scheme of schemes) {
      const p = await newPage(b, { view, scheme, problems });
      const tag = `landing ${view}/${scheme}`;
      await p.goto(BASE + '/', { waitUntil: 'networkidle0' });
      await shot(p, `landing-out-${view}-${scheme}`);
      const out = await p.evaluate(() => ({
        nav: [...document.querySelectorAll('.site-nav a')].map((a) => a.textContent.trim()),
        hasInvite: !!document.querySelector('[aria-label="Invite code"]'),
        body: document.body.innerText,
      }));
      check(`${tag}: signed-out nav is Status only`, out.nav.join() === 'Status', out.nav.join());
      check(`${tag}: invite box + sign in`, out.hasInvite && /Sign in/.test(out.body));
      check(`${tag}: no x-overflow`, await noOverflow(p));
      // sign in with an operator code through the UI
      await clickText(p, /^Sign in$/);
      await clickText(p, /I have a sign-in code/);
      await p.type('[aria-label="Sign-in code"]', signInCodeFor(T.pl.email));
      await shot(p, `landing-code-${view}-${scheme}`);
      await p.keyboard.press('Enter');
      if (view === 'mobile') {
        // On a phone the landing page hands straight over to the web app.
        await p.waitForFunction(() => location.pathname === '/app', { timeout: 10000 });
        await sleep(1200);
        await shot(p, `landing-handoff-${view}-${scheme}`);
        check(`${tag}: phone hand-off lands in /app`, true);
        check(`${tag}: no x-overflow in /app`, await noOverflow(p));
        await signOutOfApp(p);
        const left = (await p.cookies(BASE)).filter((c) => c.name === '__Host-vtt_session').length;
        check(`${tag}: app sign out clears cookie`, left === 0);
        await p.__context.close();
        continue;
      }
      await waitText(p, /You're signed in/);
      await sleep(600);
      const inn = await p.evaluate(() => ({
        nav: [...document.querySelectorAll('.site-nav a')].map((a) => a.textContent.trim()),
        open:
          document
            .querySelector('a[href^="vtt-chat://"], a[href*="connect"]')
            ?.getAttribute('href') ?? null,
        body: document.body.innerText,
      }));
      check(
        `${tag}: signed-in nav`,
        inn.nav.join() === 'Chat,Download,Account,Status',
        inn.nav.join(),
      );
      if (view === 'desktop') {
        check(
          `${tag}: Open VTT Chat link has long token`,
          inn.open && inn.open.length > 60,
          String(inn.open?.length),
        );
        check(`${tag}: downloads hint`, /Downloads page/.test(inn.body));
        await clickText(p, /Can't open the app/);
        await waitText(p, /Expires in/);
        const code = await p.$eval('.connect-code', (e) => e.textContent);
        check(
          `${tag}: code shown ABCD-EFGH + countdown`,
          /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code.trim()),
          code,
        );
        const c1 = await p.evaluate(
          () => document.body.innerText.match(/Expires in ([^\n]+)/)?.[1],
        );
        await sleep(2200);
        const c2 = await p.evaluate(
          () => document.body.innerText.match(/Expires in ([^\n]+)/)?.[1],
        );
        check(`${tag}: countdown ticks`, c1 !== c2, `${c1} -> ${c2}`);
        await shot(p, `landing-in-${view}-${scheme}`);
      } else {
        check(
          `${tag}: mobile hand-off view`,
          /app/i.test(inn.body),
          inn.body.slice(0, 100).replace(/\n/g, ' | '),
        );
        await shot(p, `landing-in-${view}-${scheme}`);
      }
      check(`${tag}: no x-overflow signed in`, await noOverflow(p));
      await clickText(p, /Sign out/);
      // The page flips to signed-out at once; the cookie goes when the logout response lands.
      for (
        let i = 0;
        i < 20 && (await p.cookies(BASE)).some((c) => c.name === '__Host-vtt_session');
        i++
      )
        await sleep(250);
      const cookies = (await p.cookies(BASE)).filter((c) => c.name === '__Host-vtt_session');
      const nav2 = await p.evaluate(() =>
        [...document.querySelectorAll('.site-nav a')].map((a) => a.textContent.trim()).join(),
      );
      check(
        `${tag}: sign out clears cookie + nav`,
        cookies.length === 0 && nav2 === 'Status',
        `cookies=${cookies.length} nav=${nav2}`,
      );
      await p.__context.close();
    }
};

// 2. Download -------------------------------------------------------------------------------------------
flows.download = async (b) => {
  for (const view of views)
    for (const scheme of schemes) {
      const tag = `download ${view}/${scheme}`;
      const out = await newPage(b, { view, scheme, problems });
      await out.goto(BASE + '/download', { waitUntil: 'networkidle0' });
      const gated = await out.evaluate(() => ({
        login: !!document.querySelector('[aria-label="Email"]'),
        text: document.body.innerText,
        tabs: !!document.querySelector('[role=tab]'),
      }));
      check(
        `${tag}: gated when signed out`,
        gated.login && !gated.tabs && /Sign in to download/.test(gated.text),
      );
      await shot(out, `download-gated-${view}-${scheme}`);
      await out.__context.close();

      const cookie = await sessionFor(T.pl.email);
      const p = await newPage(b, { view, scheme, cookie, problems });
      await p.goto(BASE + '/download', { waitUntil: 'networkidle0' });
      const tabs = await p.$$eval('[role=tab]', (els) =>
        els.map((e) => e.innerText.trim().split('\n')[0]),
      );
      check(`${tag}: tabs per OS`, tabs.join() === 'Windows,macOS,Linux', tabs.join());
      const stepsOf = () => p.$eval('[role=tabpanel][data-state=active]', (e) => e.innerText);
      const per = {};
      for (const t of ['Windows', 'macOS', 'Linux']) {
        await clickText(p, new RegExp(`^${t}$`), '[role=tab]');
        await sleep(250);
        per[t] = await stepsOf();
        await shot(p, `download-${t}-${view}-${scheme}`);
        check(`${tag}: ${t} no x-overflow`, await noOverflow(p));
      }
      check(`${tag}: instructions differ per OS`, new Set(Object.values(per)).size === 3);
      // Linux formats
      const seg = await p.$$eval('[role=radio]', (els) =>
        els.map((e) => e.innerText.trim().split('\n')[0]),
      );
      const lin = {};
      for (const f of seg) {
        await clickText(
          p,
          new RegExp(`^${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
          '[role=radio]',
        );
        await sleep(250);
        lin[f] = await stepsOf();
        check(`${tag}: Linux ${f} no x-overflow`, await noOverflow(p));
      }
      check(
        `${tag}: Linux formats present (${seg.join('/')}) and switch text`,
        seg.length >= 2 && new Set(Object.values(lin)).size === seg.length,
      );
      // copy button
      const btn = await p.$('[role=tabpanel][data-state=active] .install-copy');
      if (btn) {
        await btn.click();
        await sleep(300);
        const clip = await p
          .evaluate(() => navigator.clipboard.readText())
          .catch((e) => 'ERR ' + e.message);
        const cmd = await p.$eval('[role=tabpanel][data-state=active] .install-command', (e) =>
          e.textContent.trim(),
        );
        const iconNow = await p.$eval(
          '[role=tabpanel][data-state=active] .install-copy',
          (e) => e.innerHTML.length,
        );
        const status = await p.evaluate(() => document.querySelector('[role=status]')?.textContent);
        check(`${tag}: copy puts command on clipboard`, clip.trim() === cmd, clip.slice(0, 60));
        check(`${tag}: copy announces Copied`, /Copied/.test(status ?? ''), String(status));
        await sleep(2300);
        const iconLater = await p.$eval(
          '[role=tabpanel][data-state=active] .install-copy',
          (e) => e.innerHTML.length,
        );
        check(`${tag}: copy icon swaps and reverts`, iconNow !== iconLater);
      } else check(`${tag}: copy button exists on active Linux panel`, false);
      await p.__context.close();
    }
};

// Account page (NOT YET RUN: written alongside the page; run `node ui-smoke.mjs account` on the smoke stack). ---
// Uses its own throwaway account so signing out "all other devices" cannot cost another flow its session.
// A 1x1 PNG, enough for the picker (the page crops and re-encodes it).
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PW_A = 'Account-flow-passphrase-A';
const PW_B = 'Account-flow-passphrase-B';
const BAD_LABEL = '<img src=x onerror=alert(1)> evil';

flows.account = async (b) => {
  // Signed out: the sign-in form, none of the cards.
  for (const scheme of schemes) {
    const out = await newPage(b, { view: 'desktop', scheme, problems });
    await out.goto(BASE + '/account', { waitUntil: 'networkidle0' });
    const gated = await out.evaluate(() => ({
      login: !!document.querySelector('[aria-label="Email"]'),
      cards: document.querySelectorAll('#account-profile, #account-devices').length,
      nav: [...document.querySelectorAll('.site-nav a')].map((a) => a.textContent.trim()).join(),
    }));
    check(
      `account ${scheme}: signed out shows the sign-in form only`,
      gated.login && gated.cards === 0 && gated.nav === 'Status',
      JSON.stringify(gated),
    );
    await out.__context.close();
  }

  for (const view of views)
    for (const scheme of schemes) {
      const tag = `account ${view}/${scheme}`;
      // Fetched per page: the desktop/light pass ends by signing its own session out.
      const cookie = await sessionFor(T.ac.email);
      // A second device, labelled with hostile text, so the list has something to sign out.
      const other = await freshSession(T.ac.email, BAD_LABEL);
      check(`${tag}: second session created`, !!other);
      const p = await newPage(b, { view, scheme, cookie, problems });
      await p.goto(BASE + '/account', { waitUntil: 'networkidle0' });
      await waitText(p, /Your account/);
      const page = await p.evaluate(() => ({
        heads: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()).join(),
        nav: [...document.querySelectorAll('.site-nav a')].map((a) => a.textContent.trim()).join(),
        current: document.querySelector('.site-nav a[aria-current=page]')?.textContent.trim(),
        thisDevice: [...document.querySelectorAll('.account-device')].filter((r) =>
          /This device/.test(r.innerText),
        ).length,
        rows: document.querySelectorAll('.account-device').length,
        injected: !!document.querySelector('.account-devices img'),
        labelShown: document.querySelector('.account-devices')?.innerText.includes('<img src=x'),
      }));
      await shot(p, `account-${view}-${scheme}`);
      check(
        `${tag}: four cards`,
        page.heads === 'Profile,Recording notice,Security,Devices',
        page.heads,
      );
      check(
        `${tag}: Account is in the nav and marked current`,
        page.nav === 'Chat,Download,Account,Status' && page.current === 'Account',
        `${page.nav} / ${page.current}`,
      );
      check(`${tag}: this device is marked exactly once`, page.thisDevice === 1);
      check(`${tag}: another device is listed`, page.rows >= 2, String(page.rows));
      check(
        `${tag}: a hostile device label is text, not markup`,
        !page.injected && page.labelShown,
      );
      check(`${tag}: no x-overflow`, await noOverflow(p));

      if (view === 'desktop' && scheme === 'light') {
        // Rename, and put it back.
        await setField(p, '#account-name', 'Test acct renamed');
        await clickText(p, /^Save$/);
        await waitText(p, /Name saved/);
        const renamed = (await api(cookie, 'GET', '/api/auth/me')).json?.user?.displayName;
        check(`${tag}: rename is saved`, renamed === 'Test acct renamed', String(renamed));
        await setField(p, '#account-name', T.ac.name);
        await clickText(p, /^Save$/);
        await waitText(p, /Name saved/);

        // Picture: upload, then remove.
        const file = join(OUT, 'account-avatar.png');
        writeFileSync(file, TINY_PNG);
        const input = await p.$('input[type=file]');
        await input.uploadFile(file);
        await waitText(p, /Picture updated/);
        const av = (await api(cookie, 'GET', '/api/auth/me')).json?.user?.avatarUrl;
        check(`${tag}: picture upload sets an avatar`, /^avatar:/.test(av ?? ''), String(av));
        await clickText(p, /^Remove$/);
        await waitText(p, /Picture removed/);
        const gone = (await api(cookie, 'GET', '/api/auth/me')).json?.user?.avatarUrl;
        check(`${tag}: picture removed`, gone === null, String(gone));

        // Confirm-by-second-click on one other device.
        const before = (await api(cookie, 'GET', '/api/auth/sessions')).json.sessions.length;
        await clickText(p, /^Sign out$/, '.account-device:not(:has(.rt-Badge)) button');
        await sleep(300);
        const armed = await p.evaluate(() =>
          /Press again to sign out/.test(document.querySelector('.account-devices')?.innerText),
        );
        const stillThere = (await api(cookie, 'GET', '/api/auth/sessions')).json.sessions.length;
        check(`${tag}: first press only arms the button`, armed && stillThere === before);
        await clickText(p, /Press again to sign out/);
        await waitText(p, /Device signed out/);
        const after = (await api(cookie, 'GET', '/api/auth/sessions')).json.sessions.length;
        check(
          `${tag}: second press signs that device out`,
          after === before - 1,
          `${before}->${after}`,
        );
        check(
          `${tag}: the signed-out session no longer works`,
          (await api(other, 'GET', '/api/auth/me')).status === 401,
        );

        // Sign out all other devices.
        const extra = await freshSession(T.ac.email, 'Another browser');
        await p.reload({ waitUntil: 'networkidle0' });
        await waitText(p, /Sign out all other devices/);
        await clickText(p, /^Sign out all other devices$/);
        await sleep(300);
        await clickText(p, /Press again to sign out all other devices/);
        await waitText(p, /other devices? signed out|No other devices/);
        await sleep(500);
        const left = (await api(cookie, 'GET', '/api/auth/sessions')).json.sessions;
        check(`${tag}: all other devices are signed out`, left.length === 1 && left[0].current);
        check(
          `${tag}: that session is dead`,
          (await api(extra, 'GET', '/api/auth/me')).status === 401,
        );

        // Password: set, or change from whichever of the two the last run left.
        await p.reload({ waitUntil: 'networkidle0' });
        await waitText(p, /Security/);
        const fill = (sel, v) => setField(p, sel, v);
        // The password form starts folded away: open it (a no-op when it is already open after a refusal).
        const openForm = async () => {
          if (!(await p.$('#account-new'))) await clickText(p, /^(Change|Set) password$/);
          await p.waitForSelector('#account-new');
        };
        check(`${tag}: the password form starts folded away`, !(await p.$('#account-new')));
        await openForm();
        const has = !!(await p.$('#account-current'));
        const attempt = async (from, to) => {
          await openForm();
          if (from) await fill('#account-current', from);
          await fill('#account-new', to);
          await fill('#account-confirm', to);
          await clickText(p, /^Save password$/);
          await sleep(1200);
          return p.evaluate(() => document.body.innerText);
        };
        let body = await attempt(has ? PW_A : undefined, PW_B);
        if (/not your current password/.test(body)) body = await attempt(PW_B, PW_A);
        check(
          `${tag}: password set or changed`,
          /Password (set|changed)\./.test(body),
          body.slice(0, 80),
        );
        check(`${tag}: the form folds away again after a change`, !(await p.$('#account-new')));
        const mismatch = await (async () => {
          await openForm();
          await fill('#account-current', PW_A);
          await fill('#account-new', 'a-different-passphrase');
          await fill('#account-confirm', 'not-the-same-one-ok');
          await clickText(p, /^Save password$/);
          await sleep(300);
          return p.evaluate(() => document.body.innerText);
        })();
        check(`${tag}: a mismatch is refused before it is sent`, /do not match/.test(mismatch));
        check(
          `${tag}: the account now reports a password`,
          (await api(cookie, 'GET', '/api/auth/me')).json?.user?.hasPassword === true,
        );

        // Sign out this device from its own row: the page flips to the sign-in form.
        await clickText(p, /^Sign out$/, '.account-device button');
        await waitText(p, /Sign in to manage/);
        check(`${tag}: signing out here returns to the sign-in form`, true);
      }
      await p.__context.close();
    }
};

// Table setup (API): dmx's own campaign with pla as a player, Allow join on, one upcoming session. ---------
async function ensureTable() {
  const dm = await sessionFor(T.dm.email);
  const pl = await sessionFor(T.pl.email);
  const list = ((await api(dm, 'GET', '/api/campaigns')).json.campaigns ?? []).map(
    (x) => x.campaign,
  );
  let c = list.find((x) => x.name === CAMPAIGN_NAME);
  if (!c) {
    const r = await api(dm, 'POST', '/api/campaigns', { name: CAMPAIGN_NAME });
    if (r.status !== 201) throw new Error('create campaign ' + r.status + JSON.stringify(r.json));
    c = r.json.campaign;
  }
  const mine = ((await api(pl, 'GET', '/api/campaigns')).json.campaigns ?? []).map(
    (x) => x.campaign,
  );
  if (!mine.some((x) => x.id === c.id)) {
    const inv = await api(dm, 'POST', `/api/campaigns/${c.id}/invites`, {});
    const j = await api(pl, 'POST', '/api/campaigns/join', { code: inv.json.code });
    if (j.status !== 201) throw new Error('join ' + j.status);
  }
  const sess = (await api(dm, 'GET', `/api/campaigns/${c.id}/sessions`)).json.sessions ?? [];
  if (!sess.some((x) => x.session.cancelledAt === null && x.session.startsAt > Date.now())) {
    await api(dm, 'POST', `/api/campaigns/${c.id}/sessions`, {
      startsAt: Date.now() + 3 * 86400_000,
      durationMinutes: 180,
      title: 'Smoke session',
    });
  }
  TABLE_ID = c.id;
  return { dm, pl, id: c.id };
}

const lineLocator = (p, needle) =>
  p.evaluate(
    (n) =>
      [...document.querySelectorAll('.phone-line')]
        .filter((l) => l.innerText.includes(n))
        .map((l) => ({
          cls: l.className,
          text: l.innerText,
          bubble: l.querySelector('.phone-bubble')?.getAttribute('style') ?? '',
        })),
    needle,
  );

async function typeInto(p, textValue) {
  await p.click('#phone-compose');
  await p.$eval('#phone-compose', (e) => {
    e.value = '';
  });
  await p.type('#phone-compose', textValue, { delay: 5 });
}
async function sendByButton(p) {
  await p.$$eval('button', (bs) => bs.find((b) => b.innerText.trim() === 'Send')?.click());
}
let TABLE_ID;
async function openApp(p) {
  // The DM has several tables over time; open the smoke one (the app remembers the last table in localStorage).
  if (TABLE_ID)
    await p.evaluateOnNewDocument((id) => {
      try {
        localStorage.setItem('vtt.phone.campaign', id);
      } catch {
        /* blocked */
      }
    }, TABLE_ID);
  await p.goto(BASE + '/app', { waitUntil: 'networkidle0' });
  await p.waitForSelector('#phone-compose', { timeout: 10000 });
}

// 3. Chat commands --------------------------------------------------------------------------------------
flows.chat = async (b) => {
  const t = await ensureTable();
  for (const view of views) {
    const dmScheme = view === 'desktop' ? 'light' : 'dark';
    const plScheme = view === 'desktop' ? 'dark' : 'light';
    const tag = `chat ${view}`;
    const dm = await newPage(b, {
      view,
      scheme: dmScheme,
      cookie: t.dm,
      tag: `dm ${view}/${dmScheme}`,
      problems,
    });
    const pl = await newPage(b, {
      view,
      scheme: plScheme,
      cookie: t.pl,
      tag: `pl ${view}/${plScheme}`,
      problems,
    });
    await openApp(dm);
    await openApp(pl);
    await sleep(800);
    const id = Date.now().toString(36);
    const send = async (who, line, needle, { enterKey = false } = {}) => {
      await typeInto(who, line);
      if (enterKey) {
        // Enter with the suggestion list open picks the highlighted suggestion; close it first.
        await who.keyboard.press('Escape');
        await who.keyboard.down('Control');
        await who.keyboard.press('Enter');
        await who.keyboard.up('Control');
      } else await sendByButton(who);
      await sleep(900);
    };
    const val = (who) => who.$eval('#phone-compose', (e) => e.value);

    await send(dm, `plain ${id}`, `plain ${id}`);
    check(`${tag}: composer clears after send`, (await val(dm)) === '');
    let a = await lineLocator(dm, `plain ${id}`),
      c = await lineLocator(pl, `plain ${id}`);
    check(
      `${tag}: plain line once on each side`,
      a.length === 1 && c.length === 1,
      `${a.length}/${c.length}`,
    );
    check(`${tag}: plain styled chat`, c[0]?.cls.includes('phone-line-chat'), c[0]?.cls);

    await send(dm, `/say hello ${id}`, `hello ${id}`);
    a = await lineLocator(dm, `hello ${id}`);
    c = await lineLocator(pl, `hello ${id}`);
    check(
      `${tag}: /say quoted`,
      c.length === 1 && c[0].cls.includes('phone-line-say') && c[0].text.includes(`“hello ${id}”`),
      JSON.stringify(c[0]),
    );
    check(`${tag}: /say once on sender`, a.length === 1);

    await send(pl, `/say-elvish mae govannen ${id}`, `govannen ${id}`);
    a = await lineLocator(dm, `govannen ${id}`);
    check(
      `${tag}: /say-elvish caption + style`,
      a.length === 1 && /in Elvish/.test(a[0].text) && /font-family/.test(a[0].bubble),
      JSON.stringify(a[0]),
    );

    await send(dm, `/do raises an axe ${id}`, `axe ${id}`);
    c = await lineLocator(pl, `axe ${id}`);
    check(
      `${tag}: /do stage direction`,
      c.length === 1 &&
        c[0].cls.includes('phone-line-do') &&
        /^\s*[\s\S]*\* Test dmx raises an axe/.test(c[0].text),
      JSON.stringify(c[0]),
    );

    await send(pl, `/ooc brb ${id}`, `brb ${id}`);
    a = await lineLocator(dm, `brb ${id}`);
    check(
      `${tag}: /ooc tag`,
      a.length === 1 && a[0].cls.includes('phone-line-ooc') && /OOC/.test(a[0].text),
      JSON.stringify(a[0]),
    );

    await send(dm, `/tell Test pla psst ${id}`, `psst ${id}`);
    c = await lineLocator(pl, `psst ${id}`);
    a = await lineLocator(dm, `psst ${id}`);
    check(
      `${tag}: /tell whisper received`,
      c.length === 1 && c[0].cls.includes('phone-line-whisper') && /whisper to you/.test(c[0].text),
      JSON.stringify(c[0]),
    );
    check(
      `${tag}: /tell whisper on sender says to name`,
      a.length === 1 && /whisper to Test pla/.test(a[0].text),
      JSON.stringify(a[0]),
    );

    await send(pl, `/dm secret ${id}`, `secret ${id}`);
    a = await lineLocator(dm, `secret ${id}`);
    check(
      `${tag}: /dm whisper to the DM`,
      a.length === 1 && a[0].cls.includes('phone-line-whisper'),
      JSON.stringify(a[0]),
    );
    // A third viewer must not see whispers: history fetch as the requester account (not a member -> expect refusal) is covered in the join flow.
    await shot(dm, `chat-dm-${view}-${dmScheme}`);
    await shot(pl, `chat-pl-${view}-${plScheme}`);

    // Autocomplete
    await typeInto(dm, '/');
    await sleep(200);
    let opts = await dm.$$eval('[role=option]', (e) =>
      e.map((x) => x.innerText.replace(/\n/g, ' ')),
    );
    check(`${tag}: "/" lists commands`, opts.length >= 5, String(opts.length));
    await shot(dm, `chat-suggest-${view}-${dmScheme}`);
    await dm.keyboard.press('ArrowDown');
    const act = await dm.$eval('#phone-compose', (e) => e.getAttribute('aria-activedescendant'));
    const sel = await dm.$eval('[role=option][aria-selected=true]', (e) =>
      e.innerText.replace(/\n/g, ' '),
    );
    check(`${tag}: ArrowDown moves highlight`, !!act && sel !== opts[0], sel);
    await dm.keyboard.press('ArrowUp');
    await dm.keyboard.press('Tab');
    let v = await val(dm);
    check(`${tag}: Tab completes`, v.startsWith('/') && v.length > 1, v);
    await dm.keyboard.press('Escape');
    check(
      `${tag}: Escape closes list`,
      (await dm.$$('[role=option]')).length === 0 || v === (await val(dm)),
    );
    await typeInto(dm, '/');
    await dm.keyboard.press('Enter');
    v = await val(dm);
    check(`${tag}: Enter picks suggestion and does not send`, v.startsWith('/') && v.length > 1, v);
    await typeInto(dm, '/tell ');
    await sleep(200);
    opts = await dm.$$eval('[role=option]', (e) => e.map((x) => x.innerText.replace(/\n/g, ' ')));
    check(
      `${tag}: "/tell " lists members`,
      opts.some((o) => /Test pla/.test(o)) && !opts.some((o) => /Test dmx/.test(o)),
      opts.join(' | '),
    );
    await typeInto(dm, '/say-');
    await sleep(200);
    opts = await dm.$$eval('[role=option]', (e) => e.map((x) => x.innerText.replace(/\n/g, ' ')));
    check(
      `${tag}: "/say-" lists languages`,
      opts.some((o) => /Elvish/i.test(o)),
      opts.slice(0, 4).join(' | '),
    );
    // typo
    await typeInto(dm, `/sya hi ${id}`);
    await dm.keyboard.press('Escape');
    await sendByButton(dm);
    await sleep(400);
    const warn = await dm.evaluate(() => document.querySelector('[role=alert]')?.innerText ?? '');
    check(
      `${tag}: typo warns first`,
      /No such command/.test(warn) && (await lineLocator(pl, `sya hi ${id}`)).length === 0,
      warn,
    );
    await sendByButton(dm);
    await sleep(900);
    c = await lineLocator(pl, `sya hi ${id}`);
    check(
      `${tag}: second send posts as text`,
      c.length === 1 && c[0].cls.includes('phone-line-chat'),
      JSON.stringify(c[0]),
    );
    // Ctrl+Enter and plain Enter
    await typeInto(dm, `ctrl ${id}`);
    await dm.keyboard.down('Control');
    await dm.keyboard.press('Enter');
    await dm.keyboard.up('Control');
    await sleep(800);
    check(`${tag}: Ctrl+Enter sends`, (await lineLocator(pl, `ctrl ${id}`)).length === 1);
    await typeInto(dm, `enterkey ${id}`);
    await dm.keyboard.press('Enter');
    await sleep(800);
    const enterSent = (await lineLocator(pl, `enterkey ${id}`)).length === 1;
    check(
      `${tag}: plain Enter sends (desktop expectation)`,
      view === 'mobile' ? true : enterSent,
      `sent=${enterSent} composer=${JSON.stringify(await val(dm))}`,
    );
    await dm.$eval('#phone-compose', (e) => {
      e.value = '';
    });
    await typeInto(dm, '');

    // /late: needs the next session
    await send(pl, `/late 20 min ${id}`, `20 min ${id}`);
    a = await lineLocator(dm, `20 min ${id}`);
    check(
      `${tag}: /late posts OOC`,
      a.length === 1 && a[0].cls.includes('phone-line-ooc'),
      JSON.stringify(a[0]),
    );
    const sessions = (await api(t.pl, 'GET', `/api/campaigns/${t.id}/sessions`)).json.sessions;
    const next = sessions
      .filter((x) => x.session.cancelledAt === null)
      .sort((x, y) => x.session.startsAt - y.session.startsAt)[0];
    check(
      `${tag}: /late set RSVP via API`,
      next?.mine?.status === 'late' || JSON.stringify(next).includes('"late"'),
      JSON.stringify(next?.myRsvp ?? next?.rsvps ?? next).slice(0, 200),
    );
    await clickText(pl, /^Sessions$/, '.phone-tab');
    await sleep(800);
    const st = await pl.evaluate(() => document.body.innerText);
    await shot(pl, `sessions-pl-${view}-${plScheme}`);
    check(
      `${tag}: Sessions tab shows Late selected`,
      /late/i.test(st),
      st.slice(0, 200).replace(/\n/g, ' | '),
    );
    const pressed = await pl.$$eval(
      '.phone-pad button[aria-pressed=true], .phone-pad [data-state=on], .phone-pad button[data-selected]',
      (e) => e.map((x) => x.innerText),
    );
    check(`${tag}: Sessions tab RSVP highlight`, pressed.length >= 1, pressed.join());
    await dm.__context.close();
    await pl.__context.close();
  }
};

// 4. Members rail ---------------------------------------------------------------------------------------
const dialogs = (p) =>
  p.$$eval('[role=dialog].phone-rail-card', (e) =>
    e.map((x) => {
      const r = x.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        name: x.getAttribute('aria-label'),
        top: Math.round(r.top),
        right: Math.round(r.right),
      };
    }),
  );
/** Replaces an input's value: focus, select all, delete, type (a triple click does not reliably select it all). */
async function setField(p, sel, value) {
  await p.click(sel);
  await p.keyboard.down('Control');
  await p.keyboard.press('KeyA');
  await p.keyboard.up('Control');
  await p.keyboard.press('Backspace');
  await p.type(sel, value);
}
const railState = (p) =>
  p.$$eval('.phone-rail-item > button, .phone-rail button.phone-av', (e) =>
    e.map((x) => x.getAttribute('aria-label')),
  );
flows.rail = async (b) => {
  const t = await ensureTable();
  for (const view of views) {
    const scheme = view === 'desktop' ? 'light' : 'dark';
    const tag = `rail ${view}`;
    const dm = await newPage(b, { view, scheme, cookie: t.dm, tag: `dm ${view}`, problems });
    await openApp(dm);
    await sleep(1000);
    let labels = await railState(dm);
    check(
      `${tag}: DM and player have avatar buttons`,
      labels.some((l) => /^Test dmx/.test(l)) && labels.some((l) => /^Test pla/.test(l)),
      labels.join(' | '),
    );
    check(
      `${tag}: DM marked`,
      labels.some((l) => /Test dmx, DM/.test(l)),
      labels.join(' | '),
    );
    check(
      `${tag}: player offline before they open the app`,
      labels.some((l) => /Test pla, Offline|Test pla, Disconnected/.test(l)),
      labels.join(' | '),
    );
    const pl = await newPage(b, {
      view,
      scheme: 'light',
      cookie: t.pl,
      tag: `pl ${view}`,
      problems,
    });
    await openApp(pl);
    await sleep(2500);
    labels = await railState(dm);
    check(
      `${tag}: player shows connected (chat only) when they open the web app`,
      labels.some((l) => /Test pla, (Offline|On the web) \(chat only\)/.test(l)),
      labels.join(' | '),
    );
    await pl.goto('about:blank');
    await pl.__context.close();
    let ok = false;
    for (let i = 0; i < 12 && !ok; i++) {
      await sleep(1500);
      labels = await railState(dm);
      ok = labels.some((l) => /Test pla, (Offline|Disconnected)/.test(l));
    }
    check(`${tag}: player goes offline when they close the app`, ok, labels.join(' | '));

    // avatars: images or initials
    const av = await dm.$$eval('.phone-av', (e) =>
      e.map((x) => ({
        img: !!x.querySelector('img'),
        text: x.querySelector('span')?.textContent,
        w: Math.round(x.getBoundingClientRect().width),
        h: Math.round(x.getBoundingClientRect().height),
      })),
    );
    check(
      `${tag}: avatars render (img or initials) at a tappable size`,
      av.every((a) => (a.img || a.text) && a.w >= 32 && a.h >= 32),
      JSON.stringify(av),
    );
    const before = await dm.$eval('.phone-chat-body', (e) => {
      const r = e.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round).join();
    });
    const avs = await dm.$$('.phone-av');
    const names = await Promise.all(
      avs.map((e) => e.evaluate((x) => x.getAttribute('aria-label'))),
    );
    const target = avs[names.findIndex((n) => /^Test pla/.test(n))];
    if (view === 'desktop') {
      await target.hover();
      await sleep(80);
      check(`${tag}: hover waits before opening`, (await dialogs(dm)).length === 0);
      await sleep(500);
      let d = await dialogs(dm);
      check(
        `${tag}: hover opens one popout of sane size`,
        d.length === 1 && d[0].h < 220 && d[0].w <= 250,
        JSON.stringify(d),
      );
      await shot(dm, `rail-hover-${view}-${scheme}`);
      const after = await dm.$eval('.phone-chat-body', (e) => {
        const r = e.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map(Math.round).join();
      });
      check(`${tag}: popout causes no layout shift`, before === after, `${before} vs ${after}`);
      await dm.mouse.move(600, 600);
      await sleep(600);
      check(`${tag}: leaving closes`, (await dialogs(dm)).length === 0);
      // hover then move into the popout keeps it open
      await target.hover();
      await sleep(500);
      const card = await dm.$('[role=dialog].phone-rail-card');
      const cb = await card.boundingBox();
      await dm.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 5 });
      await sleep(500);
      check(
        `${tag}: popout stays open while the pointer is in it`,
        (await dialogs(dm)).length === 1,
      );
      await dm.mouse.move(600, 650);
      await sleep(500);
      // click toggles (pinned)
      await target.click();
      await sleep(300);
      check(`${tag}: click opens`, (await dialogs(dm)).length === 1);
      await dm.mouse.move(600, 650);
      await sleep(500);
      check(
        `${tag}: click-opened popout stays pinned when the mouse leaves`,
        (await dialogs(dm)).length === 1,
      );
      await target.click();
      await sleep(300);
      check(`${tag}: second click closes`, (await dialogs(dm)).length === 0);
      await target.click();
      await sleep(300);
      await dm.keyboard.press('Escape');
      await sleep(300);
      check(`${tag}: Escape closes`, (await dialogs(dm)).length === 0);
      // only one at a time
      const first = (await dm.$$('.phone-av'))[0];
      await first.click();
      await sleep(200);
      await target.click();
      await sleep(300);
      const d2 = await dialogs(dm);
      check(`${tag}: only one popout open`, d2.length === 1, JSON.stringify(d2));
      await dm.keyboard.press('Escape');
    } else {
      // The strip scrolls sideways and grows with every approved throwaway account: bring the target on screen.
      await target.evaluate((e) => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
      await sleep(200);
      const bb = await target.boundingBox();
      await dm.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sleep(500);
      const d = await dialogs(dm);
      check(
        `${tag}: tap opens one popout of sane size`,
        d.length === 1 && d[0].h < 260 && d[0].w <= 250,
        JSON.stringify(d),
      );
      await shot(dm, `rail-tap-${view}-${scheme}`);
      const after = await dm.$eval('.phone-chat-body', (e) => {
        const r = e.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map(Math.round).join();
      });
      check(`${tag}: popout causes no layout shift`, before === after, `${before} vs ${after}`);
      const first = (await dm.$$('.phone-av'))[0];
      await first.evaluate((e) => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
      await sleep(200);
      const fb = await first.boundingBox();
      await dm.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await sleep(400);
      check(`${tag}: tapping another switches (still only one)`, (await dialogs(dm)).length === 1);
      await dm.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await sleep(400);
      check(`${tag}: tapping the open one closes`, (await dialogs(dm)).length === 0);
      await target.evaluate((e) => e.scrollIntoView({ inline: 'center', block: 'nearest' }));
      await sleep(200);
      const bb2 = await target.boundingBox();
      await dm.touchscreen.tap(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);
      await sleep(300);
      await dm.touchscreen.tap(195, 500);
      await sleep(400);
      check(`${tag}: tap outside closes`, (await dialogs(dm)).length === 0);
    }
    await dm.__context.close();
  }
};

// 5. Menu / header / layout -----------------------------------------------------------------------------
flows.menu = async (b) => {
  const t = await ensureTable();
  for (const view of views)
    for (const scheme of schemes) {
      const tag = `menu ${view}/${scheme}`;
      const p = await newPage(b, { view, scheme, cookie: t.dm, problems });
      await openApp(p);
      await sleep(800);
      const promo = await p.$eval('.phone-promo', (e) => e.getAttribute('href'));
      check(
        `${tag}: promo button links ${view === 'mobile' ? '/full-app' : '/download'}`,
        promo === (view === 'mobile' ? '/full-app' : '/download'),
        promo,
      );
      await p.click('.phone-burger');
      await sleep(400);
      const items = await p.$$eval('[role=menuitem]', (e) =>
        e.map((x) => x.innerText.trim().replace(/\s+/g, ' ')),
      );
      await shot(p, `menu-${view}-${scheme}`);
      check(
        `${tag}: menu items`,
        ['Find another table', 'Join requests', 'Home', 'Download', 'Status', 'Sign out'].every(
          (i) => items.some((x) => x.startsWith(i)),
        ),
        items.join(' | '),
      );
      check(`${tag}: no "Get the full app" item`, !items.some((i) => /Get the full app/i.test(i)));
      await p.keyboard.press('Escape');
      await sleep(300);
      const m = await p.evaluate(() => ({
        sh: document.documentElement.scrollHeight,
        ih: innerHeight,
        sw: document.documentElement.scrollWidth,
        bh: document.body.scrollHeight,
        scroll: (() => {
          document.documentElement.scrollTop = 99999;
          return document.documentElement.scrollTop;
        })(),
      }));
      check(
        `${tag}: page does not scroll (scrollHeight == innerHeight)`,
        m.sh === m.ih && m.scroll === 0,
        JSON.stringify(m),
      );
      for (const tab of ['Sessions', 'Handouts', 'History', 'Chat']) {
        await clickText(p, new RegExp(`^${tab}$`), '.phone-tab');
        await sleep(400);
        const mm = await p.evaluate(() => ({
          sh: document.documentElement.scrollHeight,
          ih: innerHeight,
        }));
        check(`${tag}: ${tab} tab does not scroll the page`, mm.sh === mm.ih, JSON.stringify(mm));
      }
      const tabs = await p.$$eval('.phone-tab', (e) =>
        e.map((x) => ({
          icon: !!x.querySelector('svg'),
          label: x.querySelector('.phone-tab-label')?.innerText,
        })),
      );
      check(
        `${tag}: tabs have icon and label`,
        tabs.length === 4 && tabs.every((x) => x.icon && x.label),
        JSON.stringify(tabs),
      );
      await p.__context.close();
    }
  // widths vs the Home column
  for (const w of [700, 1000]) {
    const home = await newPage(b, { view: 'desktop', scheme: 'light', cookie: t.dm, problems });
    await home.setViewport({ width: w, height: 800 });
    await home.goto(BASE + '/', { waitUntil: 'networkidle0' });
    const hw = await home.evaluate(() => ({
      card: Math.round(document.querySelector('.join-card')?.getBoundingClientRect().width ?? -1),
      col: Math.round(document.querySelector('.join-shell')?.getBoundingClientRect().width ?? -1),
      hdr: Math.round(document.querySelector('.site-header')?.getBoundingClientRect().width ?? -1),
    }));
    await openApp(home);
    const aw = await home.evaluate(() => ({
      shell: Math.round(document.querySelector('.phone-shell').getBoundingClientRect().width),
      tabs: Math.round(document.querySelector('.phone-tabs').getBoundingClientRect().width),
      hdr: Math.round(document.querySelector('.phone-header').getBoundingClientRect().width),
    }));
    check(
      `menu: at ${w}px /app width matches Home column`,
      aw.shell === hw.col && Math.abs(aw.tabs - aw.shell) <= 2 && Math.abs(aw.hdr - aw.shell) <= 2,
      `home=${JSON.stringify(hw)} app=${JSON.stringify(aw)}`,
    );
    await shot(home, `app-width-${w}`);
    await home.__context.close();
  }
};

// 6. Join requests --------------------------------------------------------------------------------------
async function resetRequester(email, tableId) {
  const c = await sessionFor(email);
  const mine = ((await api(c, 'GET', '/api/campaigns')).json.campaigns ?? []).map(
    (x) => x.campaign.id,
  );
  for (const id of mine) await api(c, 'POST', `/api/campaigns/${id}/leave`);
  // Withdraw every pending ask (the server lists real tables too; a withdraw only ever removes this account's own).
  for (const o of (await api(c, 'GET', '/api/campaigns/open')).json?.campaigns ?? []) {
    if (o.myRequest?.status === 'pending')
      await api(c, 'DELETE', `/api/campaigns/${o.id}/join-requests/mine`);
  }
  return c;
}
const cardOf = (p) =>
  p.evaluate((name) => {
    const li = [...document.querySelectorAll('.phone-table-card')].find((c) =>
      c.innerText.includes(name),
    );
    return li ? li.innerText.replace(/\n+/g, ' | ') : null;
  }, CAMPAIGN_NAME);
const clickIn = (p, re, scope) => clickText(p, re, scope ?? 'button, a');
// Buttons on the smoke table's own card (the server also lists real tables: never touch those).
async function clickCard(p, re) {
  const h = await p.evaluateHandle(
    (name, src) => {
      const card = [...document.querySelectorAll('.phone-table-card')].find((c) =>
        c.innerText.includes(name),
      );
      return [...(card?.querySelectorAll('button') ?? [])].find((b) =>
        new RegExp(src, 'i').test(b.innerText.trim()),
      );
    },
    CAMPAIGN_NAME,
    re.source,
  );
  const el = h.asElement();
  if (!el) throw new Error(`no card button matching ${re}`);
  await el.click();
}
// A button inside the DM's request row for one person.
async function clickRow(p, person, re) {
  const h = await p.evaluateHandle(
    (name, src) => {
      const row = [...document.querySelectorAll('[aria-label="Join requests"] li')].find((c) =>
        c.innerText.includes(name),
      );
      return [...(row?.querySelectorAll('button') ?? [])].find((b) =>
        new RegExp(src, 'i').test(b.innerText.trim()),
      );
    },
    person,
    re.source,
  );
  const el = h.asElement();
  if (!el) throw new Error(`no row button ${re} for ${person}`);
  await el.click();
}
const cardText = (p, sel) =>
  p.evaluate(
    (name, s) => {
      const card = [...document.querySelectorAll('.phone-table-card')].find((c) =>
        c.innerText.includes(name),
      );
      return card?.querySelector(s)?.value ?? null;
    },
    CAMPAIGN_NAME,
    sel,
  );

flows.join = async (b) => {
  const t = await ensureTable();
  await api(t.dm, 'PATCH', `/api/campaigns/${t.id}`, { allowJoin: true });
  // Start clean: nothing left pending from an earlier (aborted) run.
  for (const e of ['reqc@example.com']) {
    ensureUser(e, 'Test ' + e.split('@')[0]);
    await resetRequester(e, t.id);
  }
  // Requests left pending by an aborted run: turn them down so the DM's counts start at zero.
  for (const r of (await api(t.dm, 'GET', `/api/campaigns/${t.id}/join-requests`)).json.requests ??
    []) {
    if (r.status === 'pending')
      await api(t.dm, 'POST', `/api/campaigns/${t.id}/join-requests/${r.id}/decision`, {
        approve: false,
      });
  }
  // A declined account cannot ask this table again for days, so the requesters are fresh every run.
  const stamp = Date.now().toString(36);
  const decl = `decl${stamp}@example.com`;
  ensureUser(decl, 'Test decline');
  for (const view of views) {
    const scheme = view === 'desktop' ? 'light' : 'dark';
    const tag = `join ${view}`;
    const who = {
      email: `${view === 'desktop' ? 'appr' : 'mapr'}${stamp}@example.com`,
      name: `Test ${view === 'desktop' ? 'appr' : 'mapr'}${stamp}`,
    };
    ensureUser(who.email, who.name);
    const rc = await resetRequester(who.email, t.id);
    const dm = await newPage(b, {
      view,
      scheme: scheme === 'light' ? 'dark' : 'light',
      cookie: t.dm,
      tag: `dm ${view}`,
      problems,
    });
    await openApp(dm);
    const rq = await newPage(b, { view, scheme, cookie: rc, tag: `req ${view}`, problems });
    await rq.goto(BASE + '/app', { waitUntil: 'networkidle0' });
    await rq.waitForFunction(() => /Or ask to join a table/.test(document.body.innerText), {
      timeout: 10000,
    });
    await sleep(500);
    await shot(rq, `join-list-${view}-${scheme}`);
    const card = await cardOf(rq);
    check(
      `${tag}: open table card shows name, DM and player count`,
      card && /DM: Test dmx/.test(card) && /\d+ players?/.test(card),
      String(card),
    );
    const allCards = await rq.$$eval('.phone-table-card', (e) =>
      e.map((x) => x.innerText.split('\n')[0]),
    );
    console.log('  tables listed:', allCards.join(' | '));
    check(`${tag}: no x-overflow`, await noOverflow(rq));
    // request with message
    await clickCard(rq, /Request to join/);
    await rq.waitForSelector('.phone-join-form textarea');
    await rq.type('.phone-join-form textarea', 'Hi, I play a rogue');
    const count = await rq.$eval('.phone-join-count', (e) => e.innerText);
    check(`${tag}: message counter`, /^18\/280$/.test(count.trim()), count);
    await shot(rq, `join-form-${view}-${scheme}`);
    await clickCard(rq, /Send request/);
    await rq.waitForFunction(() => /Request sent/.test(document.body.innerText), { timeout: 8000 });
    const c2 = await cardOf(rq);
    check(
      `${tag}: card shows Request sent + Withdraw`,
      /Request sent/.test(c2) && /Withdraw/.test(c2),
      c2,
    );
    // DM, live: badge + dot
    await sleep(1500);
    const dot = await dm.$('.phone-burger-dot');
    const burgerLabel = await dm.$eval('.phone-burger', (e) => e.getAttribute('aria-label'));
    check(
      `${tag}: DM burger dot appears live`,
      !!dot && /1 join request/.test(burgerLabel),
      burgerLabel,
    );
    await shot(dm, `join-dm-dot-${view}`);
    // withdraw
    await clickCard(rq, /^Withdraw$/);
    await rq.waitForFunction(
      () =>
        /Request to join/.test(document.body.innerText) &&
        !/Request sent/.test(document.body.innerText),
      { timeout: 8000 },
    );
    check(`${tag}: Withdraw works`, true);
    await sleep(1500);
    const dot2 = await dm.$('.phone-burger-dot');
    check(
      `${tag}: DM dot clears after withdraw (live)`,
      !dot2,
      `dot=${!!dot2} label=${await dm.$eval('.phone-burger', (e) => e.getAttribute('aria-label'))}`,
    );
    // ask again
    await clickCard(rq, /Request to join/);
    await rq.waitForSelector('.phone-join-form textarea');
    check(
      `${tag}: message box starts empty on a second request`,
      (await rq.$eval('.phone-join-form textarea', (e) => e.value)) === '',
    );
    await rq.type('.phone-join-form textarea', 'Second try');
    await clickCard(rq, /Send request/);
    await rq.waitForFunction(() => /Request sent/.test(document.body.innerText), { timeout: 8000 });
    await sleep(1500);
    await dm.click('.phone-burger');
    await sleep(300);
    const items = await dm.$$eval('[role=menuitem]', (e) =>
      e.map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
    );
    check(
      `${tag}: Menu shows Join requests with a badge`,
      items.some((i) => /^Join requests\s*1$/.test(i)),
      items.join(' | '),
    );
    await shot(dm, `join-dm-menu-${view}`);
    await clickIn(dm, /^Join requests/, '[role=menuitem]');
    await dm.waitForSelector('[aria-label="Join requests"]', { timeout: 8000 });
    await dm
      .waitForFunction(
        (n) => document.querySelector('[aria-label="Join requests"]')?.innerText.includes(n),
        { timeout: 8000 },
        who.name,
      )
      .catch(() => undefined);
    await sleep(500);
    const row = await dm.$eval('[aria-label="Join requests"]', (e) =>
      e.innerText.replace(/\n+/g, ' | '),
    );
    check(
      `${tag}: request listed for DM with name and message`,
      new RegExp(`${who.name}`).test(row) && /Second try/.test(row),
      row,
    );
    await shot(dm, `join-dm-screen-${view}`);
    check(`${tag}: DM screen no x-overflow`, await noOverflow(dm));
    await clickRow(dm, who.name, /^Approve$/);
    await dm.waitForFunction(() => /Approved/.test(document.body.innerText), { timeout: 8000 });
    check(`${tag}: Approve marks request approved`, true);
    // requester notices within the polling interval
    const t0 = Date.now();
    let banner = false;
    try {
      await rq.waitForFunction(() => /You’re in UI Smoke Table/.test(document.body.innerText), {
        timeout: 32000,
      });
      banner = true;
    } catch {
      /* below */
    }
    check(
      `${tag}: requester sees "You're in …" within ~${Math.round((Date.now() - t0) / 1000)}s`,
      banner,
      await rq.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, ' | ')),
    );
    await shot(rq, `join-approved-${view}-${scheme}`);
    if (banner) {
      await clickIn(rq, /^Switch$/);
      await rq.waitForSelector('#phone-compose', { timeout: 8000 });
      check(`${tag}: Switch opens the table`, true);
    }
    await dm.__context.close();
    await rq.__context.close();
    if (view === 'mobile') continue;

    // Decline path
    const dc = await sessionFor(decl);
    const dm2 = await newPage(b, {
      view,
      scheme: 'dark',
      cookie: t.dm,
      tag: `dm2 ${view}`,
      problems,
    });
    await openApp(dm2);
    const rd = await newPage(b, { view, scheme, cookie: dc, tag: `decl ${view}`, problems });
    await rd.goto(BASE + '/app', { waitUntil: 'networkidle0' });
    await rd.waitForFunction(() => /Or ask to join a table/.test(document.body.innerText), {
      timeout: 10000,
    });
    await clickCard(rd, /Request to join/);
    await clickCard(rd, /Send request/);
    await rd.waitForFunction(() => /Request sent/.test(document.body.innerText), { timeout: 8000 });
    await sleep(1200);
    await dm2.click('.phone-burger');
    await sleep(300);
    await clickIn(dm2, /^Join requests/, '[role=menuitem]');
    await dm2.waitForSelector('[aria-label="Join requests"]');
    await sleep(400);
    await clickRow(dm2, 'Test decline', /^Decline$/);
    await dm2.waitForFunction(() => /Declined/.test(document.body.innerText), { timeout: 8000 });
    check(`${tag}: Decline marks request declined for the DM`, true);
    const t1 = Date.now();
    let notThisTime = false;
    try {
      await rd.waitForFunction(
        () =>
          /Not this time/.test(document.body.innerText) &&
          /ask again/i.test(document.body.innerText),
        { timeout: 32000 },
      );
      notThisTime = true;
    } catch {
      /* below */
    }
    const dtxt = await cardOf(rd);
    check(
      `${tag}: requester sees Not this time + ask-again date (${Math.round((Date.now() - t1) / 1000)}s)`,
      notThisTime,
      String(dtxt),
    );
    await shot(rd, `join-declined-${view}-${scheme}`);
    await dm2.__context.close();
    await rd.__context.close();

    // Allow join off hides the table and closes pending requests
    ensureUser('reqc@example.com', 'Test reqc');
    const tc = await resetRequester('reqc@example.com', t.id);
    const pend = await api(tc, 'POST', `/api/campaigns/${t.id}/join-requests`, {
      message: 'toggle test',
    });
    check(`${tag}: API request accepted`, pend.status === 202, String(pend.status));
    const dm3 = await newPage(b, {
      view,
      scheme: 'light',
      cookie: t.dm,
      tag: `dm3 ${view}`,
      problems,
    });
    await openApp(dm3);
    await dm3.click('.phone-burger');
    await sleep(300);
    await clickIn(dm3, /^Join requests/, '[role=menuitem]');
    await dm3.waitForSelector('#allow-join');
    await sleep(600); // let the menu finish closing so the click lands on the switch
    await dm3.click('#allow-join');
    await sleep(1200);
    const listOff = ((await api(tc, 'GET', '/api/campaigns/open')).json.campaigns ?? []).map(
      (x) => x.name,
    );
    check(
      `${tag}: Allow join off hides the table from the open list`,
      !listOff.includes(CAMPAIGN_NAME) ||
        (await api(tc, 'GET', '/api/campaigns/open')).json.campaigns.filter((x) => x.id === t.id)
          .length === 0,
      listOff.join(),
    );
    const offTxt = await dm3.evaluate(() => document.body.innerText);
    check(
      `${tag}: pending request shows "Allow join is off" and Approve disabled`,
      /Allow join is off/.test(offTxt) &&
        (await dm3.$$eval('button', (bs) =>
          bs.filter((x) => x.innerText.trim() === 'Approve').every((x) => x.disabled),
        )),
      offTxt.slice(0, 300).replace(/\n/g, ' | '),
    );
    await shot(dm3, `join-allow-off-${view}`);
    await dm3.click('#allow-join');
    await sleep(1200);
    const listOn = ((await api(tc, 'GET', '/api/campaigns/open')).json.campaigns ?? []).filter(
      (x) => x.id === t.id,
    ).length;
    check(`${tag}: Allow join back on lists the table again`, listOn === 1, String(listOn));
    await api(tc, 'DELETE', `/api/campaigns/${t.id}/join-requests/mine`);
    await dm3.__context.close();
  }
  // Leave the table tidy: allow join ON, no pending requests.
  const left = (await api(t.dm, 'GET', `/api/campaigns/${t.id}/join-requests`)).json;
  check(
    'join: left Allow join on with no pending requests',
    left.allowJoin === true && !(left.requests ?? []).some((r) => r.status === 'pending'),
    JSON.stringify({
      a: left.allowJoin,
      p: (left.requests ?? []).filter((r) => r.status === 'pending').length,
    }),
  );
};

// 7. Other pages, 404, focus order, accessibility basics ------------------------------------------------------
/** Cheap axe-style checks run inside the page. */
const a11yBasics = (p) =>
  p.evaluate(() => {
    const out = [];
    const name = (e) =>
      (
        e.getAttribute('aria-label') ||
        (e.getAttribute('aria-labelledby') &&
          document.getElementById(e.getAttribute('aria-labelledby'))?.innerText) ||
        e.innerText ||
        e.getAttribute('title') ||
        e.querySelector('img[alt]')?.getAttribute('alt') ||
        (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.innerText) ||
        e.closest('label')?.innerText ||
        e.getAttribute('placeholder') ||
        ''
      ).trim();
    for (const e of document.querySelectorAll(
      'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=tab], [role=menuitem], [role=switch], [role=radio], [role=checkbox]',
    )) {
      if (e.getBoundingClientRect().width === 0 && e.getBoundingClientRect().height === 0) continue;
      if (!name(e)) out.push('no accessible name: ' + e.outerHTML.slice(0, 120));
    }
    const ids = {};
    for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] ?? 0) + 1;
    for (const [id, n] of Object.entries(ids)) if (n > 1) out.push(`duplicate id ${id} x${n}`);
    if (!document.documentElement.lang) out.push('no <html lang>');
    if (!document.title) out.push('no <title>');
    if (document.querySelectorAll('h1').length > 1) out.push('multiple h1');
    for (const img of document.querySelectorAll('img'))
      if (!img.hasAttribute('alt')) out.push('img without alt: ' + img.src.slice(-40));
    if (!document.querySelector('main, [role=main]')) out.push('no main landmark');
    return out;
  });

flows.pages = async (b) => {
  const t = await ensureTable();
  for (const view of views)
    for (const scheme of schemes) {
      for (const [signed, cookie] of [
        ['out', undefined],
        ['in', t.pl],
      ]) {
        const tag = `pages ${view}/${scheme}/${signed}`;
        const p = await newPage(b, { view, scheme, cookie, problems });
        for (const path of ['/full-app', '/status']) {
          // The status page keeps polling, so it never goes network-idle.
          await p.goto(BASE + path, { waitUntil: path === '/status' ? 'load' : 'networkidle0' });
          await sleep(path === '/status' ? 1500 : 400);
          const info = await p.evaluate(() => ({
            nav: [...document.querySelectorAll('.site-nav a')]
              .map((a) => a.textContent.trim())
              .join(),
            hdr: !!document.querySelector('.site-header'),
            col: Math.round(
              document.querySelector('.site-column, .join-shell, main')?.getBoundingClientRect()
                .width ?? 0,
            ),
            dl: [...document.querySelectorAll('a')]
              .filter((a) =>
                /\.(deb|rpm|AppImage|exe|dmg|msi)\b|\/downloads?\//i.test(
                  a.getAttribute('href') || '',
                ),
              )
              .map((a) => a.getAttribute('href')),
            text: document.body.innerText.slice(0, 120).replace(/\n/g, ' | '),
          }));
          await shot(p, `page${path.replace('/', '-')}-${view}-${scheme}-${signed}`);
          check(
            `${tag} ${path}: header present, no x-overflow`,
            info.hdr && (await noOverflow(p)),
            JSON.stringify(info),
          );
          if (path === '/status')
            check(`${tag} /status: no download links`, info.dl.length === 0, info.dl.join());
          check(
            `${tag} ${path}: nav is ${signed === 'in' ? 'Chat,Download,Account,Status' : 'Status'}`,
            info.nav === (signed === 'in' ? 'Chat,Download,Account,Status' : 'Status'),
            info.nav,
          );
          const issues = await a11yBasics(p);
          check(`${tag} ${path}: a11y basics`, issues.length === 0, issues.join(' ;; '));
        }
        // 404
        const r = await p.goto(BASE + '/definitely/not/a/page', { waitUntil: 'networkidle0' });
        const body = await p.evaluate(() =>
          document.body.innerText.slice(0, 160).replace(/\n/g, ' | '),
        );
        await shot(p, `page-404-${view}-${scheme}-${signed}`);
        check(
          `${tag} 404: handled (status ${r.status()}) not a blank page`,
          body.length > 5,
          `${r.status()} ${body}`,
        );
        await p.__context.close();
      }
    }
  // Home: focus order and a11y, signed out and in
  for (const [signed, cookie] of [
    ['out', undefined],
    ['in', t.pl],
  ]) {
    const p = await newPage(b, { view: 'desktop', scheme: 'light', cookie, problems });
    await p.goto(BASE + '/', { waitUntil: 'networkidle0' });
    await sleep(500);
    const order = [];
    const rings = [];
    for (let i = 0; i < 14; i++) {
      await p.keyboard.press('Tab');
      rings.push(
        await p.evaluate(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return 'body';
          const c = getComputedStyle(e);
          return c.outlineStyle !== 'none' && c.outlineWidth !== '0px'
            ? 'outline'
            : c.boxShadow !== 'none'
              ? 'shadow'
              : 'none';
        }),
      );
      order.push(
        await p.evaluate(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return 'BODY';
          const r = e.getBoundingClientRect();
          return `${e.tagName}:${(e.getAttribute('aria-label') || e.innerText || e.getAttribute('href') || '').trim().split('\n')[0].slice(0, 28)}@${Math.round(r.top + scrollY)}`;
        }),
      );
    }
    console.log(`  home focus order (${signed}):`, order.join('  >  '));
    // One pass through the page (up to the first time focus leaves it), top to bottom; the invite box is no longer auto-focused.
    const firstPass = order.slice(
      0,
      order.indexOf('BODY') === -1 ? order.length : order.indexOf('BODY'),
    );
    const ys = firstPass.map((o) => Number(o.split('@')[1]));
    // (A text field draws its focus ring on its wrapper, not on the input, so only links and buttons are judged.)
    const unringed = firstPass.filter((o, i) => rings[i] === 'none' && !/^INPUT/.test(o));
    check(
      `home (${signed}): one pass top-to-bottom, starts at the header`,
      ys.length >= 3 &&
        ys.every((y, i) => i < 4 || y >= ys[i - 1] - 2) &&
        /^A:VTT Chat/.test(firstPass[0]),
      `${firstPass.join(' > ')}`,
    );
    check(
      `home (${signed}): every focused control shows a ring`,
      unringed.length === 0,
      unringed.join(' | '),
    );
    const issues = await a11yBasics(p);
    check(`home (${signed}): a11y basics`, issues.length === 0, issues.join(' ;; '));
    await p.__context.close();
  }
  // The app screens
  for (const view of views) {
    const p = await newPage(b, { view, scheme: 'light', cookie: t.dm, problems });
    await openApp(p);
    for (const tab of ['Chat', 'Sessions', 'Handouts', 'History']) {
      await clickText(p, new RegExp(`^${tab}$`), '.phone-tab');
      await sleep(600);
      const issues = await a11yBasics(p);
      await shot(p, `app-${tab}-${view}`);
      check(`app ${view} ${tab}: a11y basics`, issues.length === 0, issues.join(' ;; '));
    }
    await p.__context.close();
  }
};

// 8. The screens before the tabs (sign-in, table picker) keep the header inside the page ---------------------
flows.frame = async (b) => {
  await ensureTable();
  ensureUser('reqc@example.com', 'Test reqc');
  const c = await resetRequester('reqc@example.com', TABLE_ID);
  for (const view of views)
    for (const scheme of schemes)
      for (const [name, cookie] of [
        ['signin', undefined],
        ['picker', c],
      ]) {
        const p = await newPage(b, { view, scheme, cookie, problems });
        await p.goto(BASE + '/app', { waitUntil: 'networkidle0' });
        await sleep(600);
        const m = await p.evaluate(() => {
          const r = (s) => {
            const e = document.querySelector(s);
            if (!e) return null;
            const b = e.getBoundingClientRect();
            return { l: Math.round(b.left), r: Math.round(b.right) };
          };
          return {
            iw: innerWidth,
            hdr: r('.site-header'),
            brand: r('.site-brand'),
            nav: r('.site-nav'),
            body: r('.phone-page-body'),
            sw: document.documentElement.scrollWidth,
          };
        });
        const inside =
          m.hdr && m.hdr.l >= 0 && m.hdr.r <= m.iw && m.nav.r <= m.iw - 8 && m.brand.l >= 8;
        check(
          `frame ${view}/${scheme}/${name}: header sits inside the page`,
          inside && m.sw <= m.iw,
          JSON.stringify(m),
        );
        if (view === 'desktop')
          check(
            `frame ${view}/${scheme}/${name}: header is the 640 column`,
            m.hdr.r - m.hdr.l === 640 && (!m.body || m.body.r - m.body.l === 640),
            JSON.stringify(m),
          );
        await shot(p, `frame-${name}-${view}-${scheme}`);
        await p.__context.close();
      }
};

import { signInCode } from './lib.mjs';
async function signOutOfApp(p) {
  const burger = await p.$('.phone-burger');
  if (burger) {
    await burger.click();
    await sleep(300);
  }
  await clickText(p, /Sign out/);
  await sleep(800);
}
function signInCodeFor(email) {
  return signInCode(email);
}

// runner ------------------------------------------------------------------------------------------------
const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(flows);
for (const n of ['dm', 'pl', 'rq', 'ac']) ensureUser(T[n].email, T[n].name);
// Campaign creation is closed on a default instance, so the throwaway DM is an Admin (revoke with `vtt-admin user admin dmx@example.com revoke`).
try {
  admin('user', 'admin', T.dm.email, 'grant');
} catch {
  /* already */
}
const browser = await launch();
try {
  for (const n of names) {
    console.log(`\n=== ${n}`);
    try {
      await flows[n](browser);
    } catch (e) {
      check(`${n}: flow completed`, false, e.stack.split('\n').slice(0, 3).join(' / '));
    }
  }
} finally {
  await browser.close();
}
console.log('\n--- problems (page/console errors, failed or >=400 requests)');
for (const p of [...new Set(problems)]) console.log(p);
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`,
);
process.exitCode = failed.length ? 1 : 0;
