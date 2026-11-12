// Shared helpers for ui-smoke.mjs. Local smoke-stack tooling only; never point this at a real server.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const puppeteer = require('puppeteer-core');

export const BASE = process.env.BASE ?? 'https://localhost';
export const OUT = process.env.OUT ?? resolve(process.cwd(), 'ui-smoke-out');
mkdirSync(OUT, { recursive: true });
const here = dirname(fileURLToPath(import.meta.url));
export const COMPOSE = process.env.COMPOSE_DIR ?? resolve(here, '../../infra/compose');

export const VIEWS = {
  desktop: { width: 1000, height: 800, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const admin = (...args) =>
  execFileSync(join(COMPOSE, 'vtt-admin'), args, { encoding: 'utf8' });

/** A fresh one-time sign-in code for an existing account (ABCD-EFGH). */
export function signInCode(email) {
  const out = admin('user', 'code', email, 'signin');
  const m = out.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
  if (!m) throw new Error('no code in vtt-admin output');
  return m[0];
}

export function ensureUser(email, name) {
  try {
    execFileSync(
      join(COMPOSE, 'vtt-admin'),
      ['user', 'create', email, '--name', name, '--accept-consent'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
  } catch {
    /* already exists */
  }
}

/** Redeem a code over the API and return the session cookie value. */
const sessionCache = join(OUT, 'sessions.json');
export async function sessionFor(email) {
  // Redeeming is rate limited, so keep a session per throwaway account (in the output dir) and reuse it while it is valid.
  let cache = {};
  try {
    cache = JSON.parse(readFileSync(sessionCache, 'utf8'));
  } catch {
    /* none yet */
  }
  if (cache[email]) {
    const r = await api(cache[email], 'GET', '/api/auth/me');
    if (r.status === 200) return cache[email];
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    const value = await redeem(email);
    if (value) {
      cache[email] = value;
      writeFileSync(sessionCache, JSON.stringify(cache), { mode: 0o600 });
      return value;
    }
    await sleep(15000);
  }
  throw new Error('redeem kept failing for ' + email);
}
async function redeem(email) {
  const res = await fetch(`${BASE}/api/auth/magic-link/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vtt-client': 'web' },
    body: JSON.stringify({ token: signInCode(email) }),
  });
  const c = res.headers.getSetCookie().find((x) => x.startsWith('__Host-vtt_session='));
  if (!c) {
    if (res.status === 429) return undefined;
    throw new Error(`redeem failed: ${res.status}`);
  }
  return c.split(';')[0].split('=').slice(1).join('=');
}

export function readAndy() {
  const [email, password] = readFileSync(process.env.HOME + '/vtt-smoke-andy-password.txt', 'utf8')
    .trim()
    .split('\n');
  return { email, password };
}

export async function api(cookie, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-vtt-client': 'web',
      origin: BASE,
      cookie: `__Host-vtt_session=${cookie}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json };
}

export async function launch() {
  return puppeteer.launch({
    executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--ignore-certificate-errors', '--disable-gpu'],
  });
}

/** A page in its own context with problems collected. Options: view, scheme, cookie, permissions. */
export async function newPage(
  browser,
  { view = 'desktop', scheme = 'light', cookie, tag, problems },
) {
  const context = await browser.createBrowserContext();
  await context.overridePermissions(BASE, [
    'clipboard-read',
    'clipboard-write',
    'clipboard-sanitized-write',
  ]);
  const page = await context.newPage();
  await page.setViewport(VIEWS[view]);
  if (view === 'mobile') await page.setUserAgent(MOBILE_UA);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  if (cookie) {
    await page.setCookie({
      name: '__Host-vtt_session',
      value: cookie,
      url: BASE + '/',
      secure: true,
      httpOnly: true,
      path: '/',
    });
  }
  const label = tag ?? `${view}/${scheme}`;
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 401/.test(m.text()))
      problems.push(`[${label}] console.error: ${m.text()} @${page.url()}`);
  });
  page.on('requestfailed', (r) =>
    problems.push(`[${label}] requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`),
  );
  page.on('response', (r) => {
    // A signed-out visit probing the session (401 on /api/auth/me) is expected.
    if (r.status() >= 400 && !(r.status() === 401 && /\/api\/auth\/me$/.test(r.url())))
      problems.push(`[${label}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.__label = label;
  page.__context = context;
  return page;
}

export async function shot(page, name) {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

export const text = (page, sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);

/** Click the first element (button, link, menuitem...) whose text matches. */
export async function clickText(
  page,
  re,
  scope = 'button, a, [role=menuitem], [role=tab], [role=option]',
) {
  const handle = await page.evaluateHandle(
    (s, src) => {
      const rx = new RegExp(src, 'i');
      return [...document.querySelectorAll(s)].find(
        (e) =>
          rx.test((e.innerText || e.getAttribute('aria-label') || '').trim().split('\n')[0]) &&
          e.getBoundingClientRect().width > 0,
      );
    },
    scope,
    re.source,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`nothing to click matching ${re}`);
  await el.click();
}

export async function waitText(page, re, timeout = 8000) {
  await page.waitForFunction(
    (src) => new RegExp(src, 'i').test(document.body.innerText),
    { timeout },
    re.source,
  );
}

export const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
