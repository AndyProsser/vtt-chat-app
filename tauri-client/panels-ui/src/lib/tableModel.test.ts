import { describe, expect, it } from 'vitest';

import type { SyncEvent } from '../types/index.js';
import { applyEvent, emptyTable, mergeChat } from './tableModel.js';

const snapshot: SyncEvent = {
  t: 'snapshot',
  d: {
    members: [
      { userId: 'dm', displayName: 'Dee', role: 'dm', online: true, inVoice: true, muted: false },
      { userId: 'p1', displayName: 'Pat', role: 'player', online: false },
    ],
    recentChat: [{ id: 'a', from: { userId: 'dm', name: 'Dee' }, text: 'hi', at: 1 }],
  },
};

describe('tableModel', () => {
  it('builds members and chat from a snapshot', () => {
    const s = applyEvent(emptyTable, snapshot);
    expect(s.members.map((m) => m.displayName)).toEqual(['Dee', 'Pat']);
    expect(s.members[1]).toMatchObject({ online: false, inVoice: false, muted: true });
    expect(s.chat).toHaveLength(1);
  });

  it('updates presence and audio, and returns the same object when nothing changed', () => {
    const s = applyEvent(emptyTable, snapshot);
    const online = applyEvent(s, { t: 'presence.update', d: { userId: 'p1', online: true } });
    expect(online.members[1]?.online).toBe(true);
    expect(applyEvent(online, { t: 'presence.update', d: { userId: 'p1', online: true } })).toBe(
      online,
    );
    const voice = applyEvent(online, {
      t: 'audio.update',
      d: { userId: 'p1', inVoice: true, muted: false },
    });
    expect(voice.members[1]).toMatchObject({ inVoice: true, muted: false });
  });

  it('keeps one copy of a line seen twice and orders by time', () => {
    const a = { id: 'a', from: { userId: 'x', name: 'X' }, text: 't', at: 5 };
    const b = { ...a, id: 'b', at: 2 };
    expect(mergeChat([a], [b, a]).map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('shows a whisper with its recipient and keeps whispers across a new snapshot', () => {
    let s = applyEvent(emptyTable, snapshot);
    s = applyEvent(s, {
      t: 'chat.whisper',
      d: {
        id: 'w1',
        from: { userId: 'dm', name: 'Dee' },
        to: { userId: 'p1', name: 'Pat' },
        text: 'psst',
        at: 3,
      },
    });
    expect(s.chat.find((l) => l.id === 'w1')?.to?.userId).toBe('p1');
    s = applyEvent(s, snapshot);
    expect(s.chat.map((l) => l.id)).toEqual(['a', 'w1']);
  });

  it('merges a batch of whispers sent after a resume, ignoring malformed ones', () => {
    const s = applyEvent(emptyTable, {
      t: 'chat.whispers',
      d: {
        whispers: [
          {
            id: 'w',
            from: { userId: 'p1', name: 'P' },
            to: { userId: 'dm', name: 'D' },
            text: 'x',
            at: 1,
          },
          { nope: true },
        ],
      },
    });
    expect(s.chat).toHaveLength(1);
  });

  it('ignores events it does not know', () => {
    const s = applyEvent(emptyTable, snapshot);
    expect(applyEvent(s, { t: 'party.state', d: {} })).toBe(s);
  });
});
