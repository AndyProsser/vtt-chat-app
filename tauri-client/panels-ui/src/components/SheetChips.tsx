import { senseLabel, type CharacterSheet, type SenseKind } from '@vtt-chat-app/shared';
import { Heart, Moon, Radar, ScanEye, Shield, Waves, type LucideIcon } from 'lucide-react';

/** An icon for each special sense, so a hover card can show "Darkvision 60" as a moon and a small number. */
export const SENSE_ICON: Record<SenseKind, LucideIcon> = {
  darkvision: Moon,
  blindsight: Radar,
  tremorsense: Waves,
  truesight: ScanEye,
};

/**
 * The quick numbers on a character, as icon chips (armour class, hit points, special senses with their range), for the
 * hover card and the character screen. Icons rather than emoji so they follow light and dark. Nothing when there is no sheet.
 */
export function SheetChips({ sheet }: { sheet: CharacterSheet | null | undefined }) {
  if (!sheet) return null;
  return (
    <div className="vtt-chips">
      <span className="vtt-chip" title={`Armour class ${sheet.armorClass}`}>
        <Shield size={12} aria-hidden />
        <b>{sheet.armorClass}</b>
        <span className="vtt-visually-hidden">Armour class</span>
      </span>
      <span className="vtt-chip" title={`Hit points ${sheet.maxHp}`}>
        <Heart size={12} aria-hidden />
        <b>{sheet.maxHp}</b>
        <span className="vtt-visually-hidden">Hit points</span>
      </span>
      {(sheet.senses ?? []).map((s) => {
        const Icon = SENSE_ICON[s.kind];
        return (
          <span key={s.kind} className="vtt-chip" title={senseLabel(s)}>
            <Icon size={12} aria-hidden />
            <b>{s.range}</b>
            <span className="vtt-visually-hidden">{senseLabel(s)}</span>
          </span>
        );
      })}
    </div>
  );
}
