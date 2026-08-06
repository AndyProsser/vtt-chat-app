export * from './types/index.js';
export * from './consts/index.js';
export * from './lib/index.js';

import { pathToFileURL } from 'node:url';

import { createApp, loadConfig } from './lib/index.js';

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const config = loadConfig();
  createApp(config).listen(config.port, () => {
    console.log(`backend listening on :${config.port}`);
  });
}
