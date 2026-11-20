import type { Member } from '../types/index.js';

export { inviteLink, inviteMessage } from '@vtt-chat-app/shared';

/** Who the DM role can be handed to: the players, not oneself. */
export function otherPlayers(members: Member[], selfId: string | null): Member[] {
  return members.filter((m) => m.role === 'player' && m.userId !== selfId);
}
