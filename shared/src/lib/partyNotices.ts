/** The voice groups as a client holds them (what `party.state` carries, the parts that matter here). */
export interface PartyStateLike {
  parties: readonly { id: string; name: string }[];
  /** userId → party id; absent means the main table. */
  assignments: Readonly<Record<string, string>>;
  /** A private talk in progress: the DM and one player hear only each other. */
  aside?: { dmId: string; playerId: string } | null;
}

/**
 * The lines the table is shown when voice groups change, so nobody is surprised by who can hear whom:
 * "Mira joined Cellar", "Mira left Cellar and rejoined the table", "The DM took Mira aside for a private talk".
 * `nameOf` turns a user id into the name people know them by (their character, if they have one).
 * Pure: the caller decides where the lines go (chat, a toast) and skips the first state after connecting.
 */
export function describePartyChange(
  prev: PartyStateLike,
  next: PartyStateLike,
  nameOf: (userId: string) => string,
): string[] {
  const out: string[] = [];
  const partyName = (state: PartyStateLike, id: string | undefined): string | undefined =>
    id === undefined ? undefined : (state.parties.find((p) => p.id === id)?.name ?? 'a group');

  const hadAside = prev.aside ?? null;
  const hasAside = next.aside ?? null;
  if (!hadAside && hasAside)
    out.push(`The DM took ${nameOf(hasAside.playerId)} aside for a private talk`);
  else if (hadAside && !hasAside) out.push('The private talk ended');
  else if (hadAside && hasAside && hadAside.playerId !== hasAside.playerId)
    out.push(`The DM took ${nameOf(hasAside.playerId)} aside for a private talk`);

  const hadSplit = prev.parties.length > 0;
  const people = [...new Set([...Object.keys(prev.assignments), ...Object.keys(next.assignments)])];
  const moves: string[] = [];
  for (const id of people.sort()) {
    const before = partyName(prev, prev.assignments[id]);
    const after = partyName(next, next.assignments[id]);
    if (before === after) continue;
    const who = nameOf(id);
    if (before && after) moves.push(`${who} moved from ${before} to ${after}`);
    else if (after) moves.push(`${who} joined ${after}`);
    else if (next.parties.length > 0) moves.push(`${who} rejoined the main table`);
    // a person back at the table because the whole split ended is covered by the line below
  }
  if (hadSplit && next.parties.length === 0) out.push('The table is together again');
  else out.push(...moves);
  return out;
}
