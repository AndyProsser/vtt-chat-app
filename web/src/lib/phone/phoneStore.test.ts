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
});
