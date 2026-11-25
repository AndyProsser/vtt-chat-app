/**
 * One line of a campaign's Markdown description as plain text, for the campaign chooser: the first line with words
 * in it, without heading, list or quote marks, emphasis or link addresses, cut on a word with an ellipsis.
 */
export function campaignBlurb(description: string, max = 90): string {
  const line =
    description
      .split(/\r?\n/)
      .map((l) =>
        l
          .replace(/^\s{0,3}(#{1,6}|[-*+>]|\d+[.)])\s+/, '')
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/[*_`~]+/g, '')
          .trim(),
      )
      .find((l) => l.length > 0) ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const onWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trimEnd();
  return `${onWord}…`;
}
