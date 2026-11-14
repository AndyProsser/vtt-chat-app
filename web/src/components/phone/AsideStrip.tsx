import { Text } from '@radix-ui/themes';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';

/**
 * While the DM talks privately with one player, everyone at the table is told, so the DM's silence is not a mystery.
 * (The web has no voice of its own; this mirrors what the desktop app shows.)
 */
export function AsideStrip() {
  const aside = usePhoneStore((s) => s.parties.aside);
  const members = usePhoneStore((s) => s.members);
  const userId = usePhoneStore((s) => s.userId);
  if (!aside) return null;
  const m = members.find((x) => x.userId === aside.playerId);
  const name = m?.character?.name ?? m?.displayName ?? 'a player';
  const text =
    userId === aside.dmId
      ? `Private talk with ${name}. You cannot hear the table.`
      : userId === aside.playerId
        ? 'Private talk with the DM. You cannot hear the table. Chat still works.'
        : `The DM is speaking privately with ${name}. They cannot hear the table. Chat still works.`;
  return (
    <Text size="1" className="phone-aside" role="status">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>{' '}
      {text}
    </Text>
  );
}
