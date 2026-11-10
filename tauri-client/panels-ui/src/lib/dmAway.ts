/** The grace period when the server did not report one (it is an operator setting, default 30 seconds). */
export const DEFAULT_GRACE_SECONDS = 30;

/**
 * Whether the DM has been disconnected for longer than the grace period, so a player may step in on the
 * recording. `awaySince` is when this window saw the DM go offline (`null` while they are connected).
 * The server is the real gate; this only decides whether to show the buttons.
 */
export function dmAwayLongEnough(
  awaySince: number | null,
  now: number,
  graceSeconds: number | undefined,
): boolean {
  if (awaySince === null) return false;
  return now - awaySince >= (graceSeconds ?? DEFAULT_GRACE_SECONDS) * 1000;
}
