import { describe, expect, it } from 'vitest';

import { transcriptRows } from './transcriptRows.js';

const line = (startMs: number, text: string) => ({
  speaker: { id: 'a', name: 'Aria' },
  startMs,
  endMs: startMs + 500,
  text,
});

describe('transcriptRows', () => {
  it('puts a scene divider among the lines by time, before the lines at its moment', () => {
    const rows = transcriptRows(
      [line(0, 'one'), line(5000, 'two'), line(9000, 'three')],
      [{ atMs: 5000, kind: 'scene', text: 'Drowned Crypt' }],
    );
    expect(rows.map((r) => (r.kind === 'scene' ? `Scene: ${r.name}` : r.line.text))).toEqual([
      'one',
      'Scene: Drowned Crypt',
      'two',
      'three',
    ]);
  });

  it('is just the lines when there are no markers', () => {
    expect(transcriptRows([line(0, 'one')])).toEqual([{ kind: 'line', line: line(0, 'one') }]);
  });
});
