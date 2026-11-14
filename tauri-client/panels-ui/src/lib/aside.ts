import type { Member, PartyView } from '../types/index.js';

export type AsideRole = 'dm' | 'player' | 'table';

export interface AsideInfo {
  /** What the signed-in person is: the DM in it, the player in it, or one of the rest of the table. */
  role: AsideRole;
  /** The player the DM took aside, by the name the table knows them by. */
  name: string;
  playerId: string;
}

const nameOf = (members: readonly Member[], id: string): string => {
  const m = members.find((x) => x.userId === id);
  return m?.character?.name ?? m?.displayName ?? 'a player';
};

/** The private talk in progress, as this person sees it (`undefined` when there is none). */
export function asideInfo(
  view: PartyView,
  members: readonly Member[],
  selfId: string | null,
): AsideInfo | undefined {
  const a = view.aside;
  if (!a) return undefined;
  const role: AsideRole = selfId === a.dmId ? 'dm' : selfId === a.playerId ? 'player' : 'table';
  return { role, name: nameOf(members, a.playerId), playerId: a.playerId };
}

/** The banner's words, for each person's side of it. */
export function asideText(info: AsideInfo): { title: string; detail: string } {
  switch (info.role) {
    case 'dm':
      return {
        title: `Private talk with ${info.name}`,
        detail: 'Only they can hear you, and you cannot hear the table.',
      };
    case 'player':
      return {
        title: 'Private talk with the DM',
        detail: 'Only the DM can hear you, and you cannot hear the table. Chat still works.',
      };
    case 'table':
      return {
        title: `The DM is speaking privately with ${info.name}`,
        detail: 'The DM cannot hear the table right now. Chat still works.',
      };
  }
}

/**
 * What a double-click on a player does for the DM: take them aside, or end the talk if it is already with them.
 * The payload is the `party.aside` frame's `userId`.
 */
export function asideToggle(view: PartyView, userId: string): string | null {
  return view.aside?.playerId === userId ? null : userId;
}
