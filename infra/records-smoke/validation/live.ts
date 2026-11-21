// The live run: set up the demo campaign on a real server, play its sessions into it as five people would
// (the Game Master and four players speaking text-to-speech into the voice room, typing in chat, starting
// scenes and stingers, dropping loot), wait for the records pipeline, and score what comes out.
//
// Player 5 is the developer's own client: this runner makes an invite for them, waits for them to join, and
// otherwise leaves them alone. It sends nothing as them.
//
// Reuses the existing end-to-end client and speech (e2e/). Needs NODE_EXTRA_CA_CERTS for a server with a
// private certificate (the local Compose stack), as compose-e2e.ts does.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { parseComposerInput, type ChatMember } from '@vtt-chat-app/shared';

import type { Event, Loaded, Person, Report } from '../campaign-fixture.ts';
import { TableClient } from '../e2e/client.ts';
import { piperTts } from '../e2e/tts.ts';
import type { Monitor } from './monitor.ts';
import type { SessionPlan } from './plan.ts';
import type { Check } from './report.ts';
import {
  meanAccuracy,
  recall,
  scoreCallbacks,
  scoreCanaries,
  scoreFacts,
  scoreGlossary,
  speakerAccuracy,
  tobiasesKeptApart,
  type Artifact,
  type ArtifactKind,
} from './score.ts';
import type { Target } from './target.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loosely typed JSON from our own API
type Json = any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Score {
  name: string;
  value: string;
  detail?: string;
}

export interface LiveOptions {
  target: Target;
  monitor: Monitor;
  loaded: Loaded;
  report: Report;
  plan: SessionPlan[];
  sessions: number[];
  outDir: string;
  runLabel: string;
  /** off | corrections | prompt | both: set for the run and put back after. `keep` leaves the server's setting alone. */
  glossary: string;
  waitForObserver: boolean;
  /** Stop each session after this many lines (a smoke test of the machinery, not a real run). */
  maxLines?: number;
  timeoutMin: number;
  log: (line: string) => void;
}

export interface LiveResult {
  checks: Check[];
  scores: Score[];
  notes: string[];
  artifacts: Artifact[];
}

interface Seat {
  person: Person;
  password: string;
  token: string;
  userId: string;
  isDm: boolean;
}

export async function runLive(o: LiveOptions): Promise<LiveResult> {
  const { target, monitor, loaded: l, log } = o;
  const API = target.apiBase;
  const checks: Check[] = [];
  const scores: Score[] = [];
  const notes: string[] = [];
  const artifacts: Artifact[] = [];
  const check = (name: string, ok: boolean, detail?: string) => {
    checks.push({ name, status: ok ? 'pass' : 'fail', ...(detail ? { detail } : {}) });
    log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
  };

  const api = async (method: string, route: string, token?: string, body?: unknown) => {
    const res = await fetch(`${API}${route}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let parsed: Json = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed };
  };
  const ok = async (
    method: string,
    route: string,
    token?: string,
    body?: unknown,
  ): Promise<Json> => {
    const r = await api(method, route, token, body);
    if (r.status >= 300)
      throw new Error(`${method} ${route} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };

  // ---- preflight ----------------------------------------------------------------------------
  const cast = l.campaign.cast;
  const voicesDir = process.env.PIPER_VOICES ?? path.join(homedir(), '.local/share/piper-voices');
  const missing = [cast.dm, ...cast.players]
    .map((p) => p.voice)
    .filter((v): v is string => !!v && !existsSync(path.join(voicesDir, `${v}.onnx`)));
  if (missing.length)
    throw new Error(
      `missing piper voices: ${[...new Set(missing)].join(', ')} (in ${voicesDir}); see infra/records-smoke/README.md for the download`,
    );
  const health = await api('GET', '/api/health');
  if (health.status !== 200)
    throw new Error(`the server did not answer /api/health (${health.status})`);
  const tts = piperTts(path.join(homedir(), '.local/state/vtt-validation/tts-cache'));

  // ---- settings, put back at the end --------------------------------------------------------
  const settingsText = await target.admin('settings', 'show');
  const was = (key: string) =>
    new RegExp(`${key.replace(/\./g, '\\.')}\\s+(\\S+)`).exec(settingsText)?.[1];
  const restore: (() => Promise<void>)[] = [];
  const setSetting = async (key: string, value: string) => {
    const before = was(key);
    await target.admin('settings', 'set', key, value);
    if (before !== undefined && before !== value)
      restore.push(async () => void (await target.admin('settings', 'set', key, before)));
  };
  if (o.glossary !== 'keep') await setSetting('ai.transcription.glossary', o.glossary);
  await monitor.event('setting', { glossary: o.glossary });

  try {
    // ---- people -----------------------------------------------------------------------------
    const stateDir = path.join(homedir(), '.local/state/vtt-validation');
    const stateFile = path.join(stateDir, `accounts-${target.label}.json`);
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const saved: Record<string, string> = existsSync(stateFile)
      ? (JSON.parse(await readFile(stateFile, 'utf8')) as Record<string, string>)
      : {};
    const people: { p: Person; isDm: boolean }[] = [
      { p: cast.dm, isDm: true },
      ...cast.players.map((p) => ({ p, isDm: false })),
    ];
    const seats = new Map<string, Seat>();
    for (const { p, isDm } of people) {
      const password = (saved[p.email] ??= randomBytes(18).toString('base64url'));
      let login = await api('POST', '/api/auth/login', undefined, { email: p.email, password });
      if (!(login.status === 200 && login.body?.sessionToken)) {
        const users = await target.admin('user', 'list');
        if (!users.includes(p.email))
          await target.admin('user', 'create', p.email, '--name', p.name, '--accept-consent');
        const code = (await target.admin('user', 'code', p.email, 'reset'))
          .trim()
          .split('\n')
          .pop()!
          .trim();
        login = {
          status: 200,
          body: await ok('POST', '/api/auth/magic-link/redeem', undefined, {
            token: code,
            newPassword: password,
          }),
        };
      }
      const token = login.body.sessionToken as string;
      const me = await ok('GET', '/api/auth/me', token);
      seats.set(p.name, { person: p, password, token, userId: me.user.id as string, isDm });
    }
    await writeFile(stateFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
    await chmod(stateFile, 0o600);
    const dm = seats.get(cast.dm.name)!;

    // ---- the campaign -----------------------------------------------------------------------
    const closed = /campaign-creation\s+closed/.test(settingsText);
    if (closed) await target.admin('settings', 'set', 'campaign-creation', 'open');
    let campaignId: string;
    try {
      campaignId = (
        await ok('POST', '/api/campaigns', dm.token, { name: `${l.campaign.name} (${o.runLabel})` })
      ).campaign.id as string;
    } finally {
      if (closed) await target.admin('settings', 'set', 'campaign-creation', 'closed');
    }
    await monitor.event('campaign', { campaignId });
    log(`campaign ${campaignId}`);
    const invite = (await ok('POST', `/api/campaigns/${campaignId}/invites`, dm.token, {}))
      .code as string;
    for (const pl of cast.players) {
      const seat = seats.get(pl.name)!;
      await ok('POST', '/api/campaigns/join', seat.token, { code: invite });
      const created = (
        await ok('POST', `/api/campaigns/${campaignId}/characters`, seat.token, {
          name: pl.character!.name,
          className: pl.character!.class,
          race: pl.character!.race,
          level: 3,
        })
      ).character;
      await ok('PUT', `/api/campaigns/${campaignId}/active-character`, seat.token, {
        characterId: created.id,
      });
    }
    for (const g of l.campaign.glossary)
      await ok('POST', `/api/campaigns/${campaignId}/gm/glossary`, dm.token, g);
    await ok('PUT', `/api/campaigns/${campaignId}/gm/notes`, dm.token, { body: l.gmNotes });
    await ok('PATCH', `/api/campaigns/${campaignId}`, dm.token, { bard: l.campaign.storyteller });
    notes.push(
      `The campaign "${l.campaign.name} (${o.runLabel})" has ${l.campaign.glossary.length} glossary terms and the GM notes. It stays on the server after the run: delete it with \`vtt-admin campaign delete ${campaignId}\`.`,
    );

    // ---- player 5 ---------------------------------------------------------------------------
    if (o.waitForObserver) {
      const code = (await ok('POST', `/api/campaigns/${campaignId}/invites`, dm.token, {}))
        .code as string;
      log(
        `PLAYER 5: join the campaign "${l.campaign.name} (${o.runLabel})" with the invite code ${code} (waiting up to 10 minutes)`,
      );
      const deadline = Date.now() + 10 * 60_000;
      let joined = false;
      while (Date.now() < deadline) {
        const m = (await ok('GET', `/api/campaigns/${campaignId}/members`, dm.token))
          .members as Json[];
        if (m.length >= cast.players.length + 2) {
          joined = true;
          break;
        }
        await sleep(5000);
      }
      check(
        'player 5 (the developer) joined the campaign',
        joined,
        joined ? undefined : 'nobody joined in 10 minutes; the run goes on without them',
      );
    }

    // ---- soundboard library ---------------------------------------------------------------------
    const lib = (await ok('GET', '/api/soundboard/library', dm.token)) as Json;
    const sceneId = (name: string) =>
      (lib.scenes as Json[]).find((s) => String(s.name).toLowerCase() === name.toLowerCase())
        ?.id as string | undefined;
    const soundOf = (arg: string) => {
      const [board, label] = arg.split('>').map((x) => x.trim().toLowerCase());
      const b = (lib.boards as Json[]).find((x) => String(x.name).toLowerCase() === board);
      return (b?.buttons as Json[] | undefined)?.find(
        (x) => String(x.label).toLowerCase() === label,
      )?.soundId as string | undefined;
    };

    const members: ChatMember[] = people.map(({ p, isDm }) => ({
      id: seats.get(p.name)!.userId,
      name: p.name,
      characterName: p.character?.name ?? null,
      role: isDm ? 'dm' : 'player',
    }));

    // ---- the sessions -----------------------------------------------------------------------
    const recordingIds = new Map<number, string>();
    const memoryAfter: Record<number, string> = {};
    const spokenByWho = new Map<number, Record<string, string>>();
    for (const n of o.sessions) {
      const events = (o.report.parsed.get(n)?.events ?? []).slice(0, o.maxLines ?? Infinity);
      const sessionPlan = o.plan.find((p) => p.n === n)!;
      const titled = l.campaign.sessions.find((s) => s.n === n)?.title ?? `session ${n}`;
      await monitor.setPhase(`session-${n}-recording`, titled);
      log(
        `session ${n} "${titled}": ${events.length} lines (planned ${Math.round(sessionPlan.estimatedSec / 60)} min)`,
      );

      // Render all the speech first, so a slow voice cannot stretch the gaps between lines.
      for (const e of events)
        if (e.kind === 'say')
          await tts.render(
            cast.players.concat([cast.dm]).find((p) => p.name === e.who)!.voice!,
            e.text,
          );

      const lateJoiners = new Set(
        events
          .filter((e) => e.kind === 'directive' && e.name === 'late-join')
          .map((e) => (e as Extract<Event, { name: string }>).arg),
      );
      const clients = new Map<string, TableClient>();
      const connect = async (name: string, autoAck: boolean) => {
        const seat = seats.get(name)!;
        const c = new TableClient(name, seat.userId, seat.token, campaignId, log);
        c.autoAck = autoAck;
        await c.connect(API);
        const v = await ok('POST', `/api/campaigns/${campaignId}/voice-token`, seat.token, {});
        await c.joinVoice(process.env.VTT_LIVEKIT_URL ?? v.url, v.token);
        clients.set(name, c);
        return c;
      };
      for (const { p } of people) if (!lateJoiners.has(p.name)) await connect(p.name, true);

      let recordingId = '';
      let recording = false;
      const control = async (action: string) => {
        const r = await ok('POST', `/api/campaigns/${campaignId}/recording`, dm.token, { action });
        recordingId = r.recordingId as string;
      };
      const said: Record<string, string[]> = {};
      const began = Date.now();
      let i = 0;
      for (const e of events) {
        i += 1;
        const drift = (Date.now() - began) / 1000 - (sessionPlan.steps[i - 1]?.atSec ?? 0);
        if (i % 25 === 0)
          await monitor.event('progress', {
            session: n,
            line: i,
            of: events.length,
            driftSec: Math.round(drift),
          });
        const dropped = [...clients.values()].filter((c) => c.dropped).map((c) => c.name);
        if (dropped.length)
          throw new Error(
            `the server closed the connection of ${dropped.join(', ')} mid-session (a restart?)`,
          );
        if (e.kind === 'directive') {
          const arg = e.arg;
          switch (e.name) {
            case 'start': {
              await control('start');
              recording = true;
              const present = [...clients.values()];
              const deadline = Date.now() + 15_000;
              while (present.some((c) => !c.acks.has(recordingId)) && Date.now() < deadline)
                await sleep(200);
              check(
                `session ${n}: every connected client acknowledged the start cue`,
                present.every((c) => c.acks.has(recordingId)),
              );
              await sleep(6000);
              break;
            }
            case 'stop':
              await sleep(3000);
              await control('stop');
              recording = false;
              break;
            case 'pause':
            case 'resume':
              await control(e.name);
              break;
            case 'scene': {
              const id = sceneId(arg);
              if (!id) check(`session ${n}: scene "${arg}" is in the DM's library`, false);
              else clients.get(cast.dm.name)!.send('scene.start', { campaignId, sceneId: id });
              await sleep(1500);
              break;
            }
            case 'stinger': {
              const id = soundOf(arg);
              if (!id) check(`session ${n}: stinger "${arg}" is in the DM's library`, false);
              else clients.get(cast.dm.name)!.send('sound.play', { campaignId, soundId: id });
              await sleep(700);
              break;
            }
            case 'loot': {
              const [item, who] = arg.split('|').map((x) => x.trim()) as [string, string];
              const coin = /^(\d+)\s*gp$/i.exec(item);
              const qty = /^(.*?)\s+x(\d+)$/i.exec(item);
              await ok('POST', `/api/campaigns/${campaignId}/loot`, dm.token, {
                ...(coin
                  ? {
                      kind: 'coin',
                      name: 'Gold pieces',
                      quantity: Number(coin[1]),
                      itemType: 'coin',
                    }
                  : {
                      kind: 'item',
                      name: qty ? qty[1] : item,
                      quantity: qty ? Number(qty[2]) : 1,
                    }),
                ...(who.toLowerCase() !== 'party' ? { assignTo: seats.get(who)!.userId } : {}),
              });
              await sleep(1000);
              break;
            }
            case 'late-join': {
              const c = await connect(arg, false);
              const state = c.frames.find((f) => f.t === 'recording.state')?.d.recording as Json;
              check(
                `session ${n}: ${arg} joining late is told a recording is in progress and has not acknowledged it`,
                state?.status === 'IN-PROGRESS' && state?.acknowledged === false,
              );
              await sleep(6000);
              break;
            }
            case 'ack':
              clients.get(arg)!.ack(recordingId);
              clients.get(arg)!.autoAck = true;
              break;
            case 'leave':
              await clients.get(arg)!.close();
              clients.delete(arg);
              await sleep(2000);
              break;
            case 'rejoin':
              await connect(arg, true);
              await sleep(2000);
              break;
          }
          continue;
        }
        const client = clients.get(e.who);
        if (!client) throw new Error(`${e.who} is not connected at line ${e.line}`);
        if (e.kind === 'say') {
          const voice = cast.players.concat([cast.dm]).find((p) => p.name === e.who)!.voice!;
          if (e.expect === 'captured') (said[e.who] ??= []).push(e.text);
          await client.speak(await tts.render(voice, e.text));
          if (!e.over) await sleep(700);
        } else {
          const parsed = parseComposerInput(e.text, { selfId: seats.get(e.who)!.userId, members });
          if (parsed.type === 'send')
            client.send('chat.message', {
              campaignId,
              text: parsed.text,
              kind: parsed.kind,
              ...(parsed.lang ? { lang: parsed.lang } : {}),
            });
          else if (parsed.type === 'whisper')
            client.send('chat.message', { campaignId, text: parsed.text, to: parsed.recipientId });
          else if (parsed.type === 'quick')
            client.send('chat.message', { campaignId, text: parsed.text, kind: parsed.kind });
          else throw new Error(`the composer refused "${e.text}": ${parsed.message}`);
          await sleep(1200);
        }
      }
      // A truncated session (--max-lines) never reached its [stop].
      if (recording) {
        await sleep(3000);
        await control('stop');
      }
      for (const c of clients.values()) await c.close();
      recordingIds.set(n, recordingId);
      spokenByWho.set(
        n,
        Object.fromEntries(Object.entries(said).map(([k, v]) => [k, v.join(' ')])),
      );
      scores.push({
        name: `session ${n}: played`,
        value: `${Math.round((Date.now() - began) / 60000)} min`,
        detail: `planned ${Math.round(sessionPlan.estimatedSec / 60)} min`,
      });

      // ---- processing ------------------------------------------------------------------------
      await monitor.setPhase(`session-${n}-processing`, 'transcription and summaries');
      const deadline = Date.now() + o.timeoutMin * 60_000;
      const t1 = Date.now();
      for (;;) {
        const list = await ok('GET', `/api/campaigns/${campaignId}/recordings`, dm.token);
        const st = (list.recordings as Json[]).find((r) => r.id === recordingId)?.status as
          string | undefined;
        if (st === 'processed' || st === 'failed') {
          check(`session ${n}: the recording was processed`, st === 'processed', st);
          break;
        }
        if (Date.now() > deadline) {
          check(
            `session ${n}: the recording was processed`,
            false,
            `still ${st} after ${o.timeoutMin} min`,
          );
          break;
        }
        await sleep(5000);
      }
      scores.push({
        name: `session ${n}: processing time`,
        value: `${Math.round((Date.now() - t1) / 1000)} s`,
      });

      // ---- collect ---------------------------------------------------------------------------
      const base = `/api/campaigns/${campaignId}/recordings/${recordingId}`;
      const detail = await ok('GET', base, dm.token);
      const transcript = ((await api('GET', `${base}/transcript`, dm.token)).body?.utterances ??
        []) as Json[];
      await mkdir(path.join(o.outDir, 'outputs'), { recursive: true });
      await writeFile(
        path.join(o.outDir, 'outputs', `session-${n}-transcript.json`),
        JSON.stringify(transcript, null, 2),
      );
      artifacts.push({
        name: `transcript ${n}`,
        kind: 'transcript',
        session: n,
        text: transcript.map((u) => u.text).join('\n'),
      });
      const kinds: Record<string, ArtifactKind> = {
        session: 'tale',
        chapter: 'chapter',
        character: 'character',
        'dm-only': 'brief',
        notes: 'notes',
      };
      for (const s of (detail.summaries ?? []) as Json[]) {
        artifacts.push({
          name: `${s.kind} ${n}${s.subject ? ` (${s.subject})` : ''}`,
          kind: kinds[s.kind as string] ?? 'other',
          session: n,
          text: String(s.text),
        });
      }
      await writeFile(
        path.join(o.outDir, 'outputs', `session-${n}-summaries.md`),
        ((detail.summaries ?? []) as Json[])
          .map(
            (s) =>
              `## ${s.kind}${s.subject ? `: ${s.subject}` : ''} (${s.visibility})\n\n${s.text}\n`,
          )
          .join('\n'),
      );
      memoryAfter[n] = await target.admin('memory', 'show', campaignId).catch(() => '');
      await writeFile(path.join(o.outDir, 'outputs', `session-${n}-memory.txt`), memoryAfter[n]);
      artifacts.push({
        name: `memory after ${n}`,
        kind: 'memory',
        session: n,
        text: memoryAfter[n],
      });

      // ---- per-session scores ----------------------------------------------------------------
      const f = scoreFacts(
        l.facts[String(n)] ?? [],
        artifacts
          .filter((a) => a.session === n && a.kind === 'notes')
          .map((a) => a.text)
          .join('\n'),
      );
      const all = recall(f);
      scores.push({
        name: `session ${n}: facts in the scribe's notes`,
        value: `${all.found} of ${all.total}`,
        detail: `core ${recall(f, 'core').found}/${recall(f, 'core').total}, subtle ${recall(f, 'subtle').found}/${recall(f, 'subtle').total}; missed: ${
          f
            .filter((x) => !x.found)
            .map((x) => x.id)
            .join(', ') || 'none'
        }`,
      });
      const byUser: Record<string, string> = {};
      for (const u of transcript)
        if (!u.typed) byUser[u.speaker.id] = `${byUser[u.speaker.id] ?? ''} ${u.text}`;
      const acc = speakerAccuracy(
        spokenByWho.get(n) ?? {},
        Object.fromEntries(
          people.map(({ p }) => [p.name, byUser[seats.get(p.name)!.userId] ?? '']),
        ),
      );
      scores.push({
        name: `session ${n}: word accuracy per speaker`,
        value: Object.entries(acc)
          .map(([k, v]) => `${k} ${v.toFixed(2)}`)
          .join(', '),
      });
      const spoken = events
        .filter(
          (e): e is Extract<Event, { who: string }> => e.kind === 'say' && e.expect === 'captured',
        )
        .map((e) => e.text)
        .join(' ');
      const gs = scoreGlossary(
        l.campaign.glossary,
        spoken,
        transcript
          .filter((u) => !u.typed)
          .map((u) => u.text)
          .join(' '),
      );
      const mean = meanAccuracy(gs);
      scores.push({
        name: `session ${n}: glossary terms heard right`,
        value: mean === undefined ? '–' : `${(mean * 100).toFixed(0)} %`,
        detail: `worst: ${gs
          .sort((a, b) => a.accuracy - b.accuracy)
          .slice(0, 6)
          .map(
            (x) =>
              `${x.term} ${x.exact}/${x.expected}${Object.keys(x.heard).length ? ` (heard as ${Object.keys(x.heard).join(', ')})` : ''}`,
          )
          .join('; ')}`,
      });
    }

    // ---- across the whole run -----------------------------------------------------------------
    const search = async (word: string, token: string) =>
      ((
        await api(
          'GET',
          `/api/campaigns/${campaignId}/recordings/search?q=${encodeURIComponent(word)}`,
          token,
        )
      ).body?.hits ?? []) as Json[];
    const player = seats.get(cast.players[0]!.name)!;
    const words = [
      ...l.campaign.canaries.filter((c) => o.sessions.includes(c.session)).map((c) => c.word),
      ...l.campaign.gmCanaries.map((c) => c.word),
    ];
    for (const w of words) {
      for (const [who, token] of [
        ['the Game Master', dm.token],
        ['a player', player.token],
      ] as const) {
        const hits = await search(w, token);
        if (hits.length)
          artifacts.push({
            name: `search for "${w}" as ${who}`,
            kind: 'search',
            text: JSON.stringify(hits),
          });
      }
    }
    const tableWords = l.campaign.canaries
      .filter((c) => o.sessions.includes(c.session))
      .map((c) => c.word);
    const leaks = scoreCanaries(tableWords, artifacts);
    check(
      'no table canary reached the transcript, notes, tales, brief, memory or search',
      leaks.length === 0,
      leaks.map((x) => `${x.word} in ${x.where}`).join('; '),
    );
    const gmLeaks = scoreCanaries(
      l.campaign.gmCanaries.map((c) => c.word),
      artifacts.filter((a) => a.kind === 'tale' || a.kind === 'chapter' || a.kind === 'character'),
    );
    check(
      'no GM-notes secret reached a tale (storyteller: the Tavern Bard)',
      gmLeaks.length === 0,
      gmLeaks.map((x) => `${x.word} in ${x.where}`).join('; '),
    );

    const last = Math.max(...o.sessions);
    const cbScores = scoreCallbacks(l.callbacks.callbacks, memoryAfter, artifacts);
    const memOk = cbScores.filter((c) => c.memory).length;
    const weaveKnown = cbScores.filter((c) => c.weave !== undefined);
    scores.push({
      name: 'callbacks: in campaign memory when they should be',
      value: `${memOk} of ${cbScores.length}`,
      detail: `missing: ${
        cbScores
          .filter((c) => !c.memory)
          .map((c) => c.id)
          .join(', ') || 'none'
      }`,
    });
    scores.push({
      name: 'callbacks: connected back in the later tale or brief',
      value: `${weaveKnown.filter((c) => c.weave).length} of ${weaveKnown.length}`,
      detail: `not connected: ${
        weaveKnown
          .filter((c) => !c.weave)
          .map((c) => c.id)
          .join(', ') || 'none'
      }. Read the tales: a pattern cannot judge a connection.`,
    });
    if (o.sessions.includes(3)) {
      const t = tobiasesKeptApart(memoryAfter[last] ?? '');
      check('the two Tobiases are separate entries in campaign memory', t.apart, t.detail);
    }
    await writeFile(
      path.join(o.outDir, 'outputs', 'callbacks.json'),
      JSON.stringify(cbScores, null, 2),
    );
    return { checks, scores, notes, artifacts };
  } finally {
    for (const r of restore.reverse()) await r().catch(() => {});
  }
}
