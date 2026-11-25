/**
 * The handouts list, newest first: the one just shown is the one a player most likely wants. The server sends them oldest first
 * (the order they were made in), and that does not change, so each app turns the list round for display.
 */
export const newestFirst = <T>(oldestFirst: readonly T[]): T[] => [...oldestFirst].reverse();
