// Shared helpers for the screenshot tooling (seed.mjs, shoot.mjs). Local smoke stack only: it makes
// throwaway `@example.com` accounts and one campaign. Never point it at a server you care about.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
export const BASE = process.env.BASE ?? 'https://localhost';
export const COMPOSE = process.env.COMPOSE_DIR ?? join(ROOT, 'infra/compose');
/** Working files (generated passwords, mode 0600). Outside the repo on purpose. */
export const WORK = process.env.WORK ?? join(process.env.HOME ?? '.', 'scratch/vtt-screenshots');
const STATE = join(WORK, 'state.json');

export const CAMPAIGN = 'The Sunken Temple';

/** The table. `gm` runs it; the rest are players with one character each. */
export const CAST = [
  { key: 'gm', displayName: 'Morgan' },
  {
    key: 'aria',
    displayName: 'Aria',
    character: { name: 'Aria Windfoot', className: 'Ranger', race: 'Wood elf', level: 5 },
    emblem: 'bow',
  },
  {
    key: 'bram',
    displayName: 'Bram',
    character: { name: 'Bram Ironvow', className: 'Cleric', race: 'Hill dwarf', level: 5 },
    emblem: 'shield',
  },
  {
    key: 'cass',
    displayName: 'Cass',
    character: { name: 'Cassiel', className: 'Warlock', race: 'Tiefling', level: 4 },
    emblem: 'flame',
  },
  {
    key: 'dorn',
    displayName: 'Dorn',
    character: { name: 'Dorn Stoutbarrel', className: 'Fighter', race: 'Halfling', level: 5 },
    emblem: 'axe',
  },
  {
    key: 'elle',
    displayName: 'Elle',
    character: { name: 'Elowen Brightsong', className: 'Bard', race: 'Half-elf', level: 4 },
    emblem: 'star',
  },
].map((c) => ({ ...c, email: `shots-${c.key}@example.com` }));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(method, route, token, body) {
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
}

export async function ok(method, route, token, body) {
  const r = await api(method, route, token, body);
  if (r.status >= 300)
    throw new Error(`${method} ${route} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Runs the Admin CLI. Its output can hold a sign-in code, so it is returned and never logged. */
export async function admin(...args) {
  const { stdout } = await run(join(COMPOSE, 'vtt-admin'), args, { cwd: COMPOSE });
  return stdout;
}

/** One SQL statement on the stack's database (read from stdin, so quoting is not a problem). */
export async function sql(query) {
  const child = run(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At',
    ],
    { cwd: COMPOSE },
  );
  child.child.stdin.end(query);
  return (await child).stdout.trim();
}

export function loadState() {
  if (existsSync(STATE)) return JSON.parse(readFileSync(STATE, 'utf8'));
  return { passwords: {} };
}

export function saveState(state) {
  mkdirSync(WORK, { recursive: true, mode: 0o700 });
  writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(STATE, 0o600);
}

/** Signs one of the cast in (making the account on first use). Returns `{ ...cast, token, userId }`. */
export async function signIn(state, cast) {
  state.passwords[cast.key] ??= randomBytes(18).toString('base64url');
  const password = state.passwords[cast.key];
  let token;
  const login = await api('POST', '/api/auth/login', undefined, { email: cast.email, password });
  if (login.status === 200 && login.body.sessionToken) {
    token = login.body.sessionToken;
  } else {
    const users = await admin('user', 'list');
    if (!users.includes(cast.email)) {
      await admin('user', 'create', cast.email, '--name', cast.displayName, '--accept-consent');
    }
    // A one-time reset code (the CLI's side-channel path), redeemed with the password we keep.
    const code = (await admin('user', 'code', cast.email, 'reset')).trim().split('\n').pop().trim();
    const r = await ok('POST', '/api/auth/magic-link/redeem', undefined, {
      token: code,
      newPassword: password,
    });
    token = r.sessionToken;
    saveState(state);
  }
  const me = await ok('GET', '/api/auth/me', token);
  return { ...cast, token, password, userId: me.user.id };
}

export async function signInAll() {
  const state = loadState();
  const seats = new Map();
  for (const cast of CAST) seats.set(cast.key, await signIn(state, cast));
  saveState(state);
  return { state, seats };
}

/** A sync socket for one seat, authenticated and resumed on the campaign. `frames` collects what arrives. */
export async function openSocket(seat, campaignId, onFrame) {
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws`);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('websocket failed to open')), { once: true });
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('message', (e) => {
      const frame = JSON.parse(String(e.data));
      if (frame.t === 'auth.ok') res();
      else if (frame.t === 'error') {
        rej(new Error(frame.d?.message ?? 'socket error'));
        console.error(`[${seat.key}] socket error:`, JSON.stringify(frame.d));
      } else onFrame?.(frame);
    });
  });
  ws.send(JSON.stringify({ v: 1, t: 'auth', d: { token: seat.token } }));
  await ready;
  const send = (t, d) => ws.send(JSON.stringify({ v: 1, t, d: { campaignId, ...d } }));
  send('resume', {});
  return { ws, send, close: () => ws.close() };
}
