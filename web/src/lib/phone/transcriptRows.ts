import type { SceneMarker, Utterance } from '../../types/phone.js';

/** One row of a transcript: a spoken or typed line, or a "Scene: <name>" divider between lines. */
export type TranscriptRow =
  { kind: 'line'; line: Utterance } | { kind: 'scene'; atMs: number; name: string };

/** The lines with the scene markers placed among them by time (a divider comes before the lines at its moment). */
export function transcriptRows(
  lines: readonly Utterance[],
  markers: readonly SceneMarker[] = [],
): TranscriptRow[] {
  const rows = [
    ...markers.map((m) => ({
      at: m.atMs,
      order: 0,
      row: { kind: 'scene', atMs: m.atMs, name: m.text } as TranscriptRow,
    })),
    ...lines.map((line) => ({
      at: line.startMs,
      order: 1,
      row: { kind: 'line', line } as TranscriptRow,
    })),
  ];
  return rows.sort((a, b) => a.at - b.at || a.order - b.order).map((r) => r.row);
}
