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
  StatusService,
  measureDisk,
  AvatarSweeper,
  createSmtpMailTransport,
  type StatusProbe,
  CampaignService,
  DdbSyncService,
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
import { syncFromConfig } from './lib/updates/runSync.js';

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
  let valkey: Valkey | undefined;
  if (config.valkeyUrl !== undefined) {
    valkey = new Valkey(config.valkeyUrl);
    replay = new ValkeyReplayBuffer(keyValueFromRedisClient(valkey as unknown as RedisClientLike));
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
  const audioRouter = createLiveKitAudioRouter({
    apiUrl: config.liveKitApiUrl,
    apiKey: config.liveKitApiKey,
    apiSecret: config.liveKitApiSecret,
  });
  const parties = new PartyService({
    store,
    router: audioRouter,
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
    onMemberRemoved: (campaignId, userId) => void audioRouter.remove?.(campaignId, userId),
    onRecordingChange: (change) => capture?.onRecordingChange(change),
    onRecordingAck: (campaignId) => capture?.onAck(campaignId),
    onTableEvent: (campaignId, type, data) => capture?.onTableEvent(campaignId, type, data),
    onPublicChat: (campaignId, line) => capture?.onChat(campaignId, line),
    recordingGraceMs: config.recordingGraceSeconds * 1000,
  });
  hubRef.current = hub;
  if (config.recordingsDir !== undefined && pool !== undefined) {
    capture = new RecordingCapture({
      recorder: createLiveKitRecorder({
        apiUrl: config.liveKitApiUrl,
        apiKey: config.liveKitApiKey,
        apiSecret: config.liveKitApiSecret,
        includeEffects: config.recordSoundboard,
      }),
      records,
      jobs: new PostgresJobQueue(pool),
      acks,
      purgeOnNextSession: async () => (await store.getSettings()).audioPurgeOnNextSession === 'on',
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
  // Pictures nobody uses any more (replaced portraits, uploads never saved) are removed daily.
  if (media) {
    const sweeper = new AvatarSweeper(store, media);
    const sweep = () =>
      void sweeper
        .sweep()
        .then((n) => n > 0 && console.log(`[backend] removed ${n} unused portrait(s)`))
        .catch(() => undefined);
    setTimeout(sweep, 60_000).unref();
    setInterval(sweep, 24 * 3_600_000).unref();
  }
  // Keep the client update feed in step with GitHub releases (UPDATES_SOURCE): once shortly after start, then every
  // 6 hours. A failure (GitHub unreachable, a file that does not verify) is logged and the current feed keeps serving.
  if (config.updatesSync) {
    const syncOnce = () =>
      void syncFromConfig(config)
        .then((r) => {
          if (!r) return;
          console.log(
            `[backend] updates (${config.updatesSync?.source}): offering ${r.release ?? 'nothing new'}` +
              (r.downloaded.length ? `, downloaded ${r.downloaded.length} file(s)` : '') +
              (r.removed.length ? `, removed ${r.removed.join(', ')}` : ''),
          );
          for (const s of r.skipped) console.warn(`[backend] updates: skipped ${s}`);
        })
        .catch((error: unknown) =>
          console.warn(
            `[backend] updates sync failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    setTimeout(syncOnce, 30_000).unref();
    setInterval(syncOnce, 6 * 3_600_000).unref();
  }
  // Optional D&D Beyond character sync: off unless the operator turns it on; refreshed hourly.
  const ddb = new DdbSyncService({
    store,
    campaigns: new CampaignService({ store }),
    enabled: config.ddbSync.enabled,
    intervalMs: config.ddbSync.intervalHours * 3_600_000,
    ...(media ? { media } : {}),
    onChanged: (campaignId) =>
      void Promise.resolve(hub.announceRosterChanged(campaignId)).catch(() => undefined),
  });
  if (ddb.enabled) {
    setInterval(() => void ddb.syncDue().catch(() => undefined), 3_600_000).unref();
    console.log(
      `[backend] D&D Beyond sync on: linked characters refresh every ${config.ddbSync.intervalHours} h`,
    );
  }
  // Public status page data: coarse health of what the backend depends on.
  const statusProbes: StatusProbe[] = [];
  const dbPool = pool;
  if (dbPool)
    statusProbes.push({ name: 'database', run: async () => void (await dbPool.query('SELECT 1')) });
  const cache = valkey;
  if (cache) statusProbes.push({ name: 'valkey', run: async () => void (await cache.ping()) });
  statusProbes.push({
    name: 'livekit',
    run: async () => {
      const url = process.env.LIVEKIT_HEALTH_URL ?? config.liveKitApiUrl;
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.status >= 500) throw new Error(`status ${response.status}`);
    },
  });
  const status = new StatusService({
    probes: statusProbes,
    onlinePlayers: () => hub.presence.onlineUsers(),
    activeRecordings: () => hub.recording.activeCount(),
    ...(pool ? { jobs: new PostgresJobQueue(pool) } : {}),
    ...(config.recordingsDir !== undefined
      ? { storage: () => measureDisk(config.recordingsDir as string) }
      : {}),
  });
  const app = createApp({
    config,
    store,
    ddb,
    status,
    ...(config.smtp ? { sender: createSmtpMailTransport(config.smtp.url, config.smtp.from) } : {}),
    realtime: hub,
    recording: hub.recording,
    records,
    ...(pool ? { jobs: new PostgresJobQueue(pool) } : {}),
    table,
    sounds,
    schedule,
    onNotified: () => void relay.flush().catch(() => undefined),
    ...(media ? { media } : {}),
  });
  const server = createServer(app);
  const trusted = app.get('trust proxy fn') as (address: string, hop: number) => boolean;
  attachWebSocketServer(server, hub, { trustProxy: (address) => trusted(address, 0) });

  server.listen(config.port, () => {
    console.log(`backend listening on :${config.port} (REST /api, WebSocket /ws)`);
  });
}
