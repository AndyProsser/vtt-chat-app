export * from './types/index.js';
export * from './consts/index.js';
export * from './lib/index.js';

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  AccountService,
  attachWebSocketServer,
  createApp,
  Hub,
  loadConfig,
  MemoryReplayBuffer,
  MemoryStore,
} from './lib/index.js';

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const config = loadConfig();
  // The Postgres adapter and Valkey-backed buffer aren't written yet (ROADMAP Stage 3), so state
  // lives in memory and is lost on restart. Say so loudly rather than let it look like persistence.
  console.warn(
    '[backend] using in-memory stores: accounts, campaigns and chat are lost on restart',
  );

  const store = new MemoryStore();
  const hub = new Hub({
    store,
    accounts: new AccountService({ store }),
    replay: new MemoryReplayBuffer(),
  });
  const server = createServer(createApp({ config, store, realtime: hub }));
  attachWebSocketServer(server, hub);

  server.listen(config.port, () => {
    console.log(`backend listening on :${config.port} (REST /api, WebSocket /ws)`);
  });
}
