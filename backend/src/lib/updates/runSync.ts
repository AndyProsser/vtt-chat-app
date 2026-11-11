import type { BackendConfig } from '../config.js';
import { serverVersion } from '../version.js';
import { syncUpdates, type SyncResult } from './sync.js';

/** Where release installers come from unless `UPDATES_GITHUB_REPO` says otherwise. */
export const DEFAULT_UPDATES_REPO = 'AndyProsser/vtt-chat-app';

/** The server's release line, e.g. "0.3" from "0.3.2" (or "0.3.2-dev.1"), or undefined if the version is unknown. */
export function releaseLine(version: string): string | undefined {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(version);
  return m ? `${m[1]}.${m[2]}` : undefined;
}

/** One sync of the update feed with GitHub, as the operator configured it. `undefined` when sync is not enabled. */
export async function syncFromConfig(
  config: Pick<BackendConfig, 'updatesDir' | 'updatesSync'>,
  version = serverVersion(),
): Promise<SyncResult | undefined> {
  const sync = config.updatesSync;
  if (!sync || !config.updatesDir) return undefined;
  const line = releaseLine(version);
  if (!line)
    throw new Error(
      `this server's version ("${version}") is not MAJOR.MINOR.PATCH, so it cannot pick a release line`,
    );
  return syncUpdates({
    source: sync.source,
    repo: sync.repo,
    line,
    dir: config.updatesDir,
    ...(sync.publicUrl ? { baseUrl: `${sync.publicUrl.replace(/\/$/, '')}/updates` } : {}),
    includeDev: sync.includeDev,
    publicKey: sync.publicKey,
  });
}
