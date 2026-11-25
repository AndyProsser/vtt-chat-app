import type { SenseKind } from '@vtt-chat-app/shared';

import { ABILITY_ICON, ICON, SENSE_ICON, VITAL_ICON, type IconName } from '../consts/icons.js';

/** A named icon from the shared vocabulary: lucide's 24x24 stroke icon, drawn in the current text colour. */
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Glyph = ICON[name];
  return <Glyph size={size} aria-hidden focusable="false" />;
}

/** The icon for a special sense (darkvision, blindsight, ...), the same in both apps. */
export function SenseIcon({ kind, size = 14 }: { kind: SenseKind; size?: number }) {
  const Glyph = SENSE_ICON[kind];
  return <Glyph size={size} aria-hidden focusable="false" />;
}

/**
 * The icon for a character's quick number (`ac`, `hp`, `pp`). A key this build does not know shows the shield rather
 * than nothing, because the tiles come from a list that may grow.
 */
export function VitalIcon({ vital, size = 16 }: { vital: string; size?: number }) {
  const Glyph = (VITAL_ICON as Record<string, typeof ICON.shield>)[vital] ?? ICON.shield;
  return <Glyph size={size} aria-hidden focusable="false" />;
}

/**
 * A large, faint picture of an ability (see `ABILITY_ICON`) for the corner of its tile. The tile must be
 * `position: relative` with `overflow: hidden`; the mark never takes a click and is hidden from assistive technology.
 */
export function AbilityMark({ ability, size = 38 }: { ability: string; size?: number }) {
  const Glyph = (ABILITY_ICON as Record<string, typeof ICON.shield | undefined>)[ability];
  if (!Glyph) return null;
  return (
    <Glyph className="ui-watermark" size={size} strokeWidth={1.5} aria-hidden focusable="false" />
  );
}
