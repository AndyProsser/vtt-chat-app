import {
  abilityTiles,
  classesLine,
  senseLabel,
  vitalTiles,
  type CharacterSheet,
} from '@vtt-chat-app/shared';

import { AbilityMark, SenseIcon, VitalIcon } from '@vtt-chat-app/ui-kit';

/**
 * A linked character's numbers as tiles, in the spirit of the D&D Beyond sheet: armour class, hit points and
 * passive perception on one row, then all six abilities on a single row (modifier large, score small).
 */
export function CharacterStats({ sheet }: { sheet: CharacterSheet }) {
  return (
    <div
      className="phone-stats"
      title="Worked out from your D&D Beyond sheet; check it there for unusual builds"
    >
      {classesLine(sheet) && <div className="phone-classes">{classesLine(sheet)}</div>}
      <div className="phone-vitals">
        {vitalTiles(sheet).map((t) => (
          <div key={t.key} className="phone-vital" data-vital={t.key}>
            <VitalIcon vital={t.key} size={16} />
            <b>{t.value}</b>
            <span>{t.label}</span>
          </div>
        ))}
      </div>
      {(sheet.senses ?? []).length > 0 && (
        <ul className="phone-senses" aria-label="Senses">
          {(sheet.senses ?? []).map((s) => (
            <li key={s.kind}>
              <SenseIcon kind={s.kind} size={14} /> {senseLabel(s)}
            </li>
          ))}
        </ul>
      )}
      <div className="phone-abilities">
        {abilityTiles(sheet).map((t) => (
          <div key={t.key} className="phone-ability" data-ability={t.key}>
            <AbilityMark ability={t.key} />
            <span>{t.label}</span>
            <b>{t.value}</b>
            <i>{t.sub}</i>
          </div>
        ))}
      </div>
    </div>
  );
}
