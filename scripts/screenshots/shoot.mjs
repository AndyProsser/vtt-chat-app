// Takes the documentation screenshots: the desktop panels (through the stand-in in desktop.mjs), the
// phone web app and the public pages (the real thing, served by the smoke stack), and the operator's
// console. Everyone at the seeded table is online while it runs.   node shoot.mjs [name ...]
// See README.md for what it needs. Output: docs/images/screens/<name>.png
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  BASE,
  CAMPAIGN,
  CAST,
  ROOT,
  admin,
  ok,
  openSocket,
  signInAll,
  sleep,
  sql,
} from './lib.mjs';
import { attach, feed, servePanels } from './desktop.mjs';
import { frameWindow, framePhone, terminal } from './frames.mjs';
import { SHOTS } from './shots.mjs';

const puppeteer = createRequire(import.meta.url)('puppeteer-core');
const OUT = process.env.OUT ?? join(ROOT, 'docs/images/screens');
mkdirSync(OUT, { recursive: true });

const { seats } = await signInAll();
const gm = seats.get('gm');
const campaignId = (await ok('GET', '/api/campaigns', gm.token)).campaigns.find(
  (c) => c.campaign.name === CAMPAIGN,
)?.campaign.id;
if (!campaignId) throw new Error('run seed.mjs first');

// Everyone sits down: a socket each (kept as that seat's feed), in voice, one of them muted.
const table = CAST.map((c) => seats.get(c.key).userId);
const sockets = new Map();
const feeds = new Map();
for (const seat of seats.values()) {
  const f = feed();
  feeds.set(seat.key, f);
  const socket = await openSocket(seat, campaignId, f.push);
  sockets.set(seat.key, socket);
  socket.send('audio.state', { inVoice: true, muted: seat.key === 'dorn', status: 'online' });
}
/** Each seat reports its link quality (the Game Master's Quality tab shows these as they arrive). */
function reportStats() {
  for (const [key, socket] of sockets) {
    socket.send('stats.report', {
      rttMs: key === 'elle' ? 140 + Math.random() * 30 : 18 + Math.random() * 40,
      jitterMs: key === 'elle' ? 24 : 2 + Math.random() * 6,
      packetLossPct: key === 'elle' ? 3.5 : 0,
    });
  }
}
reportStats();
await sleep(800);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
  headless: true,
  // The smoke stack's certificate is from Caddy's local CA, which the browser does not know.
  args: [
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--ignore-certificate-errors',
  ],
});
const panels = await servePanels();

/** A desktop window: the built panels at `#route`, signed in as `who`, in `scheme` and `theme`. */
async function desktop({ route = 'main', who = 'gm', scheme = 'dark', theme, size, options }) {
  const page = await browser.newPage();
  await page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  // Always set: every window shares one origin's storage, so a theme would leak into the next shot.
  await page.evaluateOnNewDocument((t) => localStorage.setItem('vtt.theme', t), theme ?? 'default');
  page.on('pageerror', (e) => console.error(`[${route}] page error:`, e.message));
  const seat = seats.get(who);
  const bridge = await attach(page, { seat, campaignId, feed: feeds.get(who), table, options });
  await page.goto(`${panels.url}/index.html#${route}`, { waitUntil: 'networkidle0' });
  await sleep(600);
  return { page, bridge, seat };
}

/** The web app in a phone-sized browser, signed in as `who` (the session cookie is the real one). */
async function phone({ path = '/app', who = 'aria', scheme = 'light', mobile = true, size }) {
  const page = await browser.newPage();
  const view = mobile
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: size?.[0] ?? 1100, height: size?.[1] ?? 800, deviceScaleFactor: 2 };
  await page.setViewport(view);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  page.on('pageerror', (e) => console.error(`[${path}] page error:`, e.message));
  if (who) {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vtt-client': 'web' },
      body: JSON.stringify({ email: seats.get(who).email, password: seats.get(who).password }),
    });
    for (const cookie of login.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      await browser.setCookie({
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain: new URL(BASE).hostname,
        path: '/',
        secure: true,
        httpOnly: true,
      });
    }
  }
  // Not `networkidle`: the status page and the app keep a connection open.
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await sleep(2000);
  return { page };
}

/**
 * What the real app would already hold from earlier in the session, but a socket opened later does not
 * get: the server keeps only a short tail of chat for replay, never replays whispers to a new window, and
 * announces a loot drop once. So the page is told the session's lines again, in order, with the drop
 * where it happened. Sent to the page only; nothing on the server changes.
 */
async function catchUp(bridge, who) {
  const me = seats.get(who).userId;
  const rows = await sql(
    `SELECT json_agg(json_build_object('id', id, 'from', sender_id, 'name', sender_name,
            'to', recipient_id, 'text', text, 'at', at, 'kind', kind, 'lang', lang) ORDER BY at)
     FROM chat_messages WHERE campaign_id = '${campaignId}'
       AND (recipient_id IS NULL OR '${me}' IN (sender_id::text, recipient_id::text))`,
  );
  const nameOf = (id) => {
    const seat = [...seats.values()].find((s) => s.userId === id);
    return seat?.character?.name ?? seat?.displayName ?? '';
  };
  const loot = (await ok('GET', `/api/campaigns/${campaignId}/loot`, gm.token)).loot;
  const key = loot.find((i) => i.name.startsWith('Silver Key'));
  for (const row of JSON.parse(rows || 'null') ?? []) {
    const line = {
      id: row.id,
      from: { userId: row.from, name: row.name },
      ...(row.to ? { to: { userId: row.to, name: nameOf(row.to) } } : {}),
      text: row.text,
      at: row.at,
      kind: row.kind,
      ...(row.lang ? { lang: row.lang } : {}),
    };
    await bridge.emit('sync:event', { t: row.to ? 'chat.whisper' : 'chat.message', d: line });
    if (key && row.text === 'brb, kettle') {
      await bridge.emit('sync:event', { t: 'loot.dropped', d: { itemId: key.id, ...key } });
    }
  }
  await sleep(300);
}

const ctx = {
  admin,
  catchUp,
  reportStats,
  OUT,
  seats,
  sockets,
  campaignId,
  table,
  desktop,
  phone,
  sleep,
  browser,
  frameWindow: (page, opts) => frameWindow(browser, page, opts),
  framePhone: (page, opts) => framePhone(browser, page, opts),
  terminal: (opts) => terminal(browser, opts),
};

const wanted = process.argv.slice(2);
let failed = 0;
for (const [name, shot] of Object.entries(SHOTS)) {
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  try {
    const png = await shot(ctx);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(OUT, `${name}.png`), png);
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}: ${error.message}`);
  }
  for (const page of await browser.pages()) await page.close().catch(() => undefined);
  await browser.deleteCookie(...(await browser.cookies())).catch(() => undefined);
}

await browser.close();
// Shrink the files (a 256-colour palette: about a fifth of the size, no visible loss on flat UI).
try {
  execFileSync('python3', [join(ROOT, 'scripts/screenshots/compress.py'), OUT], {
    stdio: 'inherit',
  });
} catch {
  console.warn('not compressed: compress.py needs python3 with Pillow');
}
panels.close();
for (const s of sockets.values()) s.close();
process.exit(failed ? 1 : 0);
