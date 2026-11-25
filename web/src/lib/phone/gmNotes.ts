export interface NoteHeading {
  level: number;
  text: string;
}

/**
 * The headings of a notes page, in order, for the "jump to" list: `#` to `######` at the start of a line, outside
 * code fences, as they are drawn (closing hashes and emphasis marks dropped). Underlined headings are not listed.
 */
export function noteHeadings(markdown: string): NoteHeading[] {
  const out: NoteHeading[] = [];
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[2]!.replace(/[*_`~]+/g, '').trim();
    if (text) out.push({ level: m[1]!.length, text });
  }
  return out;
}
