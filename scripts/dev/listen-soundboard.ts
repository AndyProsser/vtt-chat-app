// Dev check for the DM's soundboard track: joins the room as a mock player, waits for a track named
// "soundboard", listens for a couple of seconds and reports how loud it was and how much of it was a
// 440 Hz tone. Used with the ignored Rust test `the_soundboard_track_reaches_other_participants`.
//
//   node scripts/dev/listen-soundboard.ts            (needs the seeded campaign and `livekit-server --dev`)

import { AudioStream, Room, RoomEvent, TrackKind } from '@livekit/rtc-node';

import { call, loadState, signIn } from './lib.ts';

const state = loadState();
const person = state.people.find((p) => p.key === 'aria')!;
const session = await signIn(person);
const voice = await call(
  'POST',
  `/api/campaigns/${state.campaignId}/voice-token`,
  session.token,
  {},
);
const room = new Room();
await room.connect(voice.body.url, voice.body.token, { autoSubscribe: true });
console.log('listening as', person.key);

const samples: number[] = [];
let rate = 48_000;
const done = new Promise<void>((resolve) => {
  const timeout = setTimeout(() => resolve(), 22_000);
  room.on(RoomEvent.TrackSubscribed, (track, publication) => {
    console.log(
      'track subscribed:',
      publication.name,
      track.kind === TrackKind.KIND_AUDIO ? 'audio' : 'other',
    );
    if (publication.name !== 'soundboard' || track.kind !== TrackKind.KIND_AUDIO) return;
    void (async () => {
      // An idle track can end its stream (no packets while nothing plays): listen again until the
      // effect arrives or time runs out.
      const until = Date.now() + 20_000;
      while (Date.now() < until && samples.length < rate * 3) {
        const stream = new AudioStream(track);
        for await (const frame of stream) {
          rate = frame.sampleRate;
          for (let i = 0; i < frame.data.length; i += frame.channels)
            samples.push(frame.data[i]! / 32768);
          if (samples.length > rate * 8) break;
        }
        console.log('stream ended; have', (samples.length / rate).toFixed(2), 's of audio');
        await new Promise((r) => setTimeout(r, 200));
      }
      clearTimeout(timeout);
      resolve();
    })();
  });
});
await done;
await room.disconnect();

// Loudness over time, in half-second windows: shows when the tone arrived.
const window = Math.floor(rate / 2);
const rmsOf = (xs: number[]) =>
  Math.sqrt(xs.reduce((n, v) => n + v * v, 0) / Math.max(1, xs.length));
console.log(
  'rms per 0.5s:',
  Array.from(
    { length: Math.floor(samples.length / window) },
    (_, i) => +rmsOf(samples.slice(i * window, (i + 1) * window)).toFixed(3),
  ).join(' '),
);
const rms = Math.sqrt(samples.reduce((n, s) => n + s * s, 0) / Math.max(1, samples.length));
const goertzel = (freq: number) => {
  const w = (2 * Math.PI * freq) / rate;
  let s1 = 0;
  let s2 = 0;
  for (const x of loud) {
    const s0 = x + 2 * Math.cos(w) * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return (2 * Math.sqrt(s1 * s1 + s2 * s2 - 2 * Math.cos(w) * s1 * s2)) / Math.max(1, loud.length);
};
// Analyse the loudest second only (the track also carries silence before and after the effect).
let bestStart = 0;
let bestRms = 0;
for (let start = 0; start + rate <= samples.length; start += Math.floor(rate / 10)) {
  const r = rmsOf(samples.slice(start, start + rate));
  if (r > bestRms) {
    bestRms = r;
    bestStart = start;
  }
}
const loud = samples.slice(bestStart, bestStart + rate);
const crossings = loud.slice(1).filter((v, i) => loud[i]! <= 0 && v > 0).length;
console.log(
  'estimated pitch of the loudest second:',
  Math.round(crossings / (loud.length / rate)),
  'Hz',
);
let peak = { freq: 0, level: 0 };
for (let f = 300; f <= 700; f += 1) {
  const level = goertzel(f);
  if (level > peak.level) peak = { freq: f, level };
}
console.log(
  'strongest frequency in the loudest second:',
  peak.freq,
  'Hz at level',
  +peak.level.toFixed(3),
  `(sample rate ${rate})`,
);
console.log(
  JSON.stringify({
    heard: samples.length > 0,
    seconds: +(samples.length / rate).toFixed(2),
    rms: +rms.toFixed(4),
    at440: +goertzel(440).toFixed(4),
    at1000: +goertzel(1000).toFixed(4),
  }),
);
process.exit(0);
