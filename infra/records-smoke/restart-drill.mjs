import { AccessToken } from 'livekit-server-sdk';
import {
  Room,
  AudioSource,
  LocalAudioTrack,
  AudioFrame,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { MemoryRecordsStore, MemoryJobQueue } from '@vtt-chat-app/ai';
import { RecordingCapture } from '../../backend/dist/lib/recording/capture.js';
import { createLiveKitRecorder } from '../../backend/dist/lib/recording/liveKitRecorder.js';
import { MemoryAckStore } from '../../backend/dist/lib/recording/ackStore.js';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Live restart drill (ROADMAP Stage 9): see restart-drill.sh, which sets up LiveKit and Egress and runs this.
const D = process.argv[2];
const PORT = process.env.DRILL_PORT ?? '17880';
const API = `http://127.0.0.1:${PORT}`,
  WS = `ws://127.0.0.1:${PORT}`,
  KEY = 'devkey',
  SECRET = 'devsecret-devsecret-devsecret-1234';
const RUN = Date.now().toString(36); // unique per run: LiveKit keeps finished egresses in Redis
const CAMPAIGN = `drill-${RUN}`,
  REC = `rec-${RUN}`,
  ANN = 'ann-0000-1111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A speaker publishing a tone.
const at = new AccessToken(KEY, SECRET, { identity: ANN, name: 'Ann' });
at.addGrant({ roomJoin: true, room: CAMPAIGN });
const room = new Room();
await room.connect(WS, await at.toJwt(), { autoSubscribe: false });
const source = new AudioSource(48000, 1);
await room.localParticipant.publishTrack(
  LocalAudioTrack.createAudioTrack('microphone', source),
  new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
);
let stop = false,
  produced = 0;
const t0 = Date.now();
const pump = (async () => {
  while (!stop) {
    while (produced < (Date.now() - t0) / 10 + 10) {
      const s = new Int16Array(480);
      for (let i = 0; i < 480; i++)
        s[i] = Math.round(9000 * Math.sin(2 * Math.PI * 220 * ((produced * 480 + i) / 48000)));
      void source.captureFrame(new AudioFrame(s, 48000, 1, 480));
      produced++;
    }
    await sleep(20);
  }
})();

const records = new MemoryRecordsStore();
const jobs = new MemoryJobQueue();
const acks = new MemoryAckStore();
const recorder = createLiveKitRecorder({ apiUrl: API, apiKey: KEY, apiSecret: SECRET });
const log = (l) => console.log('  [capture]', l);
const mk = () =>
  new RecordingCapture({
    recorder,
    records,
    jobs,
    acks,
    dir: `${D}/rec/`,
    speakerName: async (_c, id) => `name-of-${id}`,
    log,
  });

const first = mk();
first.onRecordingChange({ campaignId: CAMPAIGN, recordingId: REC, event: 'STARTED' });
await first.idle();
await acks.ack(CAMPAIGN, REC, ANN);
first.onAck(CAMPAIGN);
await first.idle();
console.log('capturing; egresses on record:', (await recorder.orphans(CAMPAIGN)).length);
await sleep(7000);

console.log('--- RESTART: the first process is gone, LiveKit and Egress keep running ---');
const rows = await records.listRecordings(10);
console.log(
  'db says:',
  rows.map((r) => r.status),
);
const fresh = mk();
const n = await fresh.recoverInterrupted();
await fresh.idle();
console.log('recovered:', n);
const rec = await records.getRecording(REC);
console.log('status:', rec.status, 'stoppedAt set:', rec.stoppedAt !== null);
const tracks = await records.listTracks(REC);
console.log(
  'tracks:',
  tracks.map((t) => ({ speaker: t.speakerId, file: t.filePath })),
);
console.log(
  'events:',
  (await records.listRecordingEvents(REC)).map((e) => e.event),
);
console.log('jobs queued:', (await jobs.list()).length);
for (const t of tracks) {
  const exists = existsSync(t.filePath);
  console.log('file exists:', exists);
  if (exists)
    console.log(
      'duration:',
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        t.filePath,
      ])
        .toString()
        .trim(),
    );
}
const left = await recorder.orphans(CAMPAIGN);
const states = [];
for (const o of left) states.push((await recorder.result(o.egressId)).state);
console.log('egress states after recovery:', states);
const ok =
  rec.status === 'stopped' &&
  tracks.length > 0 &&
  tracks.every((t) => existsSync(t.filePath)) &&
  (await jobs.list()).length === 1 &&
  states.every((x) => x === 'complete');
console.log(ok ? 'DRILL PASSED' : 'DRILL FAILED');
stop = true;
await pump;
await room.disconnect();
process.exit(ok ? 0 : 1);
