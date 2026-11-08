import type { Member, PartyView } from '../types/index.js';

export interface Lane {
  /** The party id, or `null` for the main table. */
  id: string | null;
  name: string;
  members: Member[];
}

/** The groups as drop targets: the main table first, then each party in its order. The DM is in every group, so is in none of them. */
export function lanes(members: Member[], view: PartyView): Lane[] {
  const known = new Set(view.parties.map((p) => p.id));
  const players = members.filter((m) => m.role !== 'dm');
  const inLane = (id: string | null) =>
    players.filter((m) => {
      const assigned = view.assignments[m.userId];
      const lane = assigned !== undefined && known.has(assigned) ? assigned : null;
      return lane === id;
    });
  return [
    { id: null, name: 'Main table', members: inLane(null) },
    ...view.parties.map((p) => ({ id: p.id, name: p.name, members: inLane(p.id) })),
  ];
}

/** The `party.move` payload for dropping `userId` on `laneId`, or nothing if they are already there. */
export function moveCommand(
  view: PartyView,
  userId: string,
  laneId: string | null,
): { userId: string; partyId: string | null } | undefined {
  const assigned = view.assignments[userId];
  const current =
    assigned !== undefined && view.parties.some((p) => p.id === assigned) ? assigned : null;
  return current === laneId ? undefined : { userId, partyId: laneId };
}
