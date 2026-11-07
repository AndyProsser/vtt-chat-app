import { beforeEach, describe, expect, it } from 'vitest';

import { AccountService } from '../lib/auth/accountService.js';
import { hashSecret } from '../lib/auth/crypto.js';
import { MemoryStore } from '../lib/store/memoryStore.js';
import { runAdmin, type Probe } from './admin.js';

let store: MemoryStore;
let accounts: AccountService;
let out: string[];
let err: string[];

async function run(args: string, probes: Probe[] = []): Promise<number> {
  return runAdmin(args.split(' ').filter(Boolean), {
    store,
    accounts,
    probes,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
}

const register = (name: string) =>
  accounts.register({
    email: `${name}@example.com`,
    displayName: name,
    password: 'correct horse battery',
    acceptedConsentVersion: '1',
  });

beforeEach(() => {
  store = new MemoryStore();
  accounts = new AccountService({ store });
  out = [];
  err = [];
});

describe('help and misuse', () => {
  it('prints usage and exits 2 with no command', async () => {
    expect(await run('')).toBe(2);
    expect(out.join('\n')).toContain('settings set');
  });

  it('rejects an unknown command', async () => {
    expect(await run('frobnicate')).toBe(2);
    expect(err.join('\n')).toContain('unknown command');
  });
});

describe('settings', () => {
  it('shows every setting with its default', async () => {
    expect(await run('settings show')).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('campaign-creation          closed');
    expect(text).toContain('ai.transcription.kind      local');
    expect(text).toContain('ai.fallback.after-seconds  600');
  });

  it('lists the keys it accepts', async () => {
    await run('settings keys');
    expect(out.join('\n')).toContain('ai.fallback.enabled');
  });

  it('changes a core setting and persists it', async () => {
    expect(await run('settings set campaign-creation open')).toBe(0);
    expect((await store.getSettings()).campaignCreation).toBe('open');
    expect(await run('settings set offline-limit-days 14')).toBe(0);
    expect((await store.getSettings()).offlineLimitDays).toBe(14);
  });

  it('points the AI backend at a remote GPU box with a local fallback after 5 minutes', async () => {
    await run('settings set ai.transcription.url http://gaming-pc:8080/');
    await run('settings set ai.transcription.kind remote');
    await run('settings set ai.fallback.after-seconds 300');
    const { ai } = await store.getSettings();
    expect(ai.transcription).toMatchObject({ kind: 'remote', url: 'http://gaming-pc:8080' });
    expect(ai.fallback.afterSeconds).toBe(300);
    expect(ai.fallback.enabled).toBe(true);
  });

  it('saves a remote backend with no URL but warns that it is unusable', async () => {
    expect(await run('settings set ai.llm.kind remote')).toBe(0);
    expect(out.join('\n')).toContain('warning');
    expect((await store.getSettings()).ai.llm.kind).toBe('remote');
  });

  it.each([
    'settings set campaign-creation maybe',
    'settings set offline-limit-days 0',
    'settings set offline-limit-days 3.5',
    'settings set ai.fallback.enabled perhaps',
    'settings set ai.transcription.url ftp://x',
    'settings set no.such.key 1',
  ])('rejects %s and changes nothing', async (command) => {
    const before = await store.getSettings();
    expect(await run(command)).toBe(1);
    expect(await store.getSettings()).toEqual(before);
    expect(err.join('\n')).toContain('error:');
  });

  it('asks for a value', async () => {
    expect(await run('settings set campaign-creation')).toBe(2);
  });

  it('keeps a multi-word value together', async () => {
    await run('settings set consent-version 2026 11 text');
    expect((await store.getSettings()).consentVersion).toBe('2026 11 text');
  });
});

describe('users', () => {
  it('lists accounts, marking the first as Admin', async () => {
    await register('alice');
    await register('bob');
    await run('user list');
    expect(out[0]).toMatch(/^admin\s+alice@example\.com/);
    expect(out[1]).toMatch(/^user\s+bob@example\.com/);
  });

  it('grants and revokes Admin', async () => {
    await register('alice');
    await register('bob');
    expect(await run('user admin bob@example.com grant')).toBe(0);
    expect((await store.getUserByEmail('bob@example.com'))?.isAdmin).toBe(true);
    expect(await run('user admin alice@example.com revoke')).toBe(0);
    expect((await store.getUserByEmail('alice@example.com'))?.isAdmin).toBe(false);
  });

  it('refuses to remove the last Admin', async () => {
    await register('alice');
    expect(await run('user admin alice@example.com revoke')).toBe(1);
    expect(err.join('\n')).toContain('only Admin');
    expect((await store.getUserByEmail('alice@example.com'))?.isAdmin).toBe(true);
  });

  it('is a no-op to grant someone who is already Admin', async () => {
    await register('alice');
    expect(await run('user admin alice@example.com grant')).toBe(0);
    expect(out.join('\n')).toContain('already');
  });

  it('is case-insensitive about the address and rejects an unknown one', async () => {
    await register('alice');
    expect(await run('user admin ALICE@Example.com grant')).toBe(0);
    expect(await run('user admin nobody@example.com grant')).toBe(1);
  });

  it('issues a one-time code that really signs that account in, once', async () => {
    const alice = await register('alice');
    expect(await run('user code alice@example.com')).toBe(0);
    const token = out.at(-1) ?? '';
    expect(await store.getMagicLinkByHash(hashSecret(token))).toBeDefined();
    const signedIn = await accounts.redeemMagicLink(token);
    expect(signedIn.user.id).toBe(alice.id);
    await expect(accounts.redeemMagicLink(token)).rejects.toThrow();
  });

  it('issues a reset code on request and rejects a bad purpose', async () => {
    await register('alice');
    await run('user code alice@example.com reset');
    expect(out.join('\n')).toContain('reset code');
    expect(await run('user code alice@example.com bogus')).toBe(2);
  });

  it('signs an account out everywhere', async () => {
    const alice = await register('alice');
    await accounts.signInWithPassword('alice@example.com', 'correct horse battery');
    expect(await accounts.listSessions(alice.id)).not.toHaveLength(0);
    expect(await run('user revoke-sessions alice@example.com')).toBe(0);
    expect(await accounts.listSessions(alice.id)).toHaveLength(0);
  });
});

describe('status', () => {
  it('reports every probe and exits 0 when all answer', async () => {
    const probes: Probe[] = [{ name: 'database', run: async () => 'reachable' }];
    expect(await run('status', probes)).toBe(0);
    expect(out.join('\n')).toContain('ok    database');
  });

  it('shows a failing probe and exits 1, without hiding the others', async () => {
    const probes: Probe[] = [
      {
        name: 'valkey',
        run: async () => {
          throw new Error('connection refused');
        },
      },
      { name: 'livekit', run: async () => 'answered 200' },
    ];
    expect(await run('status', probes)).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('FAIL  valkey');
    expect(text).toContain('connection refused');
    expect(text).toContain('ok    livekit');
  });
});
