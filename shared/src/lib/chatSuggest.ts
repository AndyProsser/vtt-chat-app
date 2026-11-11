import { BASE_CHAT_COMMANDS, CHAT_LANGUAGES } from '../consts/chat.js';
import type { ChatContext, ChatSuggestion, ChatSuggestions } from '../types/chat.js';
import { findChatLanguage } from './chatCommands.js';

const NONE: ChatSuggestions = { kind: 'none', items: [] };

/**
 * What the composer's autocomplete list should show for the line as typed so far. Every `insert` is the full
 * replacement text for the composer line, so a UI just sets the field to it.
 */
export const suggest = (input: string, ctx: ChatContext): ChatSuggestions => {
  if (!input.startsWith('/')) return NONE;

  // "/say-" and a prefix: the languages.
  const lang = /^\/say-(\S*)$/i.exec(input);
  if (lang) {
    const prefix = (lang[1] ?? '').toLowerCase();
    if (findChatLanguage(prefix)?.key === prefix) return NONE; // already complete
    const items: ChatSuggestion[] = CHAT_LANGUAGES.filter(
      (l) =>
        l.key.startsWith(prefix) ||
        l.name.toLowerCase().startsWith(prefix) ||
        l.aliases.some((a) => a.startsWith(prefix)),
    ).map((l) => ({
      label: `/say-${l.key}`,
      insert: `/say-${l.key} `,
      description: `Speak ${l.name}`,
    }));
    return items.length ? { kind: 'languages', items } : NONE;
  }

  // "/tell " or "/w ": the members.
  const tell = /^\/(tell|w)\s+([\s\S]*)$/i.exec(input);
  if (tell) {
    const word = (tell[1] ?? '').toLowerCase();
    const typed = tell[2] ?? '';
    const prefix = typed.toLowerCase();
    const others = ctx.members.filter((m) => m.id !== ctx.selfId);
    // A whole name followed by a space means the name is chosen; stop suggesting.
    const chosen = others.some((m) =>
      [m.name, m.characterName].some(
        (n) => n && prefix.trimEnd() === n.toLowerCase() && /\s$/.test(typed),
      ),
    );
    if (chosen) return NONE;
    const items: ChatSuggestion[] = [];
    for (const m of others) {
      const names = [m.characterName, m.name].filter((n): n is string => !!n);
      const hit = names.find((n) => n.toLowerCase().startsWith(prefix));
      if (hit === undefined) continue;
      const other = names.find((n) => n !== hit);
      items.push({
        label: hit,
        insert: `/${word} ${hit} `,
        description: m.role === 'dm' ? 'DM' : (other ?? 'Player'),
      });
    }
    return items.length ? { kind: 'members', items } : NONE;
  }

  // "/xxx" with no space yet: the commands.
  const cmd = /^\/(\S*)$/.exec(input);
  if (cmd) {
    const prefix = (cmd[1] ?? '').toLowerCase();
    const items: ChatSuggestion[] = [];
    for (const c of BASE_CHAT_COMMANDS) {
      const word = [c.name, ...c.aliases].find((n) => n.startsWith(prefix));
      if (word === undefined) continue;
      items.push({
        label: c.usage.replace(/^\/\S+/, `/${word}`),
        insert: `/${word} `,
        description: c.description,
      });
    }
    return items.length ? { kind: 'commands', items } : NONE;
  }
  return NONE;
};
