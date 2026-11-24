import { Dialog } from '@radix-ui/themes';
import {
  abilityTiles,
  characterDetails,
  classesLine,
  senseLabel,
  vitalTiles,
  type CharacterSheet,
} from '@vtt-chat-app/shared';
import { SenseIcon, VitalIcon } from '@vtt-chat-app/ui-kit';

import type { Member } from '../types/index.js';

/**
 * The larger popup behind a hover card: the full picture of a character that has a linked sheet (classes with their
 * subclasses, vitals, the six abilities, special senses). The numbers are worked out from the D&D Beyond sheet by this
 * app and say so; the sheet itself is always right.
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
  const classes =
    classesLine(sheet) ??
    (c
      ? characterDetails({
          race: null,
          className: c.className ?? null,
          level: c.level ?? null,
        })
      : '');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="420px" className="vtt-detail">
        <Dialog.Title size="3">{c?.name ?? member.displayName}</Dialog.Title>
        <Dialog.Description size="1" className="vtt-muted">
          {[c?.race, classes].filter(Boolean).join(' · ')}
          {c ? ` · played by ${member.displayName}` : ''}
        </Dialog.Description>
        <div className="vtt-vitals">
          {vitalTiles(sheet).map((t) => {
            return (
              <div key={t.key} className="vtt-vital" data-vital={t.key}>
                <VitalIcon vital={t.key} size={14} />
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
        {(sheet.senses ?? []).length > 0 && (
          <ul className="vtt-senses" aria-label="Senses">
            {(sheet.senses ?? []).map((s) => {
              return (
                <li key={s.kind}>
                  <SenseIcon kind={s.kind} size={14} /> {senseLabel(s)}
                </li>
              );
            })}
          </ul>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
