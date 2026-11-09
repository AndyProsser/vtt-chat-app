import type { StatusSnapshot } from '../types/index.js';

export async function fetchStatus(signal?: AbortSignal): Promise<StatusSnapshot> {
  const response = await fetch('/api/status', { signal: signal ?? null });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return (await response.json()) as StatusSnapshot;
}
