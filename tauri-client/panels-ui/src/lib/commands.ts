import type { ChatLine, Member } from '../types/index.js';

export type Role = 'dm' | 'player';

export type Parsed =
  | { kind: 'say'; text: string }
  | { kind: 'whisper'; toUserId: string; text: string }
  | { kind: 'voice'; name: string }
  | { kind: 'open'; target: 'inventory' }
  | { kind: 'error'; message: string };

export interface CommandContext {
  role: Role;
  selfId: string | null;
  selfName: string;
  members: Member[];
}

export interface CommandInfo {
  name: string;
  usage: string;
  help: string;
  roles: Role[];
}

/** The DM's character voices, as `rust_livekit::Voice` names them. */
export const VOICES = [
  'normal',
  'giant',
  'imp',
  'robot',
  'demon',
  'dragon',
  'god',
  'drunk',
  'authoritative',
] as const;

/** The slash commands offered in the palette. */
export const COMMANDS: readonly CommandInfo[] = [
  { name: '/w', usage: '/w <name> <text>', help: 'Whisper to one person', roles: ['dm', 'player'] },
  { name: '/dm', usage: '/dm <text>', help: 'Message only the DM', roles: ['player'] },
  {
    name: '/me',
    usage: '/me <text>',
    help: 'An emote: * you do something',
    roles: ['dm', 'player'],
  },
  {
    name: '/voice',
    usage: '/voice <name>',
    help: `Change your voice: ${VOICES.join(', ')}`,
    roles: ['dm'],
  },
  { name: '/loot', usage: '/loot', help: 'Open the party inventory', roles: ['dm', 'player'] },
  {
    name: '/take',
    usage: '/take',
    help: 'Open the party inventory to grab an item',
    roles: ['dm', 'player'],
  },
];

const err = (message: string): Parsed => ({ kind: 'error', message });

/** Who `name` means: exact match on character or account name, else a unique prefix. */
function findMember(name: string, ctx: CommandContext): Member | 'none' | 'ambiguous' {
  const wanted = name.toLowerCase();
  const names = (m: Member) =>
    [m.character?.name, m.displayName].map((n) => (n ?? '').toLowerCase());
  const others = ctx.members.filter((m) => m.userId !== ctx.selfId);
  const exact = others.filter((m) => names(m).includes(wanted));
  const pool =
    exact.length > 0 ? exact : others.filter((m) => names(m).some((n) => n.startsWith(wanted)));
  if (pool.length === 0) return 'none';
  return pool.length === 1 ? pool[0]! : 'ambiguous';
}

/** Turns what was typed into what to do. Nothing that fails to parse is ever sent as chat. */
export function parseCommand(input: string, ctx: CommandContext): Parsed {
  const text = input.trim();
  if (!text.startsWith('/')) return { kind: 'say', text };
  const [command = '', ...rest] = text.split(/\s+/);
  const body = text.slice(command.length).trim();
  switch (command.toLowerCase()) {
    case '/w': {
      const [name, ...words] = rest;
      const message = words.join(' ');
      if (!name) return err('Whisper to whom? Try /w name message');
      const target = findMember(name, ctx);
      if (target === 'none') return err(`No one called “${name}” at this table.`);
      if (target === 'ambiguous')
        return err(`“${name}” could be more than one person; type more of the name.`);
      if (!message) return err(`What should I whisper to ${name}?`);
      return { kind: 'whisper', toUserId: target.userId, text: message };
    }
    case '/dm': {
      if (ctx.role === 'dm') return err('You are the DM.');
      const dm = ctx.members.find((m) => m.role === 'dm');
      if (!dm) return err('There is no DM at this table yet.');
      return body
        ? { kind: 'whisper', toUserId: dm.userId, text: body }
        : err('What should I tell the DM?');
    }
    case '/me':
      return body
        ? { kind: 'say', text: `* ${ctx.selfName} ${body}` }
        : err('Do what? Try /me waves');
    case '/loot':
    case '/take':
      return { kind: 'open', target: 'inventory' };
    case '/voice': {
      if (ctx.role !== 'dm') return err('Only the DM can change voices.');
      const name = rest[0]?.toLowerCase();
      if (!name) return err(`Which voice? ${VOICES.join(', ')}`);
      if (!(VOICES as readonly string[]).includes(name)) {
        return err(`No voice called “${name}”. Try: ${VOICES.join(', ')}`);
      }
      return { kind: 'voice', name };
    }
    default:
      return err(
        command === '/' ? 'Type a command after the slash, e.g. /w' : `Unknown command ${command}.`,
      );
  }
}

/** Commands matching what has been typed so far, for this role. Empty unless it starts with `/`. */
export function commandPalette(input: string, role: Role): CommandInfo[] {
  const typed = input.trimStart();
  if (!typed.startsWith('/')) return [];
  const word = typed.split(/\s+/)[0]!.toLowerCase();
  return COMMANDS.filter((c) => c.roles.includes(role) && c.name.startsWith(word));
}

/** How to style a line: public, a whisper between players, or the DM speaking privately. */
export function lineKind(line: ChatLine, members: Member[]): 'public' | 'whisper' | 'dm-private' {
  if (line.to === undefined) return 'public';
  const sender = members.find((m) => m.userId === line.from.userId);
  return sender?.role === 'dm' ? 'dm-private' : 'whisper';
}
