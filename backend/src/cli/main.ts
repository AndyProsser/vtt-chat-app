#!/usr/bin/env node
import { Valkey } from 'iovalkey';

import { PostgresJobQueue, PostgresRecordsStore } from '@vtt-chat-app/ai';

import { AccountService } from '../lib/auth/accountService.js';
import { loadConfig } from '../lib/config.js';
import { migrate } from '../lib/store/migrate.js';
import { createPool, PostgresStore } from '../lib/store/postgresStore.js';
import { runAdmin, type Probe } from './admin.js';

/**
 * `vtt-admin`: the operator's CLI. It talks to the database directly (whoever can run it already
 * controls the server), so it needs DATABASE_URL and no sign-in. In the Compose deployment:
 *
 *   docker compose exec backend node backend/dist/cli/main.js status
 */
async function main(): Promise<number> {
  const config = loadConfig();
  if (config.databaseUrl === undefined) {
    console.error(
      'DATABASE_URL is not set; the admin CLI works on the real database, never on memory.',
    );
    return 1;
  }
  const pool = createPool(config.databaseUrl);
  try {
    const applied = await migrate(pool);
    if (applied.length > 0) console.log(`applied migrations: ${applied.join(', ')}`);

    const store = new PostgresStore(pool);
    const probes: Probe[] = [
      {
        name: 'database',
        run: async () => {
          const { rows } = await pool.query<{ name: string }>(
            'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
          );
          return `reachable, schema ${rows[0]?.name ?? '(none)'}`;
        },
      },
    ];
    if (config.valkeyUrl !== undefined) {
      const valkeyUrl = config.valkeyUrl;
      probes.push({
        name: 'valkey',
        run: async () => {
          const client = new Valkey(valkeyUrl, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            connectTimeout: 3000,
          });
          try {
            await client.connect();
            return `${await client.ping()}`;
          } finally {
            client.disconnect();
          }
        },
      });
    }
    probes.push({
      name: 'livekit',
      run: async () => {
        // Defaults to the address clients use (proving the proxy path); LIVEKIT_HEALTH_URL overrides it.
        const url = process.env.LIVEKIT_HEALTH_URL ?? config.liveKitUrl.replace(/^ws/, 'http');
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        return `${url} answered ${response.status}`;
      },
    });

    return await runAdmin(process.argv.slice(2), {
      store,
      accounts: new AccountService({ store }),
      jobs: new PostgresJobQueue(pool),
      records: new PostgresRecordsStore(pool),
      probes,
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
