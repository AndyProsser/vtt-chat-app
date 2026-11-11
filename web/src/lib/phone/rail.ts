import type { Member } from '../../types/phone.js';

/**
 * How a person shows on the members strip. Same meanings as the desktop rail's dot (USER-GUIDE section 3),
 * minus voice: disconnected = app closed or signed out, offline = their own choice (chat still works),
 * away = amber, online = connected.
 */
export type Presence = 'online' | 'away' | 'offline' | 'disconnected';

export function presenceOf(m: Pick<Member, 'online' | 'status'>): Presence {
  if (!m.online) return 'disconnected';
  if (m.status === 'offline') return 'offline';
  if (m.status === 'away') return 'away';
  return 'online';
}

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: 'Online',
  away: 'Away',
  offline: 'Offline (chat only)',
  disconnected: 'Disconnected (app closed or signed out)',
};

const shownName = (m: Member) => m.character?.name ?? m.displayName;

/** The DM first; then online, away and offline people, each group alphabetical by character (or account) name. */
export function railOrder(members: readonly Member[]): Member[] {
  const rank = (m: Member) => {
    if (m.role === 'dm') return 0;
    const p = presenceOf(m);
    return p === 'online' ? 1 : p === 'away' ? 2 : 3;
  };
  return [...members].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      shownName(a).toLowerCase().localeCompare(shownName(b).toLowerCase()) ||
      a.userId.localeCompare(b.userId),
  );
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

const UPLOADED = /^avatar:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The portrait to show, as a same-origin picture URL: their character's uploaded picture, else their own.
 * Built-in emblems (`emblem:sword`) are drawn by the desktop app only; here they fall back to initials.
 */
export function portraitUrl(m: Member): string | undefined {
  for (const value of [m.character?.avatarUrl, m.avatarUrl]) {
    const id = value ? UPLOADED.exec(value)?.[1] : undefined;
    if (id) return `/api/avatars/${id}`;
  }
  return undefined;
}

export interface MemberCard {
  title: string;
  /** Only fields that exist (characters are optional), never "undefined". */
  lines: string[];
  presence: Presence;
}

/** The details popout: the desktop hover card's fields (DM mark, race, class and level, account name). */
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
  return { title: c?.name ?? m.displayName, lines, presence: presenceOf(m) };
}
