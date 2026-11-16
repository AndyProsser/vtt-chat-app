import type { StatusSnapshot } from '../types/index.js';

export async function fetchStatus(signal?: AbortSignal): Promise<StatusSnapshot> {
  const response = await fetch('/api/status', { signal: signal ?? null });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return (await response.json()) as StatusSnapshot;
}

/** What `GET /api/version` returns: the release the server runs and its wire protocol. */
export interface ServerVersion {
  version: string;
  protocol: number;
}

export async function fetchVersion(signal?: AbortSignal): Promise<ServerVersion> {
  const response = await fetch('/api/version', { signal: signal ?? null });
  if (!response.ok) throw new Error(`version ${response.status}`);
  return (await response.json()) as ServerVersion;
}
