import { describe, expect, it } from 'vitest';

import type { ChatLine, Member } from '../types/index.js';
import { commandPalette, lineKind, parseCommand } from './commands.js';

const m = (userId: string, name: string, over: Partial<Member> = {}): Member => ({
  userId,
  displayName: name,
  role: 'player',
  character: null,
  online: true,
  inVoice: false,
  muted: true,
  ...over,
});
const members = [
  m('dm1', 'Dee', { role: 'dm' }),
  m('u1', 'Amy', { character: { name: 'Aria' } }),
  m('u2', 'Bob'),
  m('u3', 'Alex'),
];
const player = { role: 'player' as const, selfId: 'u2', selfName: 'Bob', members };
const dm = { role: 'dm' as const, selfId: 'dm1', selfName: 'Dee', members };

describe('parseCommand', () => {
  it('sends plain text as is, including text with a slash that is not first', () => {
    expect(parseCommand('hello there', player)).toEqual({ kind: 'say', text: 'hello there' });
    expect(parseCommand('see /w later', player)).toEqual({ kind: 'say', text: 'see /w later' });
  });

  it('whispers by character name or account name, case-insensitively', () => {
    expect(parseCommand('/w aria hi', player)).toEqual({
      kind: 'whisper',
      toUserId: 'u1',
      text: 'hi',
    });
    expect(parseCommand('/w DEE psst', player)).toMatchObject({ kind: 'whisper', toUserId: 'dm1' });
  });

  it('refuses a whisper to nobody, to an ambiguous name, or with no text', () => {
    expect(parseCommand('/w nobody hi', player)).toMatchObject({ kind: 'error' });
    expect((parseCommand('/w nobody hi', player) as { message: string }).message).toContain(
      'nobody',
    );
    expect(parseCommand('/w al hi', player)).toMatchObject({ kind: 'whisper', toUserId: 'u3' }); // unique prefix
    expect(parseCommand('/w a hi', player)).toMatchObject({ kind: 'error' }); // ambiguous
    expect(parseCommand('/w aria', player)).toMatchObject({ kind: 'error' });
  });

  it('lets a player message the DM, and tells the DM they are the DM', () => {
    expect(parseCommand('/dm psst', player)).toEqual({
      kind: 'whisper',
      toUserId: 'dm1',
      text: 'psst',
    });
    expect(parseCommand('/dm psst', dm)).toMatchObject({ kind: 'error' });
  });

  it('turns /me into an emote line', () => {
    expect(parseCommand('/me waves', player)).toEqual({ kind: 'say', text: '* Bob waves' });
    expect(parseCommand('/me', player)).toMatchObject({ kind: 'error' });
  });

  it('opens the inventory for /loot and /take', () => {
    expect(parseCommand('/loot', dm)).toEqual({ kind: 'open', target: 'inventory' });
    expect(parseCommand('/take', player)).toEqual({ kind: 'open', target: 'inventory' });
  });

  it('errors on /voice (not built), an unknown command, and a lone slash', () => {
    expect(parseCommand('/voice giant', dm)).toMatchObject({ kind: 'error' });
    expect(parseCommand('/unknown x', player)).toMatchObject({ kind: 'error' });
    expect(parseCommand('/', player)).toMatchObject({ kind: 'error' });
  });
});

describe('commandPalette', () => {
  it('lists commands matching what was typed, for this role', () => {
    expect(commandPalette('/w', 'player').map((c) => c.name)).toEqual(['/w']);
    expect(commandPalette('/', 'player').map((c) => c.name)).not.toContain('/voice');
    expect(commandPalette('/', 'player').map((c) => c.name)).toContain('/dm');
    expect(commandPalette('/', 'dm').map((c) => c.name)).not.toContain('/dm');
    expect(commandPalette('hello', 'player')).toEqual([]);
  });
});

describe('lineKind', () => {
  const line = (over: Partial<ChatLine>): ChatLine => ({
    id: '1',
    from: { userId: 'u2', name: 'Bob' },
    text: 'x',
    at: 1,
    ...over,
  });
  it('tells public, whisper and DM-private lines apart', () => {
    expect(lineKind(line({}), members)).toBe('public');
    expect(lineKind(line({ to: { userId: 'u1', name: 'Aria' } }), members)).toBe('whisper');
    expect(
      lineKind(
        line({ from: { userId: 'dm1', name: 'Dee' }, to: { userId: 'u1', name: 'Aria' } }),
        members,
      ),
    ).toBe('dm-private');
  });
});
