import { describe, expect, it } from 'vitest';

import type { SyncEvent } from '../types/index.js';
import { applyEvent, emptyTable, isDm, mergeChat, recordingActions } from './tableModel.js';

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

  it("keeps a person's own portrait from the roster", () => {
    const withPortrait: SyncEvent = {
      t: 'roster.update',
      d: { members: [{ userId: 'dm', displayName: 'Dee', role: 'dm', avatarUrl: 'emblem:crown' }] },
    };
    expect(applyEvent(emptyTable, withPortrait).members[0]?.avatarUrl).toBe('emblem:crown');
    expect(applyEvent(emptyTable, snapshot).members[0]?.avatarUrl).toBeNull();
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
    expect(applyEvent(s, { t: 'something.else', d: {} })).toBe(s);
  });
});

describe('recording state', () => {
  const ev = (t: string, d: unknown): SyncEvent => ({ t, d });

  it('follows the server through start, pause, resume and stop', () => {
    let s = applyEvent(
      emptyTable,
      ev('recording.status', { recordingId: 'r1', status: 'STARTED' }),
    );
    expect(s.recording).toEqual({ recordingId: 'r1', capturing: true, startedAt: null });
    s = applyEvent(s, ev('recording.status', { recordingId: 'r1', status: 'PAUSED' }));
    expect(s.recording?.capturing).toBe(false);
    s = applyEvent(s, ev('recording.status', { recordingId: 'r1', status: 'RESUMED' }));
    expect(s.recording?.capturing).toBe(true);
    s = applyEvent(s, ev('recording.status', { recordingId: 'r1', status: 'STOPPED' }));
    expect(s.recording).toBeNull();
  });

  it('learns an in-progress recording from recording.state, and is idempotent', () => {
    const e = ev('recording.state', { recording: { recordingId: 'r2', capturing: false } });
    const once = applyEvent(emptyTable, e);
    expect(once.recording).toEqual({ recordingId: 'r2', capturing: false, startedAt: null });
    expect(applyEvent(once, e)).toBe(once);
    expect(applyEvent(once, ev('recording.state', { recording: null })).recording).toBeNull();
  });

  it('a snapshot keeps the recording state', () => {
    const rec = applyEvent(
      emptyTable,
      ev('recording.state', { recording: { recordingId: 'r', capturing: true } }),
    );
    expect(applyEvent(rec, ev('snapshot', { members: [] })).recording).not.toBeNull();
  });

  it('offers the right buttons, and only the DM gets them', () => {
    expect(recordingActions(null)).toEqual(['start']);
    expect(recordingActions({ recordingId: 'r', capturing: true, startedAt: null })).toEqual([
      'pause',
      'stop',
    ]);
    expect(recordingActions({ recordingId: 'r', capturing: false, startedAt: null })).toEqual([
      'resume',
      'stop',
    ]);
    const members = [
      {
        userId: 'd',
        displayName: 'D',
        role: 'dm',
        character: null,
        online: true,
        inVoice: false,
        muted: true,
      },
      {
        userId: 'p',
        displayName: 'P',
        role: 'player',
        character: null,
        online: true,
        inVoice: false,
        muted: true,
      },
    ] as const;
    expect(isDm([...members], 'd')).toBe(true);
    expect(isDm([...members], 'p')).toBe(false);
    expect(isDm([...members], null)).toBe(false);
  });
});

describe('party.state', () => {
  it('replaces the voice groups wholesale and ignores junk', () => {
    const s = applyEvent(emptyTable, {
      t: 'party.state',
      d: {
        parties: [{ id: 'p1', name: 'North' }, { nope: 1 }],
        assignments: { u1: 'p1', u2: 5 },
        split: true,
      },
    });
    expect(s.parties).toEqual({
      parties: [{ id: 'p1', name: 'North' }],
      assignments: { u1: 'p1' },
      split: true,
    });
  });
});

describe('recording start time', () => {
  it('keeps startedAt from recording.state and recording.status', () => {
    const state = applyEvent(emptyTable, {
      t: 'recording.state',
      d: { recording: { recordingId: 'r1', capturing: true, startedAt: 1000 } },
    });
    expect(state.recording).toEqual({ recordingId: 'r1', capturing: true, startedAt: 1000 });
    const paused = applyEvent(state, {
      t: 'recording.status',
      d: { recordingId: 'r1', status: 'PAUSED', startedAt: 1000 },
    });
    expect(paused.recording).toEqual({ recordingId: 'r1', capturing: false, startedAt: 1000 });
  });

  it('keeps the earlier start time when an event lacks one, and is null when never known', () => {
    const known = applyEvent(emptyTable, {
      t: 'recording.status',
      d: { recordingId: 'r1', status: 'STARTED', startedAt: 500 },
    });
    const resumed = applyEvent(known, {
      t: 'recording.status',
      d: { recordingId: 'r1', status: 'RESUMED' },
    });
    expect(resumed.recording?.startedAt).toBe(500);
    const unknown = applyEvent(emptyTable, {
      t: 'recording.status',
      d: { recordingId: 'r2', status: 'STARTED' },
    });
    expect(unknown.recording?.startedAt).toBeNull();
  });
});

describe('loot and handout cards', () => {
  const dropped = { t: 'loot.dropped', d: { itemId: 'i1', name: 'Potion', quantity: 2 } };
  const claimed = {
    t: 'loot.claimed',
    d: { itemId: 'i1', name: 'Potion', quantity: 2, claimedBy: 'u1' },
  };
  const chatLine = {
    t: 'chat.message',
    d: { id: 'm1', text: 'hi', from: { userId: 'u', name: 'U' }, at: 5 },
  };

  it('adds a card after the last chat line, then marks who took it', () => {
    let state = applyEvent(emptyTable, chatLine);
    state = applyEvent(state, dropped);
    expect(state.cards).toEqual([
      {
        id: 'loot:i1',
        kind: 'loot',
        title: 'Potion',
        quantity: 2,
        rarity: null,
        claimedBy: null,
        after: 'm1',
      },
    ]);
    state = applyEvent(state, claimed);
    expect(state.cards[0]?.claimedBy).toBe('u1');
  });

  it('does not duplicate or un-claim when the same events are replayed', () => {
    let state = emptyTable;
    for (const e of [dropped, claimed, dropped, claimed]) state = applyEvent(state, e);
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0]?.claimedBy).toBe('u1');
  });

  it('marks removed loot and handouts, and adds handout cards', () => {
    let state = applyEvent(emptyTable, dropped);
    state = applyEvent(state, {
      t: 'loot.removed',
      d: { itemId: 'i1', name: 'Potion', quantity: 2 },
    });
    expect(state.cards[0]?.removed).toBe(true);
    state = applyEvent(state, {
      t: 'handout.shown',
      d: { handoutId: 'h1', title: 'Crypt map', kind: 'map' },
    });
    expect(state.cards.at(-1)).toMatchObject({
      id: 'handout:h1',
      kind: 'handout',
      title: 'Crypt map',
    });
    state = applyEvent(state, { t: 'handout.removed', d: { handoutId: 'h1' } });
    expect(state.cards.at(-1)?.removed).toBe(true);
  });
});

describe('party inventory cards', () => {
  it('keeps what a coin pile is, who took an item and for whom, and a split', () => {
    let state = applyEvent(emptyTable, {
      t: 'loot.dropped',
      d: { itemId: 'c1', name: 'gp', quantity: 10, kind: 'coin' },
    });
    expect(state.cards[0]).toMatchObject({ coin: true, title: 'gp', quantity: 10 });
    state = applyEvent(state, {
      t: 'loot.claimed',
      d: {
        itemId: 'c1',
        name: 'gp',
        quantity: 10,
        kind: 'coin',
        claimedBy: 'u1',
        claimedFor: 'split',
        split: { shares: [{ userId: 'u2', amount: 5 }], remainder: 0 },
      },
    });
    expect(state.cards[0]).toMatchObject({
      claimedBy: 'u1',
      claimedFor: 'split',
      split: { shares: [{ userId: 'u2', amount: 5 }], remainder: 0 },
    });
    const party = applyEvent(emptyTable, {
      t: 'loot.claimed',
      d: {
        itemId: 'i9',
        name: 'Rope',
        quantity: 1,
        kind: 'item',
        claimedBy: 'u1',
        claimedFor: 'party',
      },
    });
    expect(party.cards[0]).toMatchObject({ claimedFor: 'party', claimedBy: 'u1' });
  });
});

describe('roster.update', () => {
  it('replaces the members (a changed character shows without a reconnect) and keeps the chat', () => {
    let state = applyEvent(emptyTable, {
      t: 'snapshot',
      d: {
        members: [
          { userId: 'a', displayName: 'Amy', role: 'player', character: null, online: true },
        ],
        recentChat: [],
      },
    });
    state = applyEvent(state, {
      t: 'chat.message',
      d: { id: 'm1', text: 'hi', from: { userId: 'a', name: 'Amy' }, at: 1 },
    });
    const next = applyEvent(state, {
      t: 'roster.update',
      d: {
        members: [
          {
            userId: 'a',
            displayName: 'Amy',
            role: 'player',
            character: { name: 'Aria', className: 'Ranger', level: 5, avatarUrl: 'emblem:bow' },
            online: true,
            inVoice: false,
            muted: true,
          },
        ],
      },
    });
    expect(next.members[0]?.character).toMatchObject({
      name: 'Aria',
      className: 'Ranger',
      avatarUrl: 'emblem:bow',
    });
    expect(next.chat).toHaveLength(1);
  });
});
