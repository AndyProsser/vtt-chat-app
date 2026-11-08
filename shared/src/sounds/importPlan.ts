// Turning a folder of sound files into a soundboard library: sounds with several takes, and boards of
// buttons. Pure (no files, no network) so the grouping rules are tested; scripts/sounds/import.ts does the I/O.

const AUDIO = /\.(ogg|wav|mp3|flac)$/i;

/** `impact_wood_medium_004.ogg` → `Impact wood medium` (separators to spaces, take number dropped). */
export function soundNameOf(file: string): string {
  const base = file
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '');
  const words = base
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface PlannedSound {
  name: string;
  /** The takes, in file-name order. */
  files: string[];
}

/** Groups audio files by sound name; numbered variants of one sound become its takes. */
export function planSounds(files: readonly string[]): PlannedSound[] {
  const groups = new Map<string, PlannedSound>();
  for (const file of [...files].filter((f) => AUDIO.test(f)).sort()) {
    const name = soundNameOf(file);
    const key = name.toLowerCase();
    const group = groups.get(key) ?? { name, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlannedBoard {
  name: string;
  buttons: { label: string; soundName: string }[];
}

const MAX_BUTTONS = 60;

/** One board per first word of the name; single sounds share "Misc"; a crowded board is split in parts of 60. */
export function planBoards(sounds: readonly { name: string }[]): PlannedBoard[] {
  const byWord = new Map<string, string[]>();
  for (const { name } of sounds) {
    const word = name.split(' ')[0]!;
    byWord.set(word, [...(byWord.get(word) ?? []), name]);
  }
  const boards: PlannedBoard[] = [];
  const misc: string[] = [];
  for (const [word, names] of [...byWord].sort(([a], [b]) => a.localeCompare(b))) {
    if (names.length < 2) misc.push(...names);
    else addBoard(boards, word, names, true);
  }
  if (misc.length > 0) addBoard(boards, 'Misc', misc.sort(), false);
  return boards;
}

function addBoard(boards: PlannedBoard[], title: string, names: string[], trimWord: boolean): void {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < sorted.length; i += MAX_BUTTONS) {
    const part = i / MAX_BUTTONS + 1;
    boards.push({
      name: part === 1 ? title : `${title} ${part}`,
      buttons: sorted.slice(i, i + MAX_BUTTONS).map((soundName) => {
        const rest = soundName.split(' ').slice(1).join(' ');
        return { label: trimWord && rest ? rest : soundName, soundName };
      }),
    });
  }
}
