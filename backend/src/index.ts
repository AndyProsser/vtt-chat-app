export * from './types/index.js';
export * from './consts/index.js';
export * from './lib/index.js';

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { Valkey } from 'iovalkey';

import {
  AccountService,
  attachWebSocketServer,
  createApp,
  Hub,
  loadConfig,
  MemoryReplayBuffer,
  MemoryStore,
  migrate,
  PostgresStore,
  createPool,
  keyValueFromRedisClient,
  ValkeyReplayBuffer,
  type RedisClientLike,
  type ReplayBuffer,
  type Store,
  MemoryAckStore,
  RecordingCapture,
  createLiveKitRecorder,
  DiskMediaStorage,
  MemoryScheduleStore,
  PartyService,
  createLiveKitAudioRouter,
  MemorySoundStore,
  NotificationRelay,
  PostgresScheduleStore,
  ScheduleService,
  MemoryTableStore,
  PostgresSoundStore,
  PostgresTableStore,
} from './lib/index.js';
import {
  MemoryRecordsStore,
  PostgresJobQueue,
  PostgresRecordsStore,
  type RecordsStore,
} from '@vtt-chat-app/ai';
import type pg from 'pg';

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const config = loadConfig();
  let store: Store;
  let pool: pg.Pool | undefined;
  if (config.databaseUrl !== undefined) {
    pool = createPool(config.databaseUrl);
    const applied = await migrate(pool);
    if (applied.length > 0) console.log(`[backend] applied migrations: ${applied.join(', ')}`);
    store = new PostgresStore(pool);
  } else {
    // Valkey-backed replay isn't wired in yet either; both are lost on restart.
    console.warn(
      '[backend] DATABASE_URL not set: using in-memory stores, accounts and campaigns are lost on restart',
    );
    store = new MemoryStore();
  }
  let replay: ReplayBuffer;
  if (config.valkeyUrl !== undefined) {
    replay = new ValkeyReplayBuffer(
      keyValueFromRedisClient(new Valkey(config.valkeyUrl) as unknown as RedisClientLike),
    );
  } else {
    console.warn('[backend] VALKEY_URL not set: replay buffer is in-memory, lost on restart');
    replay = new MemoryReplayBuffer();
  }
  const records: RecordsStore = pool ? new PostgresRecordsStore(pool) : new MemoryRecordsStore();
  const table = pool ? new PostgresTableStore(pool) : new MemoryTableStore();
  const sounds = pool ? new PostgresSoundStore(pool) : new MemorySoundStore();
  const schedule = pool ? new PostgresScheduleStore(pool) : new MemoryScheduleStore();
  const media = config.mediaDir ? new DiskMediaStorage(config.mediaDir) : undefined;
  // The acknowledgement store is shared: the hub records who heard the cue, and audio capture only
  // starts a player's track once they have.
  const acks = new MemoryAckStore();
  let capture: RecordingCapture | undefined;
  // Voice groups: enforced through LiveKit when it is reachable (the same server the recorder uses).
  const hubRef: { current?: Hub } = {};
  const parties = new PartyService({
    store,
    router: createLiveKitAudioRouter({
      apiUrl: config.liveKitApiUrl,
      apiKey: config.liveKitApiKey,
      apiSecret: config.liveKitApiSecret,
    }),
    emit: (campaignId, type, data) => hubRef.current?.broadcastToCampaign(campaignId, type, data),
    log: (line) => console.warn(`[parties] ${line}`),
  });
  parties.startTicking();
  const hub = new Hub({
    store,
    accounts: new AccountService({ store }),
    replay,
    acks,
    sounds,
    schedule,
    parties,
    onRecordingChange: (change) => capture?.onRecordingChange(change),
    onRecordingAck: (campaignId) => capture?.onAck(campaignId),
  });
  hubRef.current = hub;
  if (config.recordingsDir !== undefined && pool !== undefined) {
    capture = new RecordingCapture({
      recorder: createLiveKitRecorder({
        apiUrl: config.liveKitApiUrl,
        apiKey: config.liveKitApiKey,
        apiSecret: config.liveKitApiSecret,
      }),
      records,
      jobs: new PostgresJobQueue(pool),
      acks,
      dir: config.recordingsDir,
      speakerName: async (campaignId, accountId) => {
        const membership = await store.getMembership(campaignId, accountId);
        const character = membership?.activeCharacterId
          ? await store.getCharacter(membership.activeCharacterId)
          : undefined;
        return character?.name ?? (await store.getUser(accountId))?.displayName ?? accountId;
      },
      log: (line) => console.log(`[recording] ${line}`),
    });
    const interrupted = await capture.recoverInterrupted();
    if (interrupted > 0)
      console.warn(`[backend] ${interrupted} recording(s) were cut off by a restart`);
    capture.startTicking();
    console.log(`[backend] audio capture on: recordings go to ${config.recordingsDir}`);
  } else {
    console.warn(
      '[backend] RECORDINGS_DIR not set (or no database): recording is a state flag only, no audio is captured',
    );
  }
  // Notifications are stored first and pushed after; the records worker writes them too, so the relay
  // also runs on a timer. Reminders are checked once a minute.
  const relay = new NotificationRelay({
    schedule,
    sendToUser: (id, t, d) => hub.sendToUser(id, t, d),
  });
  relay.start();
  const reminders = new ScheduleService({
    store,
    schedule,
    onNotified: () => void relay.flush().catch(() => undefined),
  });
  setInterval(() => void reminders.sendDueReminders().catch(() => undefined), 60_000).unref();
  const server = createServer(
    createApp({
      config,
      store,
      realtime: hub,
      recording: hub.recording,
      records,
      table,
      sounds,
      schedule,
      onNotified: () => void relay.flush().catch(() => undefined),
      ...(media ? { media } : {}),
    }),
  );
  attachWebSocketServer(server, hub);

  server.listen(config.port, () => {
    console.log(`backend listening on :${config.port} (REST /api, WebSocket /ws)`);
  });
}
