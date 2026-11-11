import type { Member } from '../types/index.js';

const label = (m: Member) => (m.character?.name ?? m.displayName).toLowerCase();

/** The DM first; then players alphabetically by character (or account) name, offline players last. */
export function railOrder(members: Member[]): Member[] {
  const rank = (m: Member) => (m.role === 'dm' ? 0 : m.online ? 1 : 2);
  return [...members].sort((a, b) => rank(a) - rank(b) || label(a).localeCompare(label(b)));
}

export interface MemberCard {
  title: string;
  lines: string[];
}

/** The hover card: only fields that exist (characters are optional), never "undefined". */
export function memberCard(m: Member): MemberCard {
  const c = m.character;
  const lines: string[] = [];
  if (m.role === 'dm') lines.push('DM');
  if (c) {
    const classLevel = [c.className, c.level].filter((v) => v != null && v !== '').join(' ');
    const detail = [c.race, classLevel].filter((v) => v != null && v !== '').join(' · ');
    if (detail) lines.push(detail);
    lines.push(m.displayName);
  }
  return { title: c?.name ?? m.displayName, lines };
}

/** Roster members who are currently speaking; identities not on the roster are ignored. */
export function speakingMembers(members: Member[], speaking: ReadonlySet<string>): string[] {
  return members.filter((m) => speaking.has(m.userId)).map((m) => m.userId);
}

/** One or two capital letters for an avatar. */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase());
  return letters.length ? letters.join('') : '?';
}

/** The portrait to show for someone: their character's if it has one, else their own, else none (initials). */
export function memberAvatar(m: Member): string | undefined {
  return m.character?.avatarUrl || m.avatarUrl || undefined;
}

export type RailState = 'disconnected' | 'offline' | 'away' | 'online' | 'voice';

/**

 * How a person shows on the rail: Disconnected (app closed or signed out), Offline (they chose it; chat
 * still works), Away (amber), Online for chat only, and "voice" once they are in the room.
 */
export function railState(m: Pick<Member, 'online' | 'inVoice' | 'status'>): RailState {
  if (!m.online) return 'disconnected';
  if (m.status === 'offline') return 'offline';
  if (m.status === 'away') return 'away';
  return m.inVoice ? 'voice' : 'online';
}

/** Rail avatar diameter in px; mirrored by `--vtt-rail-av` in main.css (the web chat's rail is 40). */
export const RAIL_AVATAR_PX = 46;
/** Emblem size inside a rail avatar, about half its diameter. */
export const RAIL_ICON_PX = Math.round(RAIL_AVATAR_PX / 2);

/** The rail avatar's accessible name: the DM's tag is visual only, so the name carries "DM". */
export function railAvatarLabel(m: Pick<Member, 'role' | 'displayName' | 'character'>): string {
  const title = m.character?.name ?? m.displayName;
  return m.role === 'dm' ? `${title}, DM` : title;
}
