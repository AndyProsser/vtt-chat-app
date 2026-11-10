import type { DdbCharacter } from '../types/index.js';
import { parseSheet } from './parseSheet.js';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;

/**
 * Reads the few fields the app shows from the character service's reply: name, race, classes, level and
 * portrait address. Unknown or missing fields are ignored, because the service is not a documented API
 * and changes shape; a reply without a name is treated as not a character at all.
 */
export function parseCharacter(body: unknown): DdbCharacter | undefined {
  const data = isRecord(body) && isRecord(body.data) ? body.data : undefined;
  const name = data ? text(data.name, 120) : null;
  if (!data || !name) return undefined;

  const race = isRecord(data.race)
    ? (text(data.race.fullName, 80) ?? text(data.race.baseName, 80))
    : null;

  const classes = (Array.isArray(data.classes) ? data.classes : []).filter(isRecord).map((c) => ({
    name: isRecord(c.definition) ? text(c.definition.name, 40) : null,
    level: typeof c.level === 'number' && Number.isInteger(c.level) ? c.level : 0,
  }));
  const named = classes.filter((c): c is { name: string; level: number } => c.name !== null);
  const total = named.reduce((sum, c) => sum + c.level, 0);

  const portrait =
    (isRecord(data.decorations) ? text(data.decorations.avatarUrl, 2048) : null) ??
    text(data.avatarUrl, 2048);

  return {
    name,
    race,
    // "Fighter 3 / Wizard 2" when multiclassed; a single class is just its name.
    className:
      named.length === 0
        ? null
        : named.length === 1
          ? named[0]!.name
          : named.map((c) => `${c.name} ${c.level}`).join(' / '),
    level: total >= 1 && total <= 30 ? total : null,
    portraitUrl: portrait && /^https:\/\//i.test(portrait) ? portrait : null,
    sheet: parseSheet(data),
  };
}
