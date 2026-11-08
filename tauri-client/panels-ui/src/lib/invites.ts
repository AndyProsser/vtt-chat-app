import type { Member } from '../types/index.js';

/** The page an invitee opens: `https://host/join/CODE` (docs/architecture/JOIN-FLOW.md). */
export function inviteLink(server: string, code: string): string {
  return `${server.replace(/\/+$/, '')}/join/${encodeURIComponent(code)}`;
}

/** Who the DM role can be handed to: the players, not oneself. */
export function otherPlayers(members: Member[], selfId: string | null): Member[] {
  return members.filter((m) => m.role === 'player' && m.userId !== selfId);
}
