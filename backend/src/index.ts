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
} from './lib/index.js';

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const config = loadConfig();
  let store: Store;
  if (config.databaseUrl !== undefined) {
    const pool = createPool(config.databaseUrl);
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
  const hub = new Hub({
    store,
    accounts: new AccountService({ store }),
    replay,
  });
  const server = createServer(
    createApp({ config, store, realtime: hub, recording: hub.recording }),
  );
  attachWebSocketServer(server, hub);

  server.listen(config.port, () => {
    console.log(`backend listening on :${config.port} (REST /api, WebSocket /ws)`);
  });
}
