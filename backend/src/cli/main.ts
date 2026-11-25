#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { lookup, Resolver } from 'node:dns/promises';
import { readFile, rename, rm, stat } from 'node:fs/promises';
import { Valkey } from 'iovalkey';

import {
  describeLocalAi,
  needsAttention,
  PostgresJobQueue,
  PostgresRecordsStore,
  readLocalAiStatus,
  runAiTest,
  shownState,
} from '@vtt-chat-app/ai';
import { EgressClient, RoomServiceClient } from 'livekit-server-sdk';

import { AccountService } from '../lib/auth/accountService.js';
import { SignupService } from '../lib/auth/signupService.js';
import { loadConfig } from '../lib/config.js';
import { checkReach, type VoiceTarget, type WebTarget } from '../lib/selftest/reach.js';
import { routerWanAddress, type RouterAddress } from '../lib/selftest/router.js';
import { serverCountry } from '../lib/selftest/nodes.js';
import { startUdpEcho } from '../lib/selftest/udpEcho.js';
import { stunPublicAddress } from '../lib/selftest/stun.js';
import { checkVoice } from '../lib/selftest/voice.js';
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
import { adminHost, helpWidth } from './help.js';
import { createUi } from './ui.js';
import { readMachine } from '../lib/status/machine.js';
import { serverVersion } from '../lib/version.js';
import { syncFromConfig } from '../lib/updates/runSync.js';

/**
 * `vtt-admin`: the operator's CLI. It talks to the database directly (whoever can run it already
 * controls the server), so it needs DATABASE_URL and no sign-in. In the Compose deployment:
 *
 *   docker compose exec backend node backend/dist/cli/main.js status
 */
/** What a name resolves to for the rest of the internet: public resolvers first (your own DNS may answer differently inside your network), your own as the fallback. */
const lookupAll = async (host: string): Promise<string[]> => {
  try {
    const resolver = new Resolver({ timeout: 3000, tries: 1 });
    resolver.setServers(['1.1.1.1', '8.8.8.8']);
    const found = await resolver.resolve4(host);
    if (found.length > 0) return found;
  } catch {
    /* fall through to the system resolver */
  }
  return (await lookup(host, { all: true })).map((a) => a.address);
};

/** In a container the router cannot be asked (multicast stays on the bridge), so the wrapper script asks from the host's network and passes the answer in. */
const routerFromHost = async (): Promise<RouterAddress | undefined> => {
  if (process.env.VTT_ADMIN_HOST !== 'compose') return routerWanAddress();
  const [address, via] = (process.env.VTT_ROUTER_WAN ?? '').split(' ');
  return address && (via === 'UPnP' || via === 'NAT-PMP') ? { address, via } : undefined;
};

async function main(): Promise<number> {
  if (process.argv[2] === 'udp-echo') {
    // Internal: used by the vtt-admin wrapper, run with the host's network. Prints the port, answers UDP there for 90 s, exits.
    const echo = await startUdpEcho({ lifetimeMs: 90_000 });
    if (!echo) return 1;
    console.log(echo.port);
    await new Promise((r) => setTimeout(r, 90_000));
    await echo.close();
    return 0;
  }
  if (process.argv[2] === 'router-address') {
    // Internal: used by the vtt-admin wrapper, run with the host's network. Prints "<address> <UPnP|NAT-PMP>", or nothing.
    const r = await routerWanAddress();
    if (r) console.log(`${r.address} ${r.via}`);
    return 0;
  }
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
    // `vtt-admin test`. On a Compose install AI is tested inside the worker's container (the wrapper runs it there), because
    // that is where Whisper's and Ollama's addresses and the API keys are; a native install has them in this process.
    const records = new PostgresRecordsStore(pool);
    const liveKitApi = config.liveKitApiUrl;
    const selfTest = {
      publicUrl: process.env.PUBLIC_URL ?? '',
      voice: () =>
        checkVoice({
          healthUrl: process.env.LIVEKIT_HEALTH_URL ?? liveKitApi,
          publicUrl: config.liveKitUrl,
          listRooms: () =>
            new RoomServiceClient(
              liveKitApi,
              config.liveKitApiKey,
              config.liveKitApiSecret,
            ).listRooms(),
          listEgress: () =>
            new EgressClient(
              liveKitApi,
              config.liveKitApiKey,
              config.liveKitApiSecret,
            ).listEgress(),
          recordingConfigured: Boolean(config.recordingsDir),
        }),
      voiceAddress: process.env.VOICE_ADDRESS ?? '',
      voiceTcpPort: Number(process.env.VOICE_TCP_PORT) || 7881,
      reach: async (targets: { web: WebTarget; voice: VoiceTarget }) => {
        // The UDP echo must listen on the machine's own network: natively that is here, in Compose the wrapper starts one on
        // the host and passes its port in.
        const fromWrapper = Number(process.env.VTT_UDP_PROBE_PORT) || undefined;
        const echo =
          !fromWrapper && process.env.VTT_ADMIN_HOST !== 'compose'
            ? await startUdpEcho()
            : undefined;
        const port = fromWrapper ?? echo?.port;
        try {
          return await checkReach({
            ...targets,
            ...(port ? { udpProbe: { port } } : {}),
            locate: async () => {
              const own = await stunPublicAddress();
              return own ? serverCountry(own) : undefined;
            },
            network: {
              resolve: lookupAll,
              publicAddress: () => stunPublicAddress(),
              routerAddress: routerFromHost,
            },
          });
        } finally {
          await echo?.close();
        }
      },
      ...(process.env.VTT_ADMIN_HOST === 'compose'
        ? {}
        : {
            ai: async (flags: { local: boolean; remote: boolean; cloud: boolean }) =>
              runAiTest(flags, { settings: await records.getAiSettings(), env: process.env }),
          }),
    };
    return await runAdmin(process.argv.slice(2), {
      selfTest,
      store,
      accounts,
      signups: new SignupService({ store, accounts }),
      jobs: new PostgresJobQueue(pool),
      records,
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
      localAi,
      ui: createUi({
        isTTY: process.stdout.isTTY,
        env: process.env,
        width: helpWidth(process.env.COLUMNS, process.stdout.columns),
      }),
      version: serverVersion(),
      machine: async () => {
        const places = [
          { label: 'system', path: '/' },
          ...(config.recordingsDir ? [{ label: 'recordings', path: config.recordingsDir }] : []),
          ...(config.mediaDir ? [{ label: 'handouts', path: config.mediaDir }] : []),
          ...(config.updatesDir ? [{ label: 'updates', path: config.updatesDir }] : []),
        ];
        const machine = await readMachine(places);
        // Inside a container the hostname is the container's id; the wrapper passes the real one.
        return { ...machine, hostname: process.env.VTT_HOST_NAME || machine.hostname };
      },
      host: adminHost(process.env.VTT_ADMIN_HOST),
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
