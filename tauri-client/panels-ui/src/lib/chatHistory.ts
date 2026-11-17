import { CHAT_LIMIT, CHAT_PAGE } from '../consts/index.js';
import type { ChatLine, Member } from '../types/index.js';
import { lineFromHistory, type HistoryRow } from './tableModel.js';
import { campaignApi } from './tauriBridge.js';

type Get = (path: string) => Promise<{ messages: HistoryRow[] }>;

/**
 * One page of chat older than `oldestAt`, from the server's history (Postgres). The cursor is
 * `oldestAt + 1` because the server returns lines strictly before it: asking one millisecond later
 * keeps a line that shares the oldest line's millisecond, and the duplicate it also returns is
 * dropped by id when merged. `done` when the server ran out or the panel is full.
 */
export async function fetchOlder(
  oldestAt: number,
  chatLength: number,
  members: Member[],
  get: Get = (path) => campaignApi('GET', path),
): Promise<{ lines: ChatLine[]; done: boolean }> {
  const { messages } = await get(`chat?limit=${CHAT_PAGE}&before=${oldestAt + 1}`);
  return {
    lines: messages.map((m) => lineFromHistory(m, members)),
    done: messages.length < CHAT_PAGE || chatLength + messages.length >= CHAT_LIMIT,
  };
}
