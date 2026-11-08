export type FormatKind = 'bold' | 'italic' | 'heading' | 'list' | 'quote' | 'rule';

export interface Edit {
  text: string;
  /** The selection to restore after the edit. */
  start: number;
  end: number;
}

const WRAP: Record<'bold' | 'italic', string> = { bold: '**', italic: '*' };
const PREFIX: Record<'heading' | 'list' | 'quote', string> = {
  heading: '## ',
  list: '- ',
  quote: '> ',
};

/**
 * One toolbar action on a textarea: wrap the selection (bold, italic), prefix the lines it touches
 * (heading, list, quote — pressed again, they come off), or add a divider. Pure, so the editor is
 * only a thin layer over it.
 */
export function applyFormat(text: string, start: number, end: number, kind: FormatKind): Edit {
  if (kind === 'rule') {
    const insert = '\n\n---\n\n';
    const before = text.slice(0, end);
    const lead = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : insert.slice(0, 2);
    const added = `${lead}---\n\n`;
    return {
      text: before + added + text.slice(end),
      start: end + added.length,
      end: end + added.length,
    };
  }
  if (kind === 'bold' || kind === 'italic') {
    const mark = WRAP[kind];
    const selected = text.slice(start, end);
    if (selected === '') {
      const placeholder = 'text';
      return {
        text: `${text.slice(0, start)}${mark}${placeholder}${mark}${text.slice(end)}`,
        start: start + mark.length,
        end: start + mark.length + placeholder.length,
      };
    }
    const wrapped =
      text.slice(start - mark.length, start) === mark &&
      text.slice(end, end + mark.length) === mark;
    if (wrapped) {
      return {
        text: text.slice(0, start - mark.length) + selected + text.slice(end + mark.length),
        start: start - mark.length,
        end: end - mark.length,
      };
    }
    return {
      text: `${text.slice(0, start)}${mark}${selected}${mark}${text.slice(end)}`,
      start: start + mark.length,
      end: end + mark.length,
    };
  }
  const prefix = PREFIX[kind];
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const allPrefixed = lines.every((l) => l.startsWith(prefix));
  const changed = lines.map((l) =>
    allPrefixed ? l.slice(prefix.length) : l.startsWith(prefix) ? l : prefix + l,
  );
  const block = changed.join('\n');
  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + block.length,
  };
}
