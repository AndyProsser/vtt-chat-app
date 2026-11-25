import { describe, expect, it } from 'vitest';

import { CHAT_LANGUAGES } from '../consts/chat.js';
import { CHAT_TEXT_MAX } from '../consts/index.js';
import type { ChatContext } from '../types/chat.js';
import { chatCommands, findChatLanguage, isChatKind, isChatLanguageKey } from './chatCommands.js';
import { looksLikeTypo, parseComposerInput } from './chatParser.js';
import { suggest } from './chatSuggest.js';

const ctx: ChatContext = {
  selfId: 'sam',
  members: [
    { id: 'sam', name: 'Sam', characterName: 'Thorin', role: 'player' },
    { id: 'dee', name: 'Dee', characterName: null, role: 'dm' },
    { id: 'mary', name: 'Mary', role: 'player' },
    { id: 'maryann', name: 'Mary Ann', characterName: 'Lady Isolde Vane', role: 'player' },
  ],
};
const dmCtx: ChatContext = { ...ctx, selfId: 'dee' };
const p = (s: string, c = ctx) => parseComposerInput(s, c);

describe('tables', () => {
  it('generates a say command per language and recognises kinds and keys', () => {
    const names = chatCommands().map((c) => c.name);
    for (const l of CHAT_LANGUAGES) expect(names).toContain(`say-${l.key}`);
    expect(names).toContain('tell');
    expect(isChatKind('ooc')).toBe(true);
    expect(isChatKind('shout')).toBe(false);
    expect(isChatLanguageKey('elvish')).toBe(true);
    expect(isChatLanguageKey('dwarven')).toBe(false); // an alias is not a wire key
  });
  it('resolves language aliases and spellings', () => {
    expect(findChatLanguage('dwarven')?.key).toBe('dwarvish');
    expect(findChatLanguage('Deep_Speech')?.key).toBe('deep-speech');
    expect(findChatLanguage("thieves'cant")?.key).toBe('thieves-cant');
    expect(findChatLanguage('klingon')).toBeUndefined();
  });
});

describe('parseComposerInput', () => {
  it('sends plain text as in-character chat', () => {
    expect(p('  hello there ')).toEqual({ type: 'send', kind: 'chat', text: 'hello there' });
  });
  it('handles say, do, me and ooc', () => {
    expect(p('/say Well met')).toEqual({ type: 'send', kind: 'say', text: 'Well met' });
    expect(p('/do raises his axe')).toEqual({ type: 'send', kind: 'do', text: 'raises his axe' });
    expect(p('/ME waves')).toEqual({ type: 'send', kind: 'do', text: 'waves' });
    expect(p('/ooc brb')).toEqual({ type: 'send', kind: 'ooc', text: 'brb' });
  });
  it('handles say-<language> including aliases', () => {
    expect(p('/say-elvish Hi')).toEqual({ type: 'send', kind: 'say', lang: 'elvish', text: 'Hi' });
    expect(p('/say-dwarven Drinks on me!')).toEqual({
      type: 'send',
      kind: 'say',
      lang: 'dwarvish',
      text: 'Drinks on me!',
    });
    expect(p('/say-deep-speech Ph’nglui')).toMatchObject({ lang: 'deep-speech' });
  });
  it('errors on empty text and over-long text', () => {
    expect(p('/say')).toMatchObject({ type: 'error' });
    expect(p('/ooc   ')).toMatchObject({ type: 'error' });
    expect(p('   ')).toMatchObject({ type: 'error' });
    expect(p('x'.repeat(CHAT_TEXT_MAX + 1))).toMatchObject({ type: 'error' });
    expect(p('x'.repeat(CHAT_TEXT_MAX))).toMatchObject({ type: 'send' });
  });
  it('sends an unknown command, or unknown language, as plain chat', () => {
    expect(p('/shrug whatever')).toEqual({ type: 'send', kind: 'chat', text: '/shrug whatever' });
    expect(p('/say-klingon qapla')).toEqual({
      type: 'send',
      kind: 'chat',
      text: '/say-klingon qapla',
    });
    expect(p('/ hello')).toEqual({ type: 'send', kind: 'chat', text: '/ hello' });
  });
  it('whispers with /tell and /w, longest name first', () => {
    expect(p('/tell Dee psst')).toEqual({ type: 'whisper', recipientId: 'dee', text: 'psst' });
    expect(p('/w mary hello')).toEqual({ type: 'whisper', recipientId: 'mary', text: 'hello' });
    expect(p('/tell Mary Ann are you there')).toEqual({
      type: 'whisper',
      recipientId: 'maryann',
      text: 'are you there',
    });
    expect(p('/tell lady isolde vane hi')).toMatchObject({ recipientId: 'maryann', text: 'hi' });
    expect(p('/tell Marys hi')).toMatchObject({ type: 'error' }); // a name must end at a word boundary
  });
  it('errors on /tell with a missing or unknown name, no text, or yourself', () => {
    expect(p('/tell')).toMatchObject({ type: 'error' });
    expect(p('/tell Nobody hi')).toMatchObject({ type: 'error' });
    expect(p('/tell Dee')).toMatchObject({ type: 'error' });
    expect(p('/tell Sam hi')).toMatchObject({ type: 'error' });
    expect(p('/tell Thorin hi')).toMatchObject({ type: 'error' });
  });
  it('whispers the DM with /dm, and says so when you are the DM', () => {
    expect(p('/dm can I roll again?')).toEqual({
      type: 'whisper',
      recipientId: 'dee',
      text: 'can I roll again?',
    });
    expect(p('/dm hi', dmCtx)).toMatchObject({ type: 'error' });
    expect(p('/dm')).toMatchObject({ type: 'error' });
    expect(p('/dm hi', { selfId: 'sam', members: [ctx.members[0]!] })).toMatchObject({
      type: 'error',
    });
  });
  it('builds quick OOC lines with the RSVP side effect', () => {
    expect(p('/late 20 min')).toEqual({
      type: 'quick',
      kind: 'ooc',
      text: 'Sam is running late: 20 min',
      rsvp: 'late',
    });
    expect(p('/late')).toMatchObject({ text: 'Sam is running late', rsvp: 'late' });
    expect(p('/cant')).toEqual({
      type: 'quick',
      kind: 'ooc',
      text: "Sam can't make it",
      rsvp: 'no',
    });
    expect(p('/work')).toMatchObject({ text: 'Sam is still at work', rsvp: 'late' });
  });
  it('builds presence notes with no RSVP', () => {
    for (const [cmd, text] of [
      ['/brb', 'Sam will be right back'],
      ['/afk', 'Sam is away from the keyboard'],
      ['/back', 'Sam is back'],
    ] as const) {
      const r = p(cmd);
      expect(r).toEqual({ type: 'quick', kind: 'ooc', text });
      expect('rsvp' in r).toBe(false);
    }
    expect(p('/brb dinner')).toMatchObject({ text: 'Sam will be right back: dinner' });
  });
});

describe('looksLikeTypo', () => {
  it('flags near misses and unknown languages only', () => {
    expect(looksLikeTypo('/sya hello')).toBe(true);
    expect(looksLikeTypo('/tel Dee hi')).toBe(true);
    expect(looksLikeTypo('/oc hi')).toBe(true);
    expect(looksLikeTypo('/say-elvsh hi')).toBe(true);
    expect(looksLikeTypo('/say-klingon hi')).toBe(true);
    expect(looksLikeTypo('/shrug')).toBe(false);
    expect(looksLikeTypo('/usr/bin/env')).toBe(false);
    expect(looksLikeTypo('/say hi')).toBe(false);
    expect(looksLikeTypo('hello')).toBe(false);
  });
});

describe('suggest', () => {
  it('lists commands while the line is /xxx', () => {
    const all = suggest('/', ctx);
    expect(all.kind).toBe('commands');
    expect(all.items.map((i) => i.insert)).toContain('/tell ');
    expect(all.items.some((i) => i.insert.startsWith('/say-'))).toBe(false);
    const s = suggest('/s', ctx);
    expect(s.items.map((i) => i.insert)).toEqual(['/say ', '/stash ']);
    expect(s.items[0]?.description).toBeTruthy();
  });
  it('matches aliases and inserts the alias typed', () => {
    expect(suggest('/m', ctx).items.map((i) => i.insert)).toEqual(['/me ']);
    expect(suggest('/w', ctx).items.map((i) => i.insert)).toEqual(['/w ', '/work ']);
  });
  it('lists languages after /say-', () => {
    const r = suggest('/say-', ctx);
    expect(r.kind).toBe('languages');
    expect(r.items).toHaveLength(CHAT_LANGUAGES.length);
    expect(suggest('/say-dw', ctx).items.map((i) => i.insert)).toEqual(['/say-dwarvish ']);
    expect(suggest('/say-dwarven', ctx).items.map((i) => i.insert)).toEqual(['/say-dwarvish ']);
    expect(suggest('/say-elvish', ctx).kind).toBe('none');
    expect(suggest('/say-zzz', ctx).kind).toBe('none');
  });
  it('lists members after /tell and /w, without yourself, filtered by prefix', () => {
    const r = suggest('/tell ', ctx);
    expect(r.kind).toBe('members');
    expect(r.items.map((i) => i.label)).toEqual(['Dee', 'Mary', 'Lady Isolde Vane']);
    expect(r.items.find((i) => i.label === 'Dee')?.description).toBe('DM');
    expect(suggest('/w ma', ctx).items.map((i) => i.insert)).toEqual(['/w Mary ', '/w Mary Ann ']);
    expect(suggest('/tell lady', ctx).items.map((i) => i.insert)).toEqual([
      '/tell Lady Isolde Vane ',
    ]);
    expect(suggest('/tell tho', ctx).kind).toBe('none'); // yourself
  });
  it('stops once a name is chosen or the line is not a command', () => {
    expect(suggest('/tell Dee ', ctx).kind).toBe('none');
    expect(suggest('/tell Dee hello', ctx).kind).toBe('none');
    expect(suggest('hello', ctx).kind).toBe('none');
    expect(suggest('/say hello', ctx).kind).toBe('none');
    expect(suggest('/zzz', ctx).kind).toBe('none');
    expect(suggest('', ctx).items).toEqual([]);
  });
});

describe('/say with a language picker', () => {
  it('opens the language list straight after /say, and filters it by what is typed', () => {
    const all = suggest('/say ', ctx);
    expect(all.kind).toBe('languages');
    expect(all.items).toHaveLength(CHAT_LANGUAGES.length);
    expect(all.items[0]?.insert).toBe('/say-common ');
    expect(suggest('/say or', ctx).items.map((i) => i.insert)).toEqual(['/say-orc ']);
    expect(suggest('/say dwarven', ctx).items.map((i) => i.insert)).toEqual(['/say-dwarvish ']);
  });
  it('is quiet once a word is finished or when nothing matches, so plain speech is just Common', () => {
    expect(suggest('/say Go away', ctx).kind).toBe('none');
    expect(suggest('/say zzz', ctx).kind).toBe('none');
    expect(p('/say Go away')).toEqual({ type: 'send', kind: 'say', text: 'Go away' });
  });
  it('never guesses: a language name typed after /say is text until it is picked from the list', () => {
    expect(p('/say orc ahead!')).toEqual({ type: 'send', kind: 'say', text: 'orc ahead!' });
    expect(suggest('/say orc ', ctx).kind).toBe('none'); // past the first word, the list is gone
    expect(suggest('/say orc', ctx).items.map((i) => i.insert)).toEqual(['/say-orc ']); // Tab or Enter picks it
  });
  it('still sends a pasted "/say orc ..." as Common: the parser never guesses', () => {
    expect(p('/say orc Get lost!')).toEqual({ type: 'send', kind: 'say', text: 'orc Get lost!' });
    expect(p('/say-orc Get lost!')).toEqual({
      type: 'send',
      kind: 'say',
      lang: 'orc',
      text: 'Get lost!',
    });
  });
});

describe('/take and /stash', () => {
  const lootCtx: ChatContext = {
    ...ctx,
    loot: [
      { id: 'l1', name: 'Rope of Climbing', quantity: 1 },
      { id: 'l2', name: 'gp', quantity: 40 },
      { id: 'l3', name: 'Rope', quantity: 2 },
    ],
  };
  it('with nothing after it, asks the app to open the inventory on what is available', () => {
    expect(p('/take', lootCtx)).toEqual({ type: 'loot', action: 'take' });
    expect(p('/stash', lootCtx)).toEqual({ type: 'loot', action: 'stash' });
  });
  it('takes the item named, the longest name first', () => {
    expect(p('/take Rope of Climbing', lootCtx)).toEqual({
      type: 'loot',
      action: 'take',
      itemId: 'l1',
    });
    expect(p('/take rope', lootCtx)).toEqual({ type: 'loot', action: 'take', itemId: 'l3' });
    expect(p('/stash gp', lootCtx)).toEqual({ type: 'loot', action: 'stash', itemId: 'l2' });
  });
  it('says so when nothing available has that name', () => {
    expect(p('/take sword', lootCtx)).toMatchObject({ type: 'error' });
    expect(p('/take sword')).toMatchObject({ type: 'error' });
  });
  it('lists what is available after /take and /stash, filtered by what is typed', () => {
    const r = suggest('/take ', lootCtx);
    expect(r.kind).toBe('loot');
    expect(r.items.map((i) => i.insert)).toEqual([
      '/take Rope of Climbing ',
      '/take gp ',
      '/take Rope ',
    ]);
    expect(suggest('/stash ro', lootCtx).items.map((i) => i.insert)).toEqual([
      '/stash Rope of Climbing ',
      '/stash Rope ',
    ]);
    expect(suggest('/take Rope of Climbing ', lootCtx).kind).toBe('none'); // chosen
    expect(suggest('/take ', ctx).kind).toBe('none'); // nothing available
  });
  it('is in the command list', () => {
    const r = suggest('/ta', ctx);
    expect(r.items.map((i) => i.insert)).toContain('/take ');
    expect(suggest('/st', ctx).items.map((i) => i.insert)).toContain('/stash ');
  });
});
