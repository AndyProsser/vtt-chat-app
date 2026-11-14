import { beforeEach, describe, expect, it } from 'vitest';

import { usePhoneStore } from './phoneStore.js';

const frame = (id: string, from: string, over = {}) => ({
  id,
  at: Number(id),
  text: `line ${id}`,
  from: { userId: from, name: from },
  ...over,
});

beforeEach(() => {
  usePhoneStore.getState().signedOut();
  usePhoneStore.getState().signedIn('me');
});

describe('phone store', () => {
  it('takes the roster and recent chat (public and whispers) from a snapshot, once each', () => {
    const { onFrame } = usePhoneStore.getState();
    onFrame('snapshot', {
      members: [{ userId: 'me', displayName: 'Me', role: 'player', character: null, online: true }],
      recentChat: [frame('1', 'a'), frame('2', 'b')],
      recentWhispers: [frame('3', 'a', { to: { userId: 'me' } })],
    });
    onFrame('snapshot', { recentChat: [frame('2', 'b')] });
    const s = usePhoneStore.getState();
    expect(s.lines.map((l) => l.id)).toEqual(['1', '2', '3']);
    expect(s.members).toHaveLength(1);
  });
  it('counts other people’s lines as unread while another tab is showing, and clears on Chat', () => {
    const { onFrame, setTab } = usePhoneStore.getState();
    setTab('sessions');
    onFrame('chat.message', frame('1', 'a'));
    onFrame('chat.message', frame('2', 'me'));
    onFrame('chat.whisper', frame('3', 'a', { to: { userId: 'me' } }));
    expect(usePhoneStore.getState().unread).toBe(2);
    usePhoneStore.getState().setTab('chat');
    expect(usePhoneStore.getState().unread).toBe(0);
  });
  it('starts a campaign with a clean chat, so one table never shows another’s lines', () => {
    const { onFrame, pickCampaign } = usePhoneStore.getState();
    onFrame('chat.message', frame('1', 'a'));
    pickCampaign('c2');
    expect(usePhoneStore.getState().lines).toEqual([]);
    expect(usePhoneStore.getState().campaignId).toBe('c2');
  });
  it('forgets everything on sign-out', () => {
    usePhoneStore.getState().onFrame('chat.message', frame('1', 'a'));
    usePhoneStore.getState().signedOut();
    const s = usePhoneStore.getState();
    expect(s.authed).toBe(false);
    expect(s.lines).toEqual([]);
  });
  it('keeps a refused kind or language as an inline error, and ignores other errors', () => {
    const { onFrame } = usePhoneStore.getState();
    onFrame('error', { code: 'other' });
    expect(usePhoneStore.getState().chatError).toBeUndefined();
    onFrame('error', { code: 'invalid_lang' });
    expect(usePhoneStore.getState().chatError).toMatch(/language/);
    usePhoneStore.getState().clearChatError();
    expect(usePhoneStore.getState().chatError).toBeUndefined();
  });

  it('asks the handout and session lists to read again on the frames that change them', () => {
    const { onFrame } = usePhoneStore.getState();
    const rev = () => {
      const s = usePhoneStore.getState();
      return [s.handoutsRev, s.sessionsRev];
    };
    const start = rev();
    onFrame('handout.shown', { handoutId: 'h' });
    onFrame('handout.removed', { handoutId: 'h' });
    onFrame('handout.changed', { handoutId: 'h' });
    expect(rev()).toEqual([start[0]! + 3, start[1]]);
    onFrame('notification', { kind: 'session.scheduled' });
    onFrame('notification', { kind: 'session.updated' });
    onFrame('notification', { kind: 'session.cancelled' });
    onFrame('notification', { kind: 'rsvp.changed' });
    expect(rev()).toEqual([start[0]! + 3, start[1]! + 4]);
    // Anything else that arrives as a notification (a join decision, a malformed one) leaves the lists alone.
    onFrame('notification', { kind: 'join.approved' });
    onFrame('notification', null);
    onFrame('notification', { kind: 5 });
    expect(rev()).toEqual([start[0]! + 3, start[1]! + 4]);
  });
  it('reads both lists again after a reconnect snapshot', () => {
    const before = usePhoneStore.getState();
    before.onFrame('snapshot', {});
    const after = usePhoneStore.getState();
    expect([after.handoutsRev, after.sessionsRev]).toEqual([
      before.handoutsRev + 1,
      before.sessionsRev + 1,
    ]);
  });
});

describe('party.state', () => {
  it('shows the private talk and says who joined which group, but not for the first state', () => {
    const store = usePhoneStore;
    store.getState().signedIn('p1');
    store.setState({
      members: [
        { userId: 'p1', displayName: 'Pat', role: 'player' },
        { userId: 'p2', displayName: 'Sam', role: 'player' },
      ] as never,
      partiesSeen: false,
      notices: [],
    });
    const frame = (assignments: Record<string, string>, aside: unknown = null) =>
      store.getState().onFrame('party.state', {
        parties: [{ id: 'g1', name: 'Cellar' }],
        assignments,
        aside,
      });
    frame({ p1: 'g1' });
    expect(store.getState().notices).toEqual([]);
    frame({ p1: 'g1', p2: 'g1' });
    expect(store.getState().notices.map((n) => n.text)).toEqual(['Sam joined Cellar']);
    frame({ p1: 'g1', p2: 'g1' }, { dmId: 'dm', playerId: 'p2' });
    expect(store.getState().parties.aside).toEqual({ dmId: 'dm', playerId: 'p2' });
    expect(store.getState().notices.at(-1)?.text).toBe('The DM took Sam aside for a private talk');
  });
});

describe('loot frames', () => {
  it('bump the loot revision so the Loot tab reads its list again', () => {
    const before = usePhoneStore.getState().lootRev;
    usePhoneStore.getState().onFrame('loot.dropped', { itemId: 'i1' });
    usePhoneStore.getState().onFrame('loot.claimed', { itemId: 'i1' });
    usePhoneStore.getState().onFrame('loot.removed', { itemId: 'i1' });
    expect(usePhoneStore.getState().lootRev).toBe(before + 3);
  });
});
