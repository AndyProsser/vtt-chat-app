import type { SyncEvent } from '../types/index.js';

/** One player's link as the server last relayed it (to the DM only). */
export interface LinkStatsView {
  rttMs: number;
  jitterMs: number;
  packetLossPct: number;
  at: number;
  /** Recent round-trip samples, oldest first, for the sparkline. */
  history?: readonly number[];
  /** The link quality at each of those samples, so the trace can change colour as it recovers. */
  qualities?: readonly Quality[];
}

/** About two minutes of samples at the 5-second report rate. */
export const HISTORY_LENGTH = 24;

export type Quality = 'good' | 'fair' | 'poor' | 'unknown';

/** Thresholds for open-mic voice: round trip, jitter and loss each can make a link fair or poor. */
export function linkQuality(stats: LinkStatsView | undefined): Quality {
  if (!stats) return 'unknown';
  if (stats.rttMs > 250 || stats.jitterMs > 50 || stats.packetLossPct > 5) return 'poor';
  if (stats.rttMs > 120 || stats.jitterMs > 30 || stats.packetLossPct > 2) return 'fair';
  return 'good';
}

export function describeLink(stats: LinkStatsView | undefined): string {
  if (!stats) return '—';
  const loss = Math.round(stats.packetLossPct * 10) / 10;
  return `${Math.round(stats.rttMs)} ms · jitter ${Math.round(stats.jitterMs)} ms · ${loss}% loss`;
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});

function asStats(v: unknown): LinkStatsView | undefined {
  const o = asObj(v);
  const nums = [o.rttMs, o.jitterMs, o.packetLossPct];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  return {
    rttMs: o.rttMs as number,
    jitterMs: o.jitterMs as number,
    packetLossPct: o.packetLossPct as number,
    at: typeof o.at === 'number' ? o.at : 0,
  };
}

/** Appends this sample to the previous history, unless it is the same report seen again. */
function withHistory(stats: LinkStatsView, previous: LinkStatsView | undefined): LinkStatsView {
  const repeat = previous !== undefined && previous.at === stats.at && stats.at !== 0;
  if (repeat)
    return { ...stats, history: previous.history ?? [], qualities: previous.qualities ?? [] };
  const history = [...(previous?.history ?? []), stats.rttMs].slice(-HISTORY_LENGTH);
  const qualities = [...(previous?.qualities ?? []), linkQuality(stats)].slice(-HISTORY_LENGTH);
  return { ...stats, history, qualities };
}

/** Folds one feed event into the per-player stats map; returns the same map when nothing changed. */
export function applyStatsEvent(
  map: ReadonlyMap<string, LinkStatsView>,
  event: SyncEvent,
): ReadonlyMap<string, LinkStatsView> {
  const d = asObj(event.d);
  if (event.t === 'snapshot' || event.t === 'roster.update') {
    const next = new Map<string, LinkStatsView>();
    for (const m of Array.isArray(d.members) ? d.members : []) {
      const member = asObj(m);
      const stats = asStats(member.stats);
      if (stats && typeof member.userId === 'string')
        next.set(member.userId, withHistory(stats, map.get(member.userId)));
    }
    return next;
  }
  if (event.t === 'stats.update') {
    const stats = asStats(d.stats);
    if (!stats || typeof d.userId !== 'string') return map;
    return new Map(map).set(d.userId, withHistory(stats, map.get(d.userId)));
  }
  return map;
}
