export interface MarkdownHeading {
  /** 1 to 6: the number of `#`. */
  level: number;
  text: string;
  /** Zero-based line the heading is on, so a viewer can scroll to it. */
  line: number;
  /** How many headings with the same text came before it: tells two "Notes" headings apart. */
  nth: number;
}

/**
 * Every heading in a Markdown text, for the sidebar of the GM notes in view mode. ATX headings only (`# Title`);
 * lines inside a fenced code block are not headings, and a trailing `#`s run is dropped.
 */
export function markdownHeadings(markdown: string): MarkdownHeading[] {
  const found: MarkdownHeading[] = [];
  const seen = new Map<string, number>();
  let fence: string | null = null;
  markdown.split(/\r?\n/).forEach((raw, line) => {
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(raw)?.[1];
    if (mark) {
      if (fence === null) fence = mark[0]!;
      else if (mark[0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    const m = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(raw);
    if (!m) return;
    const text = m[2]!.trim();
    if (text === '') return;
    const nth = seen.get(text) ?? 0;
    seen.set(text, nth + 1);
    found.push({ level: m[1]!.length, text, line, nth });
  });
  return found;
}
