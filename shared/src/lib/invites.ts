/** The page an invitee opens: `https://host/join/CODE` (docs/architecture/JOIN-FLOW.md). */
export function inviteLink(server: string, code: string): string {
  return `${server.replace(/\/+$/, '')}/join/${encodeURIComponent(code)}`;
}

/**
 * What the DM pastes into a group chat: one line saying what it is, then the link on a line of its own so
 * every chat app turns it into a tappable link (and, with the server's link preview, a card).
 */
export function inviteMessage(input: {
  campaignName: string;
  dmName: string | undefined;
  link: string;
}): string {
  const name = input.campaignName.trim();
  const dm = input.dmName?.trim();
  return `You're invited to join ${name} on VTT Chat${dm ? `, run by ${dm}` : ''}.\n${input.link}`;
}
