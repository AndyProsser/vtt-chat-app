import { CHAT_TEXT_MAX } from '../consts/index.js';
import type { ChatContext, ChatMember, ChatRsvp, ParsedComposerInput } from '../types/chat.js';
import { chatCommands, findBaseCommand, findChatLanguage } from './chatCommands.js';

const SLASH = /^\/(\S+)(?:\s+([\s\S]*))?$/;

const error = (message: string): ParsedComposerInput => ({ type: 'error', message });

const send = (
  kind: 'chat' | 'say' | 'do' | 'ooc',
  text: string,
  lang?: string,
): ParsedComposerInput => {
  if (text === '') return error('Type something to send.');
  if (text.length > CHAT_TEXT_MAX)
    return error(`That line is too long (limit ${CHAT_TEXT_MAX} characters).`);
  return lang === undefined ? { type: 'send', kind, text } : { type: 'send', kind, lang, text };
};

/** Every name a member can be addressed by: display name and character name. */
const namesOf = (m: ChatMember): string[] => {
  const names = [m.name];
  if (m.characterName && m.characterName !== m.name) names.push(m.characterName);
  return names.filter((n) => n.trim() !== '');
};

/**
 * Finds the member named at the start of `rest`, longest name first, so "Mary Ann hi" picks "Mary Ann" over
 * "Mary". A name must end at whitespace or the end of the text. No quoting syntax to learn.
 */
const matchMember = (
  rest: string,
  members: readonly ChatMember[],
): { member: ChatMember; text: string } | undefined => {
  const lower = rest.toLowerCase();
  let best: { member: ChatMember; length: number } | undefined;
  for (const member of members) {
    for (const name of namesOf(member)) {
      const n = name.toLowerCase();
      if (!lower.startsWith(n)) continue;
      const after = rest.charAt(n.length);
      if (after !== '' && !/\s/.test(after)) continue;
      if (!best || n.length > best.length) best = { member, length: n.length };
    }
  }
  return best && { member: best.member, text: rest.slice(best.length).trim() };
};

const QUICK: Record<string, { line: (who: string) => string; rsvp?: ChatRsvp }> = {
  late: { line: (w) => `${w} is running late`, rsvp: 'late' },
  cant: { line: (w) => `${w} can't make it`, rsvp: 'no' },
  work: { line: (w) => `${w} is still at work`, rsvp: 'late' },
  brb: { line: (w) => `${w} will be right back` },
  afk: { line: (w) => `${w} is away from the keyboard` },
  back: { line: (w) => `${w} is back` },
};

/**
 * Turns what was typed into the composer into what to do with it. Pure; the desktop and web composers share it
 * so they cannot disagree. A line that begins with "/" but names no command is plain chat (a stray slash must
 * never lose a message); `looksLikeTypo` lets the composer warn first.
 */
export const parseComposerInput = (input: string, ctx: ChatContext): ParsedComposerInput => {
  const text = input.trim();
  const m = SLASH.exec(text);
  if (!m) return send('chat', text);
  const word = (m[1] ?? '').toLowerCase();
  const rest = (m[2] ?? '').trim();

  if (word.startsWith('say-')) {
    const lang = findChatLanguage(word.slice(4));
    if (!lang) return send('chat', text);
    return send('say', rest, lang.key);
  }

  const command = findBaseCommand(word);
  if (!command) return send('chat', text);

  switch (command.name) {
    case 'say':
      return send('say', rest);
    case 'do':
      return send('do', rest);
    case 'ooc':
      return send('ooc', rest);
    case 'dm': {
      const self = ctx.members.find((x) => x.id === ctx.selfId);
      if (self?.role === 'dm')
        return error('You are the DM. There is no one to whisper to with /dm.');
      const dm = ctx.members.find((x) => x.role === 'dm' && x.id !== ctx.selfId);
      if (!dm) return error('There is no DM at this table to whisper to.');
      if (rest === '') return error('Type a message after /dm.');
      if (rest.length > CHAT_TEXT_MAX)
        return error(`That line is too long (limit ${CHAT_TEXT_MAX} characters).`);
      return { type: 'whisper', recipientId: dm.id, text: rest };
    }
    case 'tell': {
      if (rest === '') return error('Who do you want to whisper to? Use /tell <name> <text>.');
      const found = matchMember(rest, ctx.members);
      if (!found) return error(`No one at this table is called that. Use /tell <name> <text>.`);
      if (found.member.id === ctx.selfId) return error('You cannot whisper to yourself.');
      if (found.text === '') return error(`Type a message for ${found.member.name}.`);
      if (found.text.length > CHAT_TEXT_MAX)
        return error(`That line is too long (limit ${CHAT_TEXT_MAX} characters).`);
      return { type: 'whisper', recipientId: found.member.id, text: found.text };
    }
    default: {
      const quick = QUICK[command.name];
      if (!quick) return send('chat', text);
      const who = ctx.members.find((x) => x.id === ctx.selfId)?.name ?? 'Someone';
      const line = rest === '' ? quick.line(who) : `${quick.line(who)}: ${rest}`;
      if (line.length > CHAT_TEXT_MAX)
        return error(`That line is too long (limit ${CHAT_TEXT_MAX} characters).`);
      return quick.rsvp
        ? { type: 'quick', kind: 'ooc', text: line, rsvp: quick.rsvp }
        : { type: 'quick', kind: 'ooc', text: line };
    }
  }
};

/** Edit distance where swapping two neighbouring letters counts as one slip ("sya" for "say"). */
const distance = (a: string, b: string): number => {
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    d[i] = [];
    for (let j = 0; j <= b.length; j++) {
      if (i === 0 || j === 0) {
        (d[i] as number[])[j] = i + j;
        continue;
      }
      const row = d[i] as number[];
      const up = d[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min((up[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (up[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, ((d[i - 2] as number[])[j - 2] ?? 0) + 1);
      }
      row[j] = best;
    }
  }
  return (d[a.length] as number[])[b.length] ?? 0;
};

/**
 * True when the line starts with an unknown "/word" that is clearly a slip for a real command ("/sya", "/tel",
 * "/say-elvsh", "/say-klingon"). The line still sends as plain chat; the composer uses this to warn first.
 * Things like "/shrug" or a pasted path are not flagged.
 */
export const looksLikeTypo = (input: string): boolean => {
  const m = SLASH.exec(input.trim());
  if (!m) return false;
  const word = (m[1] ?? '').toLowerCase();
  if (word.startsWith('say-')) return findChatLanguage(word.slice(4)) === undefined;
  if (findBaseCommand(word)) return false;
  const limit = word.length >= 4 ? 2 : 1;
  return chatCommands().some((c) =>
    [c.name, ...c.aliases].some((n) => n.length > 1 && distance(word, n) <= limit),
  );
};
