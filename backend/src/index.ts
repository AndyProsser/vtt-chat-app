export * from './types/index.js';
export * from './consts/index.js';
export * from './lib/index.js';

import { pathToFileURL } from 'node:url';

import { createApp, loadConfig, MemoryStore } from './lib/index.js';

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const config = loadConfig();
  // The Postgres adapter isn't written yet (ROADMAP Stage 3), so state lives in memory and is lost
  // on restart. Say so loudly rather than let it look like persistence.
  console.warn('[backend] using the in-memory store: accounts and campaigns are lost on restart');
  const app = createApp({ config, store: new MemoryStore() });
  app.listen(config.port, () => {
    console.log(`backend listening on :${config.port}`);
  });
}
