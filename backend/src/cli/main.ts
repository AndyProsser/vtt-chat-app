#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { readFile, rename, rm, stat } from 'node:fs/promises';
import { Valkey } from 'iovalkey';

import {
  describeLocalAi,
  needsAttention,
  PostgresJobQueue,
  PostgresRecordsStore,
  readLocalAiStatus,
  shownState,
} from '@vtt-chat-app/ai';

import { AccountService } from '../lib/auth/accountService.js';
import { SignupService } from '../lib/auth/signupService.js';
import { loadConfig } from '../lib/config.js';
import {
  ArchiveError,
  exportCampaign,
  importCampaign,
  readArchive,
  unprocessedRecordings,
  writeArchive,
} from '../lib/campaigns/campaignArchive.js';
import { HandoutMediaSweeper } from '../lib/media/handoutMediaSweeper.js';
import { DiskMediaStorage } from '../lib/media/mediaStorage.js';
import { PostgresTableStore } from '../lib/table/postgresTableStore.js';
import { migrate } from '../lib/store/migrate.js';
import { createPool, PostgresStore } from '../lib/store/postgresStore.js';
import { runAdmin, type Probe } from './admin.js';
import { syncFromConfig } from '../lib/updates/runSync.js';

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
    // The local AI's models, as the records worker last reported them (it downloads them in the background on a
    // first start). Shown only when a worker has reported; FAIL when a download failed or stalled.
    const localAi = await readLocalAiStatus(pool).catch(() => null);
    if (localAi) {
      probes.push({
        name: 'local AI',
        run: async () => {
          const line = describeLocalAi(localAi, Date.now());
          const bad = [localAi.llm, localAi.whisper].some((model) =>
            needsAttention(shownState(model, localAi.at, Date.now())),
          );
          if (bad) throw new Error(`${line} (see: vtt-admin logs worker)`);
          return line;
        },
      });
    }

    const accounts = new AccountService({ store });
    return await runAdmin(process.argv.slice(2), {
      store,
      accounts,
      signups: new SignupService({ store, accounts }),
      jobs: new PostgresJobQueue(pool),
      records: new PostgresRecordsStore(pool),
      ...(config.updatesDir ? { updatesDir: config.updatesDir } : {}),
      ...(config.updatesSync
        ? {
            syncUpdates: () => syncFromConfig(config),
            updatesSource: config.updatesSync.source,
          }
        : {}),
      ...(config.recordingsDir ? { recordingsDir: config.recordingsDir } : {}),
      ...(config.mediaDir
        ? {
            sweepMedia: () =>
              new HandoutMediaSweeper(
                new PostgresTableStore(pool),
                new DiskMediaStorage(config.mediaDir!),
              ).sweep(0),
          }
        : {}),
      archive: {
        unprocessed: (id) => unprocessedRecordings(pool, id),
        export: async (id, file) => {
          const exported = await exportCampaign(pool, id);
          // Written beside the target and renamed, so a failure never leaves a half file under the real name.
          const partial = `${file}.partial`;
          try {
            const { missingMedia } = await writeArchive(
              exported,
              createWriteStream(partial, { mode: 0o600 }),
              config.mediaDir ? new DiskMediaStorage(config.mediaDir) : undefined,
            );
            await rename(partial, file);
            return { bytes: (await stat(file)).size, missingMedia };
          } catch (error) {
            await rm(partial, { force: true });
            throw error;
          }
        },
        import: async (file, options) => {
          let bytes: Buffer;
          try {
            bytes = await readFile(file);
          } catch {
            throw new ArchiveError(`cannot read ${file}`);
          }
          return importCampaign(pool, readArchive(bytes), {
            asNew: options.asNew,
            ...(config.mediaDir ? { media: new DiskMediaStorage(config.mediaDir) } : {}),
          });
        },
      },
      databaseBytes: async () => {
        const { rows } = await pool.query<{ size: string }>(
          'SELECT pg_database_size(current_database()) AS size',
        );
        return Number(rows[0]?.size ?? 0);
      },
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
