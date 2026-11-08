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
