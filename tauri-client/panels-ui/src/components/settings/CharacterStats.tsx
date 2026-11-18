import { abilityTiles, vitalTiles, type CharacterSheet } from '@vtt-chat-app/shared';
import { Eye, Heart, Shield, type LucideIcon } from 'lucide-react';

const VITAL_ICON: Record<string, LucideIcon> = { ac: Shield, hp: Heart, pp: Eye };

/**
 * A linked character's numbers as tiles, in the spirit of the D&D Beyond sheet: armour class, hit points and
 * passive perception on one row, then all six abilities on a single row (modifier large, score small).
 */
export function CharacterStats({ sheet }: { sheet: CharacterSheet }) {
  return (
    <div
      className="vtt-stats"
      title="Worked out from your D&D Beyond sheet; check it there for unusual builds"
    >
      <div className="vtt-vitals">
        {vitalTiles(sheet).map((t) => {
          const Icon = VITAL_ICON[t.key] ?? Shield;
          return (
            <div key={t.key} className="vtt-vital" data-vital={t.key}>
              <Icon size={14} aria-hidden />
              <b>{t.value}</b>
              <span>{t.label}</span>
            </div>
          );
        })}
      </div>
      <div className="vtt-abilities">
        {abilityTiles(sheet).map((t) => (
          <div key={t.key} className="vtt-ability" data-ability={t.key}>
            <span>{t.label}</span>
            <b>{t.value}</b>
            <i>{t.sub}</i>
          </div>
        ))}
      </div>
    </div>
  );
}
