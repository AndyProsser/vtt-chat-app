export interface ServiceStatus {
  name: string;
  ok: boolean;
}

export interface Pipeline {
  queued: number;
  running: number;
  failed: number;
  last: { state: 'done' | 'failed'; at: number } | null;
}

/** What `GET /api/status` returns. */
export interface StatusSnapshot {
  at: number;
  ok: boolean;
  services: ServiceStatus[];
  players: { online: number };
  recording: { active: number };
  pipeline: Pipeline | null;
  storage: { freePercent: number; low: boolean } | null;
}
