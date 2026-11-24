import { senseLabel, type CharacterSheet } from '@vtt-chat-app/shared';
import { SenseIcon } from '@vtt-chat-app/ui-kit';
import { Eye, Heart, Shield } from 'lucide-react';

/**
 * The quick numbers on a character, as icon chips (armour class, hit points, passive perception, special senses with their range), for the
 * hover card and the character screen. Icons rather than emoji so they follow light and dark. Nothing when there is no sheet.
 */
export function SheetChips({ sheet }: { sheet: CharacterSheet | null | undefined }) {
  if (!sheet) return null;
  return (
    <div className="vtt-sheet-stats">
      <span className="vtt-sheet-stat" title={`Armour class ${sheet.armorClass}`}>
        <Shield size={12} aria-hidden />
        <b>{sheet.armorClass}</b>
        <span className="vtt-visually-hidden">Armour class</span>
      </span>
      <span className="vtt-sheet-stat" title={`Hit points ${sheet.maxHp}`}>
        <Heart size={12} aria-hidden />
        <b>{sheet.maxHp}</b>
        <span className="vtt-visually-hidden">Hit points</span>
      </span>
      <span className="vtt-sheet-stat" title={`Passive Perception ${sheet.passivePerception}`}>
        <Eye size={12} aria-hidden />
        <b>{sheet.passivePerception}</b>
        <span className="vtt-visually-hidden">Passive Perception</span>
      </span>
      {(sheet.senses ?? []).map((s) => {
        return (
          <span key={s.kind} className="vtt-sheet-stat" title={senseLabel(s)}>
            <SenseIcon kind={s.kind} size={12} />
            <b>{s.range}</b>
            <span className="vtt-visually-hidden">{senseLabel(s)}</span>
          </span>
        );
      })}
    </div>
  );
}
