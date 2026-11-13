// End-to-end smoke test of the records pipeline against a RUNNING Docker Compose stack (records profile
// up): throwaway accounts and campaign → every person connected over the WebSocket and to LiveKit voice,
// speaking synthetic speech → the DM records (cue acknowledgements, a late joiner, a pause, a second
// recording) while people type every kind of chat line → Egress → the durable job queue → worker →
// Whisper → LLM → checked through the Records API, as each person would see it.
//
//   NODE_EXTRA_CA_CERTS=<caddy root.crt> node infra/records-smoke/compose-e2e.ts [options]
//
//   --no-kill          skip the "kill the worker mid-job" drill
//   --fallback         also drill the remote-AI fallback: point transcription at an unreachable server
//                      with a 20 s fallback, reprocess recording B, expect the local Whisper to take over
//   --verify A,B       skip the scene; verify two existing recordings of the e2e campaign again
//   --timeout-min N    how long to wait for processing (default 90)
//
// Environment: VTT_API (default https://localhost), VTT_LIVEKIT_URL (use instead of the URL the server
// hands out, e.g. ws://127.0.0.1:7880 if the LiveKit SDK cannot verify Caddy's certificate),
// VTT_COMPOSE_DIR (default infra/compose: where vtt-admin and `docker compose` run), E2E_STATE (default
// ~/.local/state/vtt-compose-e2e: account passwords, mode 0600, never printed), PIPER_BIN, PIPER_VOICES.
//
// Accounts are fake @example.com addresses created with `vtt-admin user create`, and the campaign is the
// test's own; nothing else on the instance is touched, except that campaign creation is opened for a
// moment if it is closed (and closed again), and --fallback changes the AI settings for the drill (and
// restores them). Results: printed, and written to <E2E_STATE>/results-<time>.json.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseComposerInput, type ChatMember } from '@vtt-chat-app/shared';

import { TableClient } from './e2e/client.ts';
import {
  CAST,
  FORBIDDEN,
  RECORDING_A,
  RECORDING_B,
  SEARCH_SPOKEN,
  SEARCH_TYPED,
  type Step,
  type Who,
} from './e2e/scene.ts';
import { containsWord, wordAccuracy } from './e2e/score.ts';
import { piperTts } from './e2e/tts.ts';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.VTT_API ?? 'https://localhost').replace(/\/+$/, '');
const COMPOSE_DIR = process.env.VTT_COMPOSE_DIR ?? path.resolve(here, '../compose');
const STATE_DIR = process.env.E2E_STATE ?? path.join(homedir(), '.local/state/vtt-compose-e2e');
const STATE_FILE = path.join(STATE_DIR, 'accounts.json');
const CAMPAIGN_NAME = 'E2E: The Sunken Temple';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const option = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const TIMEOUT_MIN = Number(option('--timeout-min') ?? 90);

const t0 = Date.now();
const log = (line: string) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${line}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- checks -----------------------------------------------------------------------------------

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}
const checks: Check[] = [];
const metrics: Record<string, unknown> = {};
function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- server access ----------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON from our own API
type Json = any;

async function api(
  method: string,
  route: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
}

async function ok(method: string, route: string, token?: string, body?: unknown): Promise<Json> {
  const r = await api(method, route, token, body);
  if (r.status >= 300)
    throw new Error(`${method} ${route} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

/** Runs the Admin CLI. Its output can hold a sign-in code, so it is returned, never logged. */
async function admin(...args: string[]): Promise<string> {
  const { stdout } = await run(path.join(COMPOSE_DIR, 'vtt-admin'), args, { cwd: COMPOSE_DIR });
  return stdout;
}

async function compose(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', ['compose', ...args], { cwd: COMPOSE_DIR });
  return stdout;
}

async function sql(query: string): Promise<string> {
  const out = await compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'vtt',
    '-d',
    'vtt',
    '-At',
    '-c',
    query,
  );
  return out.trim();
}

// ---- accounts and campaign --------------------------------------------------------------------

interface Person {
  key: Who;
  email: string;
  password: string;
  userId?: string;
}
interface State {
  people: Person[];
  campaignId?: string;
}

async function loadState(): Promise<State> {
  if (existsSync(STATE_FILE)) return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  return {
    people: CAST.map((c) => ({
      key: c.key,
      email: c.email,
      password: randomBytes(18).toString('base64url'),
    })),
  };
}

async function saveState(state: State): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(STATE_FILE, 0o600);
}

/** Signs in with the stored password; on a fresh instance makes the account and sets that password. */
async function signIn(person: Person): Promise<string> {
  const login = await api('POST', '/api/auth/login', undefined, {
    email: person.email,
    password: person.password,
  });
  if (login.status === 200 && login.body.sessionToken) return login.body.sessionToken as string;

  const cast = CAST.find((c) => c.key === person.key)!;
  const users = await admin('user', 'list');
  if (!users.includes(person.email)) {
    await admin('user', 'create', person.email, '--name', cast.displayName, '--accept-consent');
    log(`created ${person.email}`);
  }
  // A one-time reset code (the CLI's side-channel path), redeemed with the password we keep.
  const out = await admin('user', 'code', person.email, 'reset');
  const code = out.trim().split('\n').pop()!.trim();
  const r = await ok('POST', '/api/auth/magic-link/redeem', undefined, {
    token: code,
    newPassword: person.password,
  });
  return r.sessionToken as string;
}

interface Seat {
  person: Person;
  token: string;
  userId: string;
  name: string;
}

async function setUp(state: State): Promise<{ seats: Map<Who, Seat>; campaignId: string }> {
  const seats = new Map<Who, Seat>();
  for (const person of state.people) {
    const token = await signIn(person);
    const me = await ok('GET', '/api/auth/me', token);
    person.userId = me.user.id as string;
    const cast = CAST.find((c) => c.key === person.key)!;
    seats.set(person.key, {
      person,
      token,
      userId: person.userId,
      name: cast.character?.name ?? cast.displayName,
    });
  }
  await saveState(state);
  const dm = seats.get('dm')!;

  let campaignId = state.campaignId;
  const mine = await ok('GET', '/api/campaigns', dm.token);
  if (!campaignId || !(mine.campaigns as Json[]).some((c) => c.campaign.id === campaignId)) {
    const settings = await admin('settings', 'show');
    const closed = /campaign-creation\s+closed/.test(settings);
    if (closed) await admin('settings', 'set', 'campaign-creation', 'open');
    try {
      const created = await ok('POST', '/api/campaigns', dm.token, { name: CAMPAIGN_NAME });
      campaignId = created.campaign.id as string;
    } finally {
      if (closed) await admin('settings', 'set', 'campaign-creation', 'closed');
    }
    state.campaignId = campaignId;
    await saveState(state);
    log(`created campaign ${campaignId}`);
  }

  const members = await ok('GET', `/api/campaigns/${campaignId}/members`, dm.token);
  const memberIds = new Set((members.members as Json[]).map((m) => m.userId as string));
  let invite: string | undefined;
  for (const cast of CAST.filter((c) => c.key !== 'dm')) {
    const seat = seats.get(cast.key)!;
    if (!memberIds.has(seat.userId)) {
      invite ??= (await ok('POST', `/api/campaigns/${campaignId}/invites`, dm.token, {})).code;
      await ok('POST', '/api/campaigns/join', seat.token, { code: invite });
    }
    // One active character each: the transcript and the character summaries use its name.
    const chars = await ok('GET', `/api/campaigns/${campaignId}/characters`, seat.token);
    let character = (chars.characters as Json[]).find((c) => c.name === cast.character!.name);
    character ??= (
      await ok('POST', `/api/campaigns/${campaignId}/characters`, seat.token, cast.character)
    ).character;
    await ok('PUT', `/api/campaigns/${campaignId}/active-character`, seat.token, {
      characterId: character.id,
    });
  }
  return { seats, campaignId: campaignId! };
}

// ---- the scene --------------------------------------------------------------------------------

interface Said {
  who: Who;
  text: string;
  expect: 'captured' | 'absent';
  at: number;
  recording?: string;
}

async function connect(seat: Seat, campaignId: string): Promise<TableClient> {
  const client = new TableClient(seat.name, seat.userId, seat.token, campaignId, log);
  await client.connect(API);
  const voice = await ok('POST', `/api/campaigns/${campaignId}/voice-token`, seat.token, {});
  const url = process.env.VTT_LIVEKIT_URL ?? (voice.url as string);
  await client.joinVoice(url, voice.token as string);
  metrics.livekitUrl = url;
  return client;
}

async function playScene(
  steps: readonly Step[],
  ctx: {
    seats: Map<Who, Seat>;
    clients: Map<Who, TableClient>;
    campaignId: string;
    tts: ReturnType<typeof piperTts>;
    said: Said[];
  },
): Promise<string> {
  const { seats, clients, campaignId, tts, said } = ctx;
  const dm = seats.get('dm')!;
  let recordingId = '';
  const members: ChatMember[] = CAST.map((c) => ({
    id: seats.get(c.key)!.userId,
    name: c.displayName,
    characterName: c.character?.name ?? null,
    role: c.key === 'dm' ? 'dm' : 'player',
  }));
  const control = async (action: 'start' | 'pause' | 'resume' | 'stop') => {
    const r = await ok('POST', `/api/campaigns/${campaignId}/recording`, dm.token, { action });
    recordingId = r.recordingId as string;
    log(`DM: recording ${action} (${recordingId})`);
  };

  for (const step of steps) {
    const dropped = [...clients.values()].filter((c) => c.dropped).map((c) => c.name);
    if (dropped.length > 0) {
      throw new Error(
        `the server closed the connection of ${dropped.join(', ')} mid-scene (was the backend restarted?); ` +
          'the recording is recovered and processed by the backend, but this run cannot check it: run again',
      );
    }
    switch (step.do) {
      case 'start': {
        await control('start');
        // Everyone connected acknowledges after the cue; wait for all of them, then for Egress to start.
        const connected = [...clients.values()].filter((c) => c.autoAck);
        const deadline = Date.now() + 15_000;
        while (connected.some((c) => !c.acks.has(recordingId)) && Date.now() < deadline)
          await sleep(200);
        check(
          `recording ${recordingId.slice(0, 8)}: every connected client acknowledged the cue`,
          connected.every((c) => c.acks.has(recordingId)),
        );
        await sleep(6000);
        break;
      }
      case 'pause':
      case 'resume':
        await control(step.do);
        break;
      case 'stop':
        await sleep(3000); // the last words reach Egress
        await control('stop');
        break;
      case 'late-join': {
        const seat = seats.get(step.who)!;
        const client = new TableClient(seat.name, seat.userId, seat.token, campaignId, log);
        client.autoAck = false; // this app is still playing the cue
        await client.connect(API);
        const state = client.frames.find((f) => f.t === 'recording.state')!.d.recording as Json;
        check(
          'late joiner is told a recording is in progress and has not acknowledged it',
          state?.status === 'IN-PROGRESS' && state?.acknowledged === false,
          JSON.stringify(state),
        );
        const voice = await ok('POST', `/api/campaigns/${campaignId}/voice-token`, seat.token, {});
        await client.joinVoice(process.env.VTT_LIVEKIT_URL ?? voice.url, voice.token);
        clients.set(step.who, client);
        log(`${seat.name} joined late (not acknowledged yet)`);
        await sleep(6000); // give the reconciler every chance to (wrongly) start capturing
        break;
      }
      case 'ack': {
        const client = clients.get(step.who)!;
        client.ack(recordingId);
        client.autoAck = true;
        break;
      }
      case 'wait':
        await sleep(step.seconds * 1000);
        break;
      case 'say': {
        const client = clients.get(step.who)!;
        const voice = CAST.find((c) => c.key === step.who)!.voice;
        const samples = await tts.render(voice, step.text);
        said.push({
          who: step.who,
          text: step.text,
          expect: step.expect,
          at: Date.now(),
          recording: recordingId,
        });
        log(`${client.name} says: ${step.text}`);
        await client.speak(samples);
        await sleep(700);
        break;
      }
      case 'type': {
        const client = clients.get(step.who)!;
        const parsed = parseComposerInput(step.text, {
          selfId: seats.get(step.who)!.userId,
          members,
        });
        said.push({
          who: step.who,
          text: step.text,
          expect: step.expect,
          at: Date.now(),
          recording: recordingId,
        });
        log(`${client.name} types: ${step.text}`);
        if (parsed.type === 'send') {
          client.send('chat.message', {
            campaignId,
            text: parsed.text,
            kind: parsed.kind,
            ...(parsed.lang ? { lang: parsed.lang } : {}),
          });
        } else if (parsed.type === 'whisper') {
          client.send('chat.message', { campaignId, text: parsed.text, to: parsed.recipientId });
        } else if (parsed.type === 'quick') {
          client.send('chat.message', { campaignId, text: parsed.text, kind: parsed.kind });
        } else {
          throw new Error(`composer refused "${step.text}": ${parsed.message}`);
        }
        await sleep(1200);
        break;
      }
    }
  }
  return recordingId;
}

// ---- processing -------------------------------------------------------------------------------

async function recordingStatus(token: string, campaignId: string, id: string): Promise<string> {
  const list = await ok('GET', `/api/campaigns/${campaignId}/recordings`, token);
  return ((list.recordings as Json[]).find((r) => r.id === id)?.status as string) ?? 'missing';
}

async function waitProcessed(token: string, campaignId: string, ids: string[]): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MIN * 60_000;
  let last = '';
  for (;;) {
    const states = await Promise.all(ids.map((id) => recordingStatus(token, campaignId, id)));
    const line = ids.map((id, i) => `${id.slice(0, 8)}=${states[i]}`).join(' ');
    if (line !== last) log(`processing: ${line}`);
    last = line;
    if (states.every((s) => s === 'processed' || s === 'failed')) return;
    if (Date.now() > deadline) throw new Error(`not processed within ${TIMEOUT_MIN} min: ${line}`);
    await sleep(5000);
  }
}

/** The durable-queue drill: kill the worker while it is on the job, start it again, the job finishes. */
async function killWorkerMidJob(token: string, campaignId: string, id: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while ((await recordingStatus(token, campaignId, id)) !== 'processing') {
    if (Date.now() > deadline) throw new Error('the worker never picked the job up');
    await sleep(1000);
  }
  await sleep(8000);
  log('drill: docker compose kill worker (mid-job)');
  const container = (await compose('ps', '-q', 'worker')).trim();
  await compose('kill', 'worker');
  metrics.workerKilledAt = Date.now();
  await sleep(3000);
  // `docker start`, not `docker compose start`/`up`: those re-run the one-shot services the worker
  // depends on (or recreate it), and this drill is about the same container coming back.
  await run('docker', ['start', container]);
  log('drill: worker started again; the job is picked up again once its lease runs out (≤ 5 min)');
}

// ---- verification -----------------------------------------------------------------------------

interface Utterance {
  speaker: { id: string; name: string };
  startMs: number;
  text: string;
  typed?: boolean;
}

async function verify(
  seats: Map<Who, Seat>,
  campaignId: string,
  recordings: { id: string; steps: readonly Step[] }[],
  said: Said[],
  lateAckMs: number | undefined,
): Promise<void> {
  const dm = seats.get('dm')!;
  const player = seats.get('aria')!;
  const base = `/api/campaigns/${campaignId}/recordings`;
  const everything: string[] = [];

  for (const { id, steps } of recordings) {
    const short = id.slice(0, 8);
    const dmView = await ok('GET', `${base}/${id}`, dm.token);
    const playerView = await ok('GET', `${base}/${id}`, player.token);
    check(`${short}: processed`, dmView.recording.status === 'processed', dmView.recording.status);

    const transcript = (await ok('GET', `${base}/${id}/transcript`, player.token))
      .utterances as Utterance[];
    // Kept for llm-bench.ts (the same transcript for every model) and for reading.
    await writeFile(
      path.join(STATE_DIR, `transcript-${id}.json`),
      JSON.stringify(transcript, null, 2),
    );
    await writeFile(
      path.join(STATE_DIR, `summaries-${id}.md`),
      (dmView.summaries as Json[])
        .map(
          (s) =>
            `## ${s.kind}${s.subject ? `: ${s.subject}` : ''} (${s.visibility})\n\n${s.text}\n`,
        )
        .join('\n'),
    );
    everything.push(...transcript.map((u) => u.text));
    const summaries = dmView.summaries as Json[];
    everything.push(...summaries.map((s) => s.text as string));

    // Speaker attribution and word accuracy, per speaker, against what the script said while recorded.
    const scored: Record<string, number> = {};
    for (const cast of CAST) {
      const userId = seats.get(cast.key)!.userId;
      const expected = steps
        .filter((s): s is Extract<Step, { do: 'say' }> => s.do === 'say')
        .filter((s) => s.who === cast.key && s.expect === 'captured')
        .map((s) => s.text)
        .join(' ');
      if (!expected) continue;
      const actual = transcript
        .filter((u) => u.speaker.id === userId && !u.typed)
        .map((u) => u.text)
        .join(' ');
      scored[cast.key] = Number(wordAccuracy(expected, actual).toFixed(3));
    }
    metrics[`accuracy-${short}`] = scored;
    const worst = Math.min(...Object.values(scored));
    check(
      `${short}: every speaker's words are attributed to them (word accuracy ≥ 0.85)`,
      worst >= 0.85,
      JSON.stringify(scored),
    );
    // Nothing anyone said ended up under someone else's name.
    const misattributed = transcript.filter((u) => {
      if (u.typed) return false;
      const owner = steps.find((s) => s.do === 'say' && wordAccuracy(s.text, u.text) > 0.6) as
        Extract<Step, { do: 'say' }> | undefined;
      return owner !== undefined && seats.get(owner.who)!.userId !== u.speaker.id;
    });
    check(
      `${short}: no line is attributed to the wrong speaker`,
      misattributed.length === 0,
      misattributed.map((u) => u.text).join(' | '),
    );

    // Typed in-character lines are on the timeline (transcript and, for search, as chat).
    const typedExpected = steps.filter(
      (s): s is Extract<Step, { do: 'type' }> => s.do === 'type' && s.expect === 'captured',
    );
    const typedSeen = transcript.filter((u) => u.typed).map((u) => u.text);
    metrics[`typed-${short}`] = typedSeen;
    for (const t of typedExpected) {
      const text = t.text.replace(/^\/(say|do)\s+/, '');
      check(
        `${short}: typed line "${text}" is in the transcript, attributed to ${t.who}`,
        transcript.some(
          (u) => u.typed && u.text.includes(text) && u.speaker.id === seats.get(t.who)!.userId,
        ),
      );
    }

    // Summaries: every kind, and the DM-only one for the DM alone.
    const kinds = summaries.map((s) => `${s.kind}${s.subject ? `:${s.subject}` : ''}`);
    metrics[`summaries-${short}`] = kinds;
    check(
      `${short}: session summary`,
      summaries.some((s) => s.kind === 'session'),
    );
    check(
      `${short}: DM-only summary (DM view)`,
      summaries.some((s) => s.kind === 'dm-only'),
    );
    const speakingCharacters = CAST.filter(
      (c) =>
        c.character &&
        steps.some(
          (s) => (s.do === 'say' || s.do === 'type') && s.who === c.key && s.expect === 'captured',
        ),
    ).map((c) => c.character!.name);
    for (const name of speakingCharacters) {
      check(
        `${short}: character summary for ${name}`,
        summaries.some((s) => s.kind === 'character' && s.subject === name),
      );
    }
    if (steps.some((s) => s.do === 'pause')) {
      check(
        `${short}: a chapter summary for each part either side of the pause`,
        summaries.filter((s) => s.kind === 'chapter').length >= 2,
        kinds.join(', '),
      );
    }
    check(
      `${short}: players never receive the DM-only summary`,
      !(playerView.summaries as Json[]).some((s) => s.kind === 'dm-only' || s.visibility === 'dm'),
    );
    const list = await ok('GET', base, player.token);
    const item = (list.recordings as Json[]).find((r) => r.id === id);
    check(
      `${short}: player's history list omits dm-only`,
      item && !item.summaries.includes('dm-only'),
    );

    // History detail: the bookmarks.
    const events = (dmView.events as Json[]).map((e) => e.event as string);
    const wanted = steps
      .filter((s) => ['start', 'pause', 'resume', 'stop'].includes(s.do))
      .map(
        (s) =>
          ({ start: 'started', pause: 'paused', resume: 'resumed', stop: 'stopped' })[
            s.do as 'start'
          ],
      );
    check(
      `${short}: history bookmarks ${wanted.join('/')}`,
      wanted.every((w) => events.includes(w)),
      events.join(','),
    );

    // The late joiner is not captured before acknowledging.
    if (lateAckMs !== undefined && steps.some((s) => s.do === 'late-join')) {
      const started = dmView.recording.startedAt as number;
      const cassId = seats.get('cass')!.userId;
      const first = transcript.find((u) => u.speaker.id === cassId && !u.typed);
      check(
        `${short}: late joiner's first captured words come after their acknowledgement`,
        first !== undefined && first.startMs >= lateAckMs - started - 1000,
        first
          ? `first at ${first.startMs} ms, ack at ${lateAckMs - started} ms`
          : 'no speech from them',
      );
    }
  }

  // Words that must be nowhere: transcripts, summaries (DM view: the superset), search for anyone.
  for (const word of FORBIDDEN) {
    const inText = everything.some((t) => containsWord(t, word));
    const hitsDm = (await ok('GET', `${base}/search?q=${word}`, dm.token)).hits as Json[];
    const hitsPlayer = (await ok('GET', `${base}/search?q=${word}`, player.token)).hits as Json[];
    const mine = (hits: Json[]) =>
      hits.filter((h) => recordings.some((r) => r.id === h.recordingId));
    check(
      `"${word}" (${said.find((s) => s.text.includes(word))?.text.slice(0, 40) ?? ''}…) appears nowhere`,
      !inText && mine(hitsDm).length === 0 && mine(hitsPlayer).length === 0,
    );
  }

  // Search finds a spoken phrase and a typed one, for a player (both are in recording A).
  if (recordings.some((r) => r.steps === RECORDING_A)) {
    const spoken = (
      await ok('GET', `${base}/search?q=${encodeURIComponent(SEARCH_SPOKEN)}`, player.token)
    ).hits as Json[];
    check(
      `search finds the spoken phrase "${SEARCH_SPOKEN}"`,
      spoken.some(
        (h) => h.source === 'transcript' && recordings.some((r) => r.id === h.recordingId),
      ),
    );
    const typed = (
      await ok('GET', `${base}/search?q=${encodeURIComponent(SEARCH_TYPED)}`, player.token)
    ).hits as Json[];
    check(
      `search finds the typed line "${SEARCH_TYPED}" as chat`,
      typed.some((h) => h.source === 'chat' && recordings.some((r) => r.id === h.recordingId)),
    );
  }
  // DM-only summaries never surface in a player's search.
  const dmOnly = (await ok('GET', `${base}/search?q=session`, player.token)).hits as Json[];
  check('player search never returns a DM-only summary', !dmOnly.some((h) => h.kind === 'dm-only'));
  // Someone outside the campaign gets nothing.
  const outsider = await api('GET', base, undefined);
  check(
    'the records API refuses an unauthenticated caller',
    outsider.status === 401,
    String(outsider.status),
  );
}

// ---- the remote-AI fallback drill -------------------------------------------------------------

async function fallbackDrill(
  token: string,
  campaignId: string,
  recordingId: string,
): Promise<void> {
  const before = await admin('settings', 'show');
  const value = (key: string) =>
    new RegExp(`^${key.replace(/\./g, '\\.')}\\s+(.*)$`, 'm').exec(before)?.[1]?.trim() ?? '';
  const restore: [string, string][] = [
    ['ai.transcription.kind', value('ai.transcription.kind')],
    ['ai.transcription.url', value('ai.transcription.url').replace('(none)', 'none')],
    ['ai.fallback.enabled', value('ai.fallback.enabled')],
    ['ai.fallback.after-seconds', value('ai.fallback.after-seconds')],
    ['ai.fallback.retry-seconds', value('ai.fallback.retry-seconds')],
  ];
  const since = new Date().toISOString();
  try {
    // Port 9 (discard) on the worker's own loopback: refused at once, like a gaming PC that is off.
    await admin('settings', 'set', 'ai.transcription.url', 'http://127.0.0.1:9');
    await admin('settings', 'set', 'ai.transcription.kind', 'remote');
    await admin('settings', 'set', 'ai.fallback.enabled', 'true');
    await admin('settings', 'set', 'ai.fallback.after-seconds', '20');
    await admin('settings', 'set', 'ai.fallback.retry-seconds', '5');
    await admin('recording', 'reprocess', recordingId, '--retranscribe');
    log('fallback drill: transcription points at an unreachable server; reprocessing recording B');
    const started = Date.now();
    await waitProcessed(token, campaignId, [recordingId]);
    const logs = await compose('logs', '--since', since, 'worker');
    const fell = logs.includes(`${recordingId}: transcription fell back to local`);
    metrics.fallbackSeconds = Math.round((Date.now() - started) / 1000);
    check(
      'fallback: an unreachable remote Whisper falls back to the local one after the timeout',
      fell,
    );
    check(
      'fallback: the recording is processed',
      (await recordingStatus(token, campaignId, recordingId)) === 'processed',
    );
  } finally {
    for (const [key, v] of restore) if (v) await admin('settings', 'set', key, v);
    log('fallback drill: AI settings restored');
  }
}

// ---- main -------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const health = await api('GET', '/api/health');
  if (health.status !== 200) throw new Error(`${API}/api/health → ${health.status}`);
  const state = await loadState();
  const { seats, campaignId } = await setUp(state);
  log(`campaign ${campaignId}; ${seats.size} people signed in`);

  const said: Said[] = [];
  let ids: string[];
  let lateAckMs: number | undefined;
  const verifyIds = option('--verify');
  if (verifyIds) {
    ids = verifyIds.split(',');
  } else {
    const tts = piperTts(path.join(STATE_DIR, 'tts-cache'));
    // Render every line first, so speech timing during the scene is not held up by the TTS.
    for (const s of [...RECORDING_A, ...RECORDING_B]) {
      if (s.do === 'say') await tts.render(CAST.find((c) => c.key === s.who)!.voice, s.text);
    }
    const clients = new Map<Who, TableClient>();
    try {
      for (const key of ['dm', 'aria', 'bram'] as const) {
        clients.set(key, await connect(seats.get(key)!, campaignId));
      }
      log(`DM, Aria and Bram connected (WebSocket + voice via ${String(metrics.livekitUrl)})`);
      const ctx = { seats, clients, campaignId, tts, said };
      const a = await playScene(RECORDING_A, ctx);
      lateAckMs = clients.get('cass')?.acks.get(a);
      await sleep(4000);
      const b = await playScene(RECORDING_B, ctx);
      ids = [a, b];
    } finally {
      for (const c of clients.values()) await c.close();
    }
    if (!flag('--no-kill')) await killWorkerMidJob(seats.get('dm')!.token, campaignId, ids[0]!);
  }

  const dmToken = seats.get('dm')!.token;
  const processingStarted = Date.now();
  await waitProcessed(dmToken, campaignId, ids);
  metrics.processingSeconds = Math.round((Date.now() - processingStarted) / 1000);
  if (!verifyIds && !flag('--no-kill')) {
    const attempts = await sql(
      `SELECT attempts FROM jobs WHERE recording_id = '${ids[0]}' AND kind = 'process-recording' ORDER BY created_at DESC LIMIT 1`,
    );
    check(
      'durable queue: the job interrupted by killing the worker completed on a later attempt',
      Number(attempts) >= 2,
      `attempts ${attempts}`,
    );
  }
  await verify(
    seats,
    campaignId,
    [
      { id: ids[0]!, steps: RECORDING_A },
      { id: ids[1]!, steps: RECORDING_B },
    ],
    said,
    lateAckMs,
  );
  if (flag('--fallback')) {
    await fallbackDrill(dmToken, campaignId, ids[1]!);
    await verify(seats, campaignId, [{ id: ids[1]!, steps: RECORDING_B }], said, undefined);
  }

  const failed = checks.filter((c) => !c.ok);
  const file = path.join(
    STATE_DIR,
    `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(
    file,
    JSON.stringify({ api: API, campaignId, recordings: ids, checks, metrics }, null, 2),
  );
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed. Results: ${file}`,
  );
  for (const f of failed) console.log(`  FAILED: ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 2;
  })
  .finally(() => setTimeout(() => process.exit(), 500).unref());
