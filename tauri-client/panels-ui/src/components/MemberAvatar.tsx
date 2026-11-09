import { avatarColor } from '../lib/avatarColor.js';
import { initials, memberAvatar } from '../lib/rail.js';
import type { Member } from '../types/index.js';
import { Portrait } from './Portrait.js';

/** A small round portrait of a person: their character's, else their own, else initials. */
export function MemberAvatar({ member }: { member: Member }) {
  const name = member.character?.name ?? member.displayName;
  return (
    <i className="vtt-chip-av vtt-mini-av" style={{ background: avatarColor(member.userId) }}>
      <Portrait avatarUrl={memberAvatar(member)} fallback={initials(name)} size={12} />
    </i>
  );
}
