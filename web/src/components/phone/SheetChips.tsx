import { senseLabel, type CharacterSheet } from '@vtt-chat-app/shared';

import { Icon, SenseIcon } from '@vtt-chat-app/ui-kit';

/**
 * The quick numbers on a character as icon chips: armour class, hit points and each special sense with its range.
 * Icons, not emoji, so they follow light and dark. Nothing when there is no sheet.
 */
export function SheetChips({ sheet }: { sheet: CharacterSheet | null | undefined }) {
  if (!sheet) return null;
  return (
    <div className="phone-chips">
      <span className="phone-chip" title={`Armour class ${sheet.armorClass}`}>
        <Icon name="shield" size={12} />
        <b>{sheet.armorClass}</b>
        <span className="phone-sr">Armour class</span>
      </span>
      <span className="phone-chip" title={`Hit points ${sheet.maxHp}`}>
        <Icon name="heart" size={12} />
        <b>{sheet.maxHp}</b>
        <span className="phone-sr">Hit points</span>
      </span>
      <span className="phone-chip" title={`Passive Perception ${sheet.passivePerception}`}>
        <Icon name="eye" size={12} />
        <b>{sheet.passivePerception}</b>
        <span className="phone-sr">Passive Perception</span>
      </span>
      {(sheet.senses ?? []).map((s) => (
        <span key={s.kind} className="phone-chip" title={senseLabel(s)}>
          <SenseIcon kind={s.kind} size={12} />
          <b>{s.range}</b>
          <span className="phone-sr">{senseLabel(s)}</span>
        </span>
      ))}
    </div>
  );
}
