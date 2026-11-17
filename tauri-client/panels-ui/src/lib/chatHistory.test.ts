import { describe, expect, it } from 'vitest';

import type { ChatLine, SyncEvent } from '../types/index.js';
import { fetchOlder } from './chatHistory.js';
import { addOlder, applyEvent, emptyTable, lineFromHistory, mergeChat } from './tableModel.js';

const line = (id: string, at: number): ChatLine => ({
  id,
  from: { userId: 'p1', name: 'Pat' },
  text: id,
  at,
  kind: 'chat',
});
const row = (id: string, at: number) => ({
  id,
  senderId: 'p1',
  senderName: 'Pat',
  recipientId: null,
  text: id,
  at,
  kind: 'chat',
  lang: null,
});

describe('older chat', () => {
  it('maps a history row to a chat line, a whisper with its recipient', () => {
    expect(lineFromHistory(row('a', 5))).toEqual(line('a', 5));
    const whisper = lineFromHistory({ ...row('w', 6), recipientId: 'dm' }, [
      {
        userId: 'dm',
        displayName: 'Dee',
        role: 'dm',
        character: null,
        online: true,
        inVoice: false,
      } as never,
    ]);
    expect(whisper.to).toEqual({ userId: 'dm', name: 'Dee' });
  });

  it('mergeChat keeps both same-millisecond lines and drops the duplicate the +1 cursor returns', () => {
    const now = [line('c', 10), line('d', 11)];
    const older = [line('a', 9), line('b', 10), line('c', 10)];
    expect(mergeChat(now, older).map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('addOlder records that there is no more, and a snapshot resets it', () => {
    let state = addOlder(emptyTable, [line('a', 1)], true);
    expect(state.historyDone).toBe(true);
    const snapshot: SyncEvent = {
      t: 'snapshot',
      d: {
        members: [],
        recentChat: [{ id: 'z', from: { userId: 'p1', name: 'Pat' }, text: 'z', at: 50 }],
      },
    };
    state = applyEvent(state, snapshot);
    expect(state.historyDone).toBe(false);
    expect(state.chat.map((l) => l.id)).toEqual(['z']);
  });

  it('fetchOlder asks for 50 before the oldest line (+1) and says when there is no more', async () => {
    const asked: string[] = [];
    const get = async (path: string) => {
      asked.push(path);
      return { messages: Array.from({ length: 12 }, (_, i) => row(`m${i}`, i)) };
    };
    const page = await fetchOlder(100, 50, [], get);
    expect(asked).toEqual(['chat?limit=50&before=101']);
    expect(page.lines).toHaveLength(12);
    expect(page.done).toBe(true);
    const full = await fetchOlder(100, 50, [], async () => ({
      messages: Array.from({ length: 50 }, (_, i) => row(`m${i}`, i)),
    }));
    expect(full.done).toBe(false);
  });
});
