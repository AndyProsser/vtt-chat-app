import type { ChatLine } from '../../types/phone.js';

/** How many lines the phone keeps in memory; older ones are a scroll-up fetch away. */
export const MAX_LINES = 300;

interface HistoryRow {
  id: string;
  senderId: string | null;
  senderName: string;
  recipientId: string | null;
  text: string;
  at: number;
}

/** A row of `GET /api/campaigns/:id/chat`. */
export const lineFromHistory = (m: HistoryRow): ChatLine => ({
  id: m.id,
  at: m.at,
  fromId: m.senderId,
  fromName: m.senderName,
  toId: m.recipientId,
  text: m.text,
});

interface FrameData {
  id?: unknown;
  at?: unknown;
  text?: unknown;
  from?: { userId?: unknown; name?: unknown } | null;
  to?: { userId?: unknown } | null;
}

/** The data of a live `chat.message` or `chat.whisper` frame (or an entry of a snapshot's lists). */
export function lineFromFrame(d: unknown): ChatLine | undefined {
  const f = d as FrameData | null;
  if (!f || typeof f.id !== 'string' || typeof f.text !== 'string' || typeof f.at !== 'number') {
    return undefined;
  }
  return {
    id: f.id,
    at: f.at,
    fromId: typeof f.from?.userId === 'string' ? f.from.userId : null,
    fromName: typeof f.from?.name === 'string' ? f.from.name : 'unknown',
    toId: typeof f.to?.userId === 'string' ? f.to.userId : null,
    text: f.text,
  };
}

/** Adds lines, keeping one copy of each id (a line can arrive from history and live), oldest first. */
export function mergeLines(existing: ChatLine[], incoming: ChatLine[]): ChatLine[] {
  const byId = new Map<string, ChatLine>();
  for (const line of existing) byId.set(line.id, line);
  for (const line of incoming) byId.set(line.id, line);
  const all = [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return all.length > MAX_LINES ? all.slice(all.length - MAX_LINES) : all;
}

/** The other person in a whisper, from `selfId`'s side. */
export const whisperPeer = (line: ChatLine, selfId: string): string | null =>
  line.toId === null ? null : line.fromId === selfId ? line.toId : line.fromId;
