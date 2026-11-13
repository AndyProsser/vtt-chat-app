import { describe, expect, it } from 'vitest';

import type { Member } from '../../types/phone.js';
import { memberCard, portraitUrl, presenceLabel, presenceOf, railOrder, initials } from './rail.js';

const m = (userId: string, over: Partial<Member> = {}): Member => ({
  userId,
  displayName: userId,
  role: 'player',
  character: null,
  online: true,
  ...over,
});

describe('presenceOf', () => {
  it('maps connection and status', () => {
    expect(presenceOf({ online: false, status: 'online' })).toBe('disconnected');
    expect(presenceOf({ online: true, status: 'offline' })).toBe('offline');
    expect(presenceOf({ online: true, status: 'away' })).toBe('away');
    expect(presenceOf({ online: true, status: 'online' })).toBe('online');
    expect(presenceOf({ online: true })).toBe('online');
  });
});

describe('railOrder', () => {
  it('puts the DM first, then online, away, offline, alphabetical by shown name', () => {
    const list = [
      m('zed', { status: 'offline' }),
      m('bo', { online: false }),
      m('cy', { status: 'away' }),
      m('dee', { role: 'dm', online: false }),
      m('al', { character: { name: 'Zara' } }),
      m('em'),
      m('fi', { status: 'away', character: { name: 'Abe' } }),
    ];
    expect(railOrder(list).map((x) => x.userId)).toEqual([
      'dee',
      'em',
      'al',
      'fi',
      'cy',
      'bo',
      'zed',
    ]);
  });
  it('does not change its input', () => {
    const list = [m('b'), m('a')];
    railOrder(list);
    expect(list[0]?.userId).toBe('b');
  });
});

describe('memberCard', () => {
  it('shows race, class and level, the account name and the DM mark', () => {
    const card = memberCard(
      m('u', {
        displayName: 'Sam',
        role: 'dm',
        character: { name: 'Thorn', race: 'Elf', className: 'Ranger', level: 5 },
      }),
    );
    expect(card).toEqual({
      title: 'Thorn',
      lines: ['DM', 'Elf · Ranger 5', 'Sam'],
      presence: 'online',
    });
  });
  it('leaves out what is missing, never "undefined"', () => {
    expect(memberCard(m('u', { character: { name: 'Thorn', race: null } })).lines).toEqual(['u']);
    expect(memberCard(m('u', { displayName: 'Sam' }))).toEqual({
      title: 'Sam',
      lines: [],
      presence: 'online',
    });
  });
});

describe('portraitUrl and initials', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  it('uses an uploaded picture, the character first', () => {
    expect(portraitUrl(m('u', { avatarUrl: `avatar:${id}` }))).toBe(`/api/avatars/${id}`);
    expect(
      portraitUrl(
        m('u', { avatarUrl: 'avatar:x', character: { name: 'T', avatarUrl: `avatar:${id}` } }),
      ),
    ).toBe(`/api/avatars/${id}`);
  });
  it('has none for emblems or nothing', () => {
    expect(portraitUrl(m('u', { avatarUrl: 'emblem:sword' }))).toBeUndefined();
    expect(portraitUrl(m('u'))).toBeUndefined();
  });
  it('makes one or two capitals', () => {
    expect(initials('thorn ironfoot the third')).toBe('TI');
    expect(initials('  ')).toBe('?');
  });
});

describe('presenceLabel', () => {
  it('says "On the web" for someone out of voice on the web app, and leaves the other states alone', () => {
    expect(presenceLabel('offline', 'web')).toBe('On the web (chat only)');
    expect(presenceLabel('offline', 'app')).toBe('Offline (chat only)');
    expect(presenceLabel('offline', null)).toBe('Offline (chat only)');
    expect(presenceLabel('online', 'web')).toBe('Online');
    expect(presenceLabel('disconnected', 'web')).toBe('Disconnected (app closed or signed out)');
  });
});
