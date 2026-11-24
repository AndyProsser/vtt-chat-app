import { Dialog } from '@radix-ui/themes';
import {
  abilityTiles,
  classesLine,
  senseLabel,
  vitalTiles,
  type CharacterSheet,
} from '@vtt-chat-app/shared';

import { SenseIcon, VitalIcon } from '@vtt-chat-app/ui-kit';
import type { Member } from '../../types/phone.js';

/**
 * The larger popup behind a rail card: the full picture of a character that has a linked sheet (classes with their
 * subclasses, vitals, the six abilities, special senses). Worked out from the D&D Beyond sheet by this app.
 */
export function CharacterDetail({
  member,
  sheet,
  open,
  onOpenChange,
}: {
  member: Member;
  sheet: CharacterSheet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const c = member.character;
  const classes = classesLine(sheet) ?? [c?.className, c?.level].filter(Boolean).join(' ');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="420px" className="phone-detail">
        <Dialog.Title size="3">{c?.name ?? member.displayName}</Dialog.Title>
        <Dialog.Description size="1" color="gray">
          {[c?.race, classes].filter(Boolean).join(' · ')}
          {c ? ` · played by ${member.displayName}` : ''}
        </Dialog.Description>
        <div className="phone-vitals">
          {vitalTiles(sheet).map((t) => (
            <div key={t.key} className="phone-vital" data-vital={t.key}>
              <VitalIcon vital={t.key} size={16} />
              <b>{t.value}</b>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
        <div className="phone-abilities">
          {abilityTiles(sheet).map((t) => (
            <div key={t.key} className="phone-ability" data-ability={t.key}>
              <span>{t.label}</span>
              <b>{t.value}</b>
              <i>{t.sub}</i>
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
      </Dialog.Content>
    </Dialog.Root>
  );
}
