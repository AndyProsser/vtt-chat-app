import { MemoryJobQueue, MemoryRecordsStore, PROCESS_RECORDING_JOB } from '@vtt-chat-app/ai';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { AccountService } from '../lib/auth/accountService.js';
import { hashSecret, normaliseShortCode } from '../lib/auth/crypto.js';
import { SignupService } from '../lib/auth/signupService.js';
import { MemoryStore } from '../lib/store/memoryStore.js';
import { runAdmin, type Probe } from './admin.js';

let store: MemoryStore;
let accounts: AccountService;
let signups: SignupService;
let jobs: MemoryJobQueue;
let records: MemoryRecordsStore;
let out: string[];
let err: string[];
let updatesDir: string | undefined;
let recordingsDir: string | undefined;

async function run(args: string, probes: Probe[] = []): Promise<number> {
  return runAdmin(args.split(' ').filter(Boolean), {
    store,
    accounts,
    signups,
    jobs,
    records,
    now: () => 1_000,
    ...(updatesDir ? { updatesDir } : {}),
    ...(recordingsDir ? { recordingsDir } : {}),
    databaseBytes: async () => 5_000_000,
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
  signups = new SignupService({ store, accounts });
  jobs = new MemoryJobQueue();
  records = new MemoryRecordsStore();
  out = [];
  err = [];
  updatesDir = undefined;
  recordingsDir = undefined;
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
    expect(token).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await store.getMagicLinkByHash(hashSecret(normaliseShortCode(token)))).toBeDefined();
    const signedIn = await accounts.redeemMagicLink(token);
    expect(signedIn.user.id).toBe(alice.id);
    await expect(accounts.redeemMagicLink(token)).rejects.toThrow();
  });

  it('creates an account (the first becomes Admin) that signs in with a one-time code, no password', async () => {
    expect(await run('user create first@example.com --name Dungeon Master --accept-consent')).toBe(
      0,
    );
    const [created] = await store.listUsers();
    expect(created).toMatchObject({
      email: 'first@example.com',
      displayName: 'Dungeon Master',
      isAdmin: true,
      passwordHash: null,
    });
    expect(await run('user code first@example.com')).toBe(0);
    const signedIn = await accounts.redeemMagicLink(out.at(-1) ?? '');
    expect(signedIn.user.id).toBe(created?.id);
  });

  it('gives the first Admin a starter campaign as DM, and no one else', async () => {
    await run('user create first@example.com --name First --accept-consent');
    await run('user create second@example.com --name Second --accept-consent');
    const [first, second] = await store.listUsers();
    expect(await store.countCampaigns()).toBe(1);
    expect(await store.listMembershipsForUser(first?.id ?? '')).toMatchObject([{ role: 'dm' }]);
    expect(await store.listMembershipsForUser(second?.id ?? '')).toHaveLength(0);
  });

  it('makes a later account a plain user unless --admin is given, and can add another Admin', async () => {
    await run('user create a@example.com --name A --accept-consent');
    await run('user create b@example.com --name B --accept-consent');
    await run('user create c@example.com --name C --accept-consent --admin');
    const byEmail = Object.fromEntries((await store.listUsers()).map((u) => [u.email, u.isAdmin]));
    expect(byEmail).toEqual({
      'a@example.com': true,
      'b@example.com': false,
      'c@example.com': true,
    });
  });

  it('refuses without --accept-consent, a name, a good address, or a duplicate', async () => {
    expect(await run('user create a@example.com --name A')).toBe(1);
    expect(err.join('\n')).toContain('--accept-consent');
    expect(await run('user create a@example.com --accept-consent')).toBe(2);
    expect(await run('user create not-an-address --name A --accept-consent')).toBe(1);
    await run('user create a@example.com --name A --accept-consent');
    expect(await run('user create a@example.com --name A --accept-consent')).toBe(1);
    expect(await store.countUsers()).toBe(1);
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

describe('jobs and recordings', () => {
  const rec = (id: string, status: 'stopped' | 'recording' | 'failed' = 'stopped') =>
    records.putRecording({
      id,
      campaignId: 'c',
      startedAt: 1_700_000_000_000,
      stoppedAt: 2,
      status,
    });

  it('lists jobs, and filters by state', async () => {
    await jobs.enqueue({ kind: PROCESS_RECORDING_JOB, recordingId: 'r1' }, 1);
    await run('jobs list');
    expect(out.join('\n')).toContain('process-recording');
    out.length = 0;
    await run('jobs list failed');
    expect(out).toEqual(['no jobs']);
    expect(await run('jobs list sideways')).toBe(1);
  });

  it('puts a failed job back in the queue and the recording back to stopped', async () => {
    await rec('r1', 'failed');
    const job = await jobs.enqueue(
      { kind: PROCESS_RECORDING_JOB, recordingId: 'r1', maxAttempts: 1 },
      1,
    );
    await jobs.claim(2, 1000);
    await jobs.fail(job.id, 'whisper down', 3, 4);
    expect(await run(`jobs retry ${job.id}`)).toBe(0);
    expect((await jobs.get(job.id))?.state).toBe('queued');
    expect((await records.getRecording('r1'))?.status).toBe('stopped');
  });

  it('refuses to retry a job that has not failed', async () => {
    const job = await jobs.enqueue({ kind: 'k' }, 1);
    expect(await run(`jobs retry ${job.id}`)).toBe(1);
  });

  it('lists recordings with their status and track count', async () => {
    await rec('r1');
    await run('recording list');
    expect(out.join('\n')).toMatch(/r1\s+stopped\s+2023-11-14 \d\d:\d\d\s+0 track\(s\)/);
  });

  it('reprocess clears summaries only, by default, and queues one job', async () => {
    await rec('r1', 'failed');
    await records.putTrack({
      id: 't',
      recordingId: 'r1',
      speakerId: 'a',
      speakerName: 'A',
      filePath: '/a.ogg',
      startOffsetMs: 0,
      private: false,
      transcribedAt: 5,
    });
    await records.putSummary({
      recordingId: 'r1',
      kind: 'session',
      subject: '',
      visibility: 'members',
      text: 'old',
      modelCalls: 1,
      createdAt: 1,
    });
    expect(await run('recording reprocess r1')).toBe(0);
    expect(await records.getSummary('r1', 'session', '')).toBeUndefined();
    expect((await records.listTracks('r1'))[0]?.transcribedAt).toBe(5); // transcript kept
    expect(await jobs.list(['queued'])).toHaveLength(1);
    expect((await records.getRecording('r1'))?.status).toBe('stopped');
  });

  it('lists whether each recording still has its audio', async () => {
    await rec('r1', 'stopped');
    await records.putTrack({
      id: 't',
      recordingId: 'r1',
      speakerId: 'a',
      speakerName: 'A',
      filePath: '/a.ogg',
      startOffsetMs: 0,
      private: false,
      transcribedAt: 5,
    });
    await run('recording list');
    expect(out.join('\n')).toContain('1 track(s)  audio kept');
    await records.markTrackPurged('t', 9);
    out.length = 0;
    await run('recording list');
    expect(out.join('\n')).toContain('audio purged');
  });

  it("purge queues the deletion of one processed recording's raw audio, and refuses an unfinished one", async () => {
    await rec('r1', 'stopped');
    expect(await run('recording purge r1')).toBe(1);
    expect(err.join('\n')).toContain('not been processed');
    await records.setRecordingStatus('r1', 'processed');
    expect(await run('recording purge r1')).toBe(0);
    expect((await jobs.list(['queued'])).map((j) => [j.kind, j.recordingId])).toEqual([
      ['purge-recording', 'r1'],
    ]);
  });

  it('purge --older-than queues every processed recording past that age with audio left', async () => {
    const day = 86_400_000;
    await records.putRecording({
      id: 'old',
      campaignId: 'c',
      startedAt: -41 * day,
      stoppedAt: -40 * day, // the harness clock is 1000 ms: this is long before the cutoff
      status: 'processed',
    });
    await records.putTrack({
      id: 'o1',
      recordingId: 'old',
      speakerId: 'a',
      speakerName: 'A',
      filePath: '/o.ogg',
      startOffsetMs: 0,
      private: false,
      transcribedAt: 1,
    });
    expect(await run('recording purge --older-than 30')).toBe(0);
    expect(out.join('\n')).toContain('queued 1');
    expect(await jobs.list(['queued'])).toHaveLength(1);
    expect(await run('recording purge --older-than nope')).toBe(1);
  });

  it('reprocess --retranscribe is refused once the audio has been purged, but a summary redo is not', async () => {
    await rec('r1', 'stopped');
    await records.putTrack({
      id: 't',
      recordingId: 'r1',
      speakerId: 'a',
      speakerName: 'A',
      filePath: '/a.ogg',
      startOffsetMs: 0,
      private: false,
      transcribedAt: 5,
      purgedAt: 9,
    });
    expect(await run('recording reprocess r1 --retranscribe')).toBe(1);
    expect(err.join('\n')).toContain('purged');
    expect(await run('recording reprocess r1')).toBe(0);
  });

  it('reprocess --retranscribe also forgets the transcripts', async () => {
    await rec('r1');
    await records.putTrack({
      id: 't',
      recordingId: 'r1',
      speakerId: 'a',
      speakerName: 'A',
      filePath: '/a.ogg',
      startOffsetMs: 0,
      private: false,
      transcribedAt: 5,
    });
    await run('recording reprocess r1 --retranscribe');
    expect((await records.listTracks('r1'))[0]?.transcribedAt).toBeNull();
  });

  it('will not reprocess a recording that is still being recorded, or one that does not exist', async () => {
    await rec('live', 'recording');
    expect(await run('recording reprocess live')).toBe(1);
    expect(await run('recording reprocess ghost')).toBe(1);
    expect(await jobs.list()).toHaveLength(0);
  });

  it('does not queue a second job when reprocess is run twice', async () => {
    await rec('r1');
    await run('recording reprocess r1');
    await run('recording reprocess r1');
    expect(await jobs.list()).toHaveLength(1);
  });
});

describe('updates', () => {
  function signedRelease(): string {
    const from = mkdtempSync(path.join(tmpdir(), 'rel-'));
    writeFileSync(path.join(from, 'App_0.3.0_amd64.AppImage'), 'bin');
    writeFileSync(path.join(from, 'App_0.3.0_amd64.AppImage.sig'), 'SIG');
    return from;
  }

  it('publishes a signed release into UPDATES_DIR and says which platforms', async () => {
    updatesDir = mkdtempSync(path.join(tmpdir(), 'upd-'));
    const code = await run(
      `updates publish ${signedRelease()} --version 0.3.0 --base-url https://h.example/updates`,
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('linux-x86_64');
    const latest = JSON.parse(readFileSync(path.join(updatesDir, 'latest.json'), 'utf8'));
    expect(latest.platforms['linux-x86_64'].url).toBe(
      'https://h.example/updates/App_0.3.0_amd64.AppImage',
    );
  });

  it('sends a dev build to the dev channel and shows both channels in status', async () => {
    updatesDir = mkdtempSync(path.join(tmpdir(), 'upd-'));
    await run(`updates publish ${signedRelease()} --version 0.3.0 --base-url https://h/updates`);
    expect(
      await run(
        `updates publish ${signedRelease()} --version 0.4.0-dev.1 --base-url https://h/updates`,
      ),
    ).toBe(0);
    expect(out.join('\n')).toContain('dev build');
    out.length = 0;
    await run('updates status');
    expect(out.join('\n')).toMatch(/releases: offering 0\.3\.0/);
    expect(out.join('\n')).toMatch(/dev builds: offering 0\.4\.0-dev\.1/);
  });

  it('explains what is missing instead of guessing', async () => {
    expect(await run('updates publish somewhere --version 1 --base-url https://h')).toBe(1);
    expect(err.join('\n')).toContain('UPDATES_DIR');
    updatesDir = mkdtempSync(path.join(tmpdir(), 'upd-'));
    expect(await run('updates publish')).toBe(2);
    expect(await run(`updates publish ${signedRelease()} --base-url https://h`)).toBe(2);
    expect(err.join('\n')).toContain('--version');
    expect(await run('updates status')).toBe(0);
    expect(out.join('\n')).toContain('no update published');
  });
});

describe('storage', () => {
  it('shows what the recordings folder holds, the free space, and the database size', async () => {
    recordingsDir = mkdtempSync(path.join(tmpdir(), 'vtt-rec-'));
    writeFileSync(path.join(recordingsDir, 'a.opus'), Buffer.alloc(2048));
    expect(await run('storage')).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/recordings\s+2\.0 KB/);
    expect(text).toMatch(/free on that disk/);
    expect(text).toMatch(/database\s+4\.8 MB/);
  });
  it('says plainly when recordings are not kept on this server', async () => {
    expect(await run('storage')).toBe(0);
    expect(out.join('\n')).toContain('recordings are not kept on this server');
  });
});

describe('campaign directory setting', () => {
  it('defaults to on, validates, and shows in settings show and keys', async () => {
    expect((await store.getSettings()).campaignDirectory).toBe('on');
    expect(await run('settings set campaign-directory maybe')).toBe(1);
    expect(await run('settings set campaign-directory off')).toBe(0);
    expect((await store.getSettings()).campaignDirectory).toBe('off');
    out.length = 0;
    await run('settings show');
    expect(out.join('\n')).toContain('campaign-directory         off');
    out.length = 0;
    await run('settings keys');
    expect(out.join('\n')).toContain('campaign-directory');
  });
});

describe('audio-purge-next-session', () => {
  it('defaults to off, validates, and shows in settings show and keys', async () => {
    expect((await store.getSettings()).audioPurgeOnNextSession).toBe('off');
    expect(await run('settings set audio-purge-next-session maybe')).toBe(1);
    expect(await run('settings set audio-purge-next-session on')).toBe(0);
    expect((await store.getSettings()).audioPurgeOnNextSession).toBe('on');
    out.length = 0;
    await run('settings show');
    expect(out.join('\n')).toContain('audio-purge-next-session   on');
    out.length = 0;
    await run('settings keys');
    expect(out.join('\n')).toContain('audio-purge-next-session');
  });
});

describe('signup requests', () => {
  const ask = (email: string, name = 'Visitor', message = '') =>
    signups.submit({ email, displayName: name, message });

  it('is off by default and the setting validates', async () => {
    expect((await store.getSettings()).signupRequests).toBe('off');
    await run('settings show');
    expect(out.join('\n')).toContain('signup.requests            off');
    expect(await run('settings set signup.requests maybe')).toBe(1);
    expect(await run('settings set signup.requests on')).toBe(0);
    expect((await store.getSettings()).signupRequests).toBe('on');
    out.length = 0;
    await run('settings keys');
    expect(out.join('\n')).toContain('signup.requests');
  });

  it('lists pending requests, and shows the count in status', async () => {
    await run('settings set signup.requests on');
    await ask('Zed@Example.com', 'Zed', 'friend of Sam');
    out.length = 0;
    expect(await run('signup list')).toBe(0);
    expect(out[0]).toContain('Zed');
    expect(out[0]).toContain('<zed@example.com>');
    expect(out[0]).toContain('friend of Sam');
    out.length = 0;
    await run('status');
    expect(out.join('\n')).toContain('1 pending sign-up request(s)');
    out.length = 0;
    await run('signup list approved');
    expect(out).toEqual(['no approved sign-up requests']);
    expect(await run('signup list sideways')).toBe(1);
  });

  it('approves by email: makes the account without consent, prints a code that signs in', async () => {
    await run('settings set signup.requests on');
    await ask('zed@example.com', 'Zed');
    out.length = 0;
    expect(await run('signup approve ZED@example.com')).toBe(0);
    expect(out[0]).toBe('approved zed@example.com');
    const code = out.find((l) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(l));
    expect(code).toBeDefined();
    expect(out.join('\n')).toContain('side channel');
    const user = await store.getUserByEmail('zed@example.com');
    expect(user).toMatchObject({ isAdmin: false, passwordHash: null });
    const signedIn = await accounts.redeemMagicLink(code!);
    expect(signedIn.needsConsent).toBe(true);
    expect(await store.listSignupRequests('pending')).toEqual([]);
  });

  it('approves by id, rejects by email, and only acts on pending requests', async () => {
    await run('settings set signup.requests on');
    await ask('a@example.com', 'A');
    await ask('b@example.com', 'B');
    const [a] = await store.listSignupRequests('pending');
    expect(await run(`signup approve ${a!.id}`)).toBe(0);
    expect(await run('signup reject b@example.com')).toBe(0);
    expect(await run('signup approve a@example.com')).toBe(1);
    expect(await run('signup reject b@example.com')).toBe(1);
    expect(await run('signup approve')).toBe(2);
    expect((await store.listSignupRequests('rejected')).map((r) => r.email)).toEqual([
      'b@example.com',
    ]);
    expect(await store.getUserByEmail('b@example.com')).toBeUndefined();
  });
});
