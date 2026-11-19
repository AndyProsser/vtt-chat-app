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
  recording: { active: number; processing?: 'local' | 'offsite' };
  pipeline: Pipeline | null;
  storage: { freePercent: number; low: boolean } | null;
  /** The local AI's models (downloaded in the background on a first start); null when nothing is reported. */
  localAi?: { summaryModel: ModelView | null; whisper: ModelView | null } | null;
}

export interface ModelView {
  state: 'ready' | 'downloading' | 'waiting' | 'failed' | 'stalled';
  percent?: number;
}
