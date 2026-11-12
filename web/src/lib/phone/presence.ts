import type { Member } from '../../types/phone.js';

const asObject = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** A status from the server; one that predates it is online when in voice and offline otherwise. */
const toStatus = (raw: unknown, inVoice: boolean): NonNullable<Member['status']> =>
  raw === 'online' || raw === 'away' || raw === 'offline' ? raw : inVoice ? 'online' : 'offline';

/**
 * Applies a live presence frame to the member list so the rail's dots follow people coming and going:
 * `presence.update` (connected or not) and `audio.update` (their own online/away/offline choice). Returns
 * the same array when nothing changed (or the person is unknown), so the store does not re-render.
 */
export function applyPresenceFrame(members: Member[], type: string, data: unknown): Member[] {
  const d = asObject(data);
  const userId = typeof d.userId === 'string' ? d.userId : undefined;
  if (!userId) return members;
  let patch: Partial<Member>;
  if (type === 'presence.update') patch = { online: d.online === true };
  else if (type === 'audio.update') patch = { status: toStatus(d.status, d.inVoice === true) };
  else return members;
  let changed = false;
  const next = members.map((m) => {
    if (m.userId !== userId) return m;
    if ((Object.keys(patch) as (keyof Member)[]).every((k) => m[k] === patch[k])) return m;
    changed = true;
    return { ...m, ...patch };
  });
  return changed ? next : members;
}
