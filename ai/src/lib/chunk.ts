/**
 * Splits transcript lines into chunks of at most `maxChars` characters, repeating the last
 * `overlapLines` lines at the start of the next chunk so a scene that straddles a boundary is
 * seen whole by at least one call. A single line longer than the budget becomes its own chunk
 * (splitting mid-sentence would lose more than it saves).
 */
export function chunkLines(lines: readonly string[], maxChars: number, overlapLines = 0): string[] {
  if (maxChars <= 0) throw new Error('maxChars must be positive');

  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  let newLinesInCurrent = 0;

  const flush = (): void => {
    if (newLinesInCurrent === 0) return;
    chunks.push(current.join('\n'));
    const keep = overlapLines > 0 ? current.slice(-overlapLines) : [];
    current = keep;
    size = keep.reduce((total, line) => total + line.length + 1, 0);
    newLinesInCurrent = 0;
  };

  for (const line of lines) {
    const cost = line.length + 1;
    if (size + cost > maxChars && newLinesInCurrent > 0) flush();
    current.push(line);
    size += cost;
    newLinesInCurrent += 1;
  }
  flush();
  return chunks;
}
