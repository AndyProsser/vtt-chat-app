// Brings the seeded mock players to life so there is activity to look at: they come online in every
// campaign they belong to (so switching campaigns shows a populated table), join voice (real
// LiveKit participants publishing synthetic "speech"), take turns talking, chat, whisper the DM now
// and then, and report link stats. A seat that drops (backend restart, network) reconnects by
// itself. The `dm` account is yours and is never mocked. Stop with Ctrl+C.
//
//   npm run dev:mock [-- --no-voice] [-- --quiet]
//
// Needs: the backend and `livekit-server --dev` running, and `npm run dev:seed` done once.
// The DM account is yours: sign in to the app as dm@vtt.test and watch the table.

import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';

import { API, call, loadState, signIn, sleep, type Person, type Session } from './lib.ts';

const args = new Set(process.argv.slice(2));
const VOICE = !args.has('--no-voice');
const QUIET = args.has('--quiet');
const log = (...a: unknown[]) => QUIET || console.log(new Date().toLocaleTimeString(), ...a);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

const LINES: Record<string, string[]> = {
  aria: [
    'I will scout ahead. Quietly.',
    'Anyone else smell brine?',
    'Arrow nocked. Say the word.',
    'The water is moving against the current.',
  ],
  bram: [
    'Hold the line, I have a prayer ready.',
    'That inscription is older than the temple.',
    'Let me tend that wound.',
    'Light the way, Cassiel?',
  ],
  cass: [
    'My patron is... uneasy about this place.',
    'Something is whispering under the floor.',
    'Eldritch Blast at the ready.',
    'I do not like those statues.',
  ],
  dorn: [
    'Doors are just walls that haven’t committed yet.',
    'I’ll take the front.',
    'Is that a lever or a trap? Both?',
    'Second breakfast after this.',
  ],
};
const WHISPERS = [
  'Do you trust the priest?',
  'I think the key is cursed.',
  'Psst — look at the third statue.',
];

interface Mock {
  session: Session;
  key: string;
  campaignId: string;
  ws: WebSocket;
  room?: Room;
  source?: AudioSource;
  talking: boolean;
  pitch: number;
}

function wsUrl(): string {
  return `${API.replace(/^http/, 'ws')}/ws`;
}

function send(mock: Mock, t: string, d: Record<string, unknown>): void {
  if (mock.ws.readyState === WebSocket.OPEN) mock.ws.send(JSON.stringify({ v: 1, t, d }));
}

async function connectWs(token: string): Promise<WebSocket> {
  const ws = new WebSocket(wsUrl());
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket failed to open')), {
      once: true,
    });
  });
  const ok = new Promise<void>((resolve, reject) => {
    ws.addEventListener('message', function onMessage(e) {
      const frame = JSON.parse(String(e.data));
      if (frame.t === 'auth.ok') {
        ws.removeEventListener('message', onMessage);
        resolve();
      } else if (frame.t === 'error') reject(new Error(frame.d?.message ?? 'auth failed'));
    });
  });
  ws.send(JSON.stringify({ v: 1, t: 'auth', d: { token } }));
  await ok;
  return ws;
}

/** Ten milliseconds of a vowel-ish tone: a few harmonics with a slow syllable-like wobble. */
function speechFrame(pitch: number, t0: number): AudioFrame {
  const samples = new Int16Array(480);
  for (let i = 0; i < samples.length; i += 1) {
    const t = t0 + i / 48_000;
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 3.5 * t);
    let v = 0;
    for (const [harmonic, gain] of [
      [1, 1],
      [2, 0.5],
      [3, 0.3],
      [4, 0.15],
    ] as const) {
      v += gain * Math.sin(2 * Math.PI * pitch * harmonic * t);
    }
    samples[i] = Math.round((v / 2) * syllable * 12_000);
  }
  return new AudioFrame(samples, 48_000, 1, 480);
}

async function joinVoice(mock: Mock, campaignId: string): Promise<void> {
  const r = await call('POST', `/api/campaigns/${campaignId}/voice-token`, mock.session.token, {});
  if (r.status !== 200) throw new Error(`voice token ${r.status}`);
  const room = new Room();
  await room.connect(r.body.url, r.body.token, { autoSubscribe: false, dynacast: false });
  const source = new AudioSource(48_000, 1);
  const track = LocalAudioTrack.createAudioTrack('microphone', source);
  await room.localParticipant!.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );
  mock.room = room;
  mock.source = source;
  send(mock, 'audio.state', { campaignId, inVoice: true, muted: false });
}

async function talk(mock: Mock, campaignId: string): Promise<void> {
  const seconds = rand(2, 6);
  mock.talking = true;
  send(mock, 'speaking.set', { campaignId, speaking: true });
  log(`${mock.key} talks for ${seconds.toFixed(1)}s`);
  const start = Date.now();
  let produced = 0;
  while (Date.now() - start < seconds * 1000 && mock.source) {
    // Keep ~100 ms ahead of real time so the stream is continuous without flooding the queue.
    while (produced < (Date.now() - start) / 10 + 10) {
      void mock.source.captureFrame(speechFrame(mock.pitch, produced / 100));
      produced += 1;
    }
    await sleep(20);
  }
  mock.talking = false;
  send(mock, 'speaking.set', { campaignId, speaking: false });
}

async function live(mock: Mock, dmId: string): Promise<void> {
  const { campaignId } = mock;
  const stats = {
    rtt: rand(15, 70),
    jitter: rand(1, 12),
    loss: Math.random() < 0.2 ? rand(1, 6) : 0,
  };
  const report = () => {
    stats.rtt = Math.max(5, stats.rtt + rand(-8, 8));
    stats.jitter = Math.max(0.5, stats.jitter + rand(-2, 2));
    send(mock, 'stats.report', {
      campaignId,
      rttMs: stats.rtt,
      jitterMs: stats.jitter,
      packetLossPct: stats.loss,
    });
  };
  report();
  const timer = setInterval(report, 5000);
  try {
    while (mock.ws.readyState === WebSocket.OPEN) {
      await sleep(rand(6, 20) * 1000);
      if (mock.ws.readyState !== WebSocket.OPEN) break;
      const roll = Math.random();
      if (VOICE && mock.source && roll < 0.6) await talk(mock, campaignId);
      else if (roll < 0.9)
        send(mock, 'chat.message', { campaignId, text: pick(LINES[mock.key] ?? ['…']) });
      else if (dmId) send(mock, 'chat.message', { campaignId, text: pick(WHISPERS), to: dmId });
    }
  } finally {
    clearInterval(timer);
  }
}

interface Seat {
  person: Person;
  campaignId: string;
  name: string;
  pitch: number;
}

/** One person at one table, for as long as the script runs: reconnects after any drop. */
async function sit(seat: Seat, open: Mock[]): Promise<void> {
  for (;;) {
    let mock: Mock | undefined;
    try {
      const session = await signIn(seat.person);
      const members = await call('GET', `/api/campaigns/${seat.campaignId}/members`, session.token);
      const dmId =
        (members.body.members ?? []).find((m: { role: string; userId: string }) => m.role === 'dm')
          ?.userId ?? '';
      const ws = await connectWs(session.token);
      mock = {
        session,
        key: seat.person.key,
        campaignId: seat.campaignId,
        ws,
        talking: false,
        pitch: seat.pitch,
      };
      open.push(mock);
      ws.send(JSON.stringify({ v: 1, t: 'resume', d: { campaignId: seat.campaignId } }));
      if (VOICE)
        await joinVoice(mock, seat.campaignId).catch((e) =>
          log(`${seat.person.key}: no voice in ${seat.name} (${e.message})`),
        );
      log(`${seat.person.key} is at "${seat.name}"${mock.room ? ' (in voice)' : ''}`);
      await live(mock, dmId);
      log(`${seat.person.key} lost "${seat.name}"; reconnecting`);
    } catch (e) {
      log(`${seat.person.key} cannot sit at "${seat.name}" (${(e as Error).message}); retrying`);
    } finally {
      if (mock) {
        open.splice(open.indexOf(mock), 1);
        try {
          await mock.room?.disconnect();
        } catch {
          /* already gone */
        }
        mock.ws.close();
      }
    }
    await sleep(5000);
  }
}

async function main(): Promise<void> {
  const state = loadState();
  const open: Mock[] = [];
  const seats: Seat[] = [];
  for (const [i, person] of state.people.filter((p) => p.role === 'player').entries()) {
    const session = await signIn(person);
    const mine = await call('GET', '/api/campaigns', session.token);
    for (const c of mine.body.campaigns ?? [])
      seats.push({
        person,
        campaignId: c.campaign.id,
        name: c.campaign.name,
        pitch: 110 + i * 37,
      });
  }
  if (seats.length === 0)
    throw new Error('no campaigns for the mock players: run `npm run dev:seed`');
  console.log(
    `\n${seats.length} seats across ${new Set(seats.map((s) => s.campaignId)).size} campaigns` +
      `${VOICE ? ' (with voice)' : ''}. Ctrl+C to send everyone home.`,
  );

  const stop = async () => {
    for (const m of [...open]) {
      try {
        await m.room?.disconnect();
      } catch {
        /* leaving anyway */
      }
      m.ws.close();
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  await Promise.all(seats.map((seat) => sit(seat, open)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
