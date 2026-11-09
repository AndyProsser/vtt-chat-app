/**
 * Built-in character emblems. The app never loads images from the open web (its CSP forbids it), so
 * a character's avatar is one of these, stored as `emblem:<name>`; an uploaded portrait can come later.
 */
export const EMBLEMS = [
  'sword',
  'shield',
  'axe',
  'bow',
  'wand',
  'staff',
  'scroll',
  'potion',
  'crown',
  'skull',
  'ghost',
  'flame',
  'leaf',
  'moon',
  'sun',
  'star',
  'gem',
  'dragon',
] as const;

export type Emblem = (typeof EMBLEMS)[number];

export const emblemValue = (name: Emblem): string => `emblem:${name}`;

/** The emblem named by an avatar value, if it is one we ship. */
export function emblemOf(avatarUrl: string | null | undefined): Emblem | undefined {
  const name = avatarUrl?.startsWith('emblem:') ? avatarUrl.slice('emblem:'.length) : undefined;
  return (EMBLEMS as readonly string[]).includes(name ?? '') ? (name as Emblem) : undefined;
}

const UPLOADED = /^avatar:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The avatar value for a picture the player uploaded. */
export const avatarValue = (id: string): string => `avatar:${id}`;

/** The picture id behind an avatar value, if it is an uploaded portrait. */
export function uploadedAvatarId(avatarUrl: string | null | undefined): string | undefined {
  return avatarUrl ? UPLOADED.exec(avatarUrl)?.[1] : undefined;
}
