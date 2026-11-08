/* eslint-disable @typescript-eslint/no-explicit-any -- dev scripts read loosely typed JSON */
// Shared helpers for the dev seed and mock-table scripts. Dev only: nothing here ships.
//
// Accounts and their generated passwords live in `.dev/accounts.json` (git-ignored, mode 0600).
// Scripts never print a password; read the file yourself when you need to sign in as someone.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const API = process.env.VTT_API ?? 'http://127.0.0.1:3000';
export const LIVEKIT_URL = process.env.VTT_LIVEKIT_URL ?? 'ws://127.0.0.1:7880';
const FILE = path.join(ROOT, '.dev', 'accounts.json');

export interface Person {
  key: string;
  email: string;
  displayName: string;
  password: string;
  role: 'dm' | 'player';
  character?: { name: string; className: string; race: string; level: number };
}

export interface DevState {
  api: string;
  campaignId?: string;
  people: Person[];
}

/** The cast. The DM is the account to sign in with while testing; the players are mock table-mates. */
const CAST: Omit<Person, 'password'>[] = [
  { key: 'dm', email: 'dm@vtt.test', displayName: 'Test DM', role: 'dm' },
  {
    key: 'aria',
    email: 'aria@vtt.test',
    displayName: 'Aria',
    role: 'player',
    character: { name: 'Aria Windfoot', className: 'Ranger', race: 'Wood elf', level: 5 },
  },
  {
    key: 'bram',
    email: 'bram@vtt.test',
    displayName: 'Bram',
    role: 'player',
    character: { name: 'Bram Ironvow', className: 'Cleric', race: 'Hill dwarf', level: 5 },
  },
  {
    key: 'cass',
    email: 'cass@vtt.test',
    displayName: 'Cass',
    role: 'player',
    character: { name: 'Cassiel', className: 'Warlock', race: 'Tiefling', level: 4 },
  },
  {
    key: 'dorn',
    email: 'dorn@vtt.test',
    displayName: 'Dorn',
    role: 'player',
    character: { name: 'Dorn Stoutbarrel', className: 'Fighter', race: 'Halfling', level: 5 },
  },
];

export function loadState(): DevState {
  if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as DevState;
  const people = CAST.map((p) => ({ ...p, password: randomBytes(18).toString('base64url') }));
  return { api: API, people };
}

export function saveState(state: DevState): void {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
}

export async function call<T = any>(
  method: string,
  route: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}

export interface Session {
  person: Person;
  userId: string;
  token: string;
}

/** Signs `person` in, creating the account first if it does not exist. */
export async function signIn(person: Person): Promise<Session> {
  const login = await call('POST', '/api/auth/login', undefined, {
    email: person.email,
    password: person.password,
  });
  if (login.status === 200) {
    return { person, userId: login.body.user.id, token: login.body.sessionToken };
  }
  const reg = await call('POST', '/api/auth/register', undefined, {
    email: person.email,
    displayName: person.displayName,
    password: person.password,
    acceptedConsentVersion: '1',
  });
  if (reg.status !== 201 || !reg.body.sessionToken) {
    throw new Error(
      `cannot sign ${person.email} in or register it (login ${login.status}, register ${reg.status}). ` +
        'If the database still has the account from an earlier run, delete .dev/accounts.json only if you also reset the database.',
    );
  }
  return { person, userId: reg.body.user.id, token: reg.body.sessionToken };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
