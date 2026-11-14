import type { RecordingEvent, SummaryCue } from '../types/index.js';

/** How many cue lines one summary's transcript gets at most; the rest are counted, not listed. */
export const MAX_CUES = 40;
/** A scene that is stopped and then started again within this is one change, not an ending and a start. */
const SCENE_SWAP_MS = 2000;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((n): n is string => n !== undefined) : [];
const quote = (name: string) => `"${name}"`;

function groupText(groups: unknown): string {
  const parts: string[] = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    if (typeof g !== 'object' || g === null) continue;
    const { name, members } = g as Record<string, unknown>;
    const label = str(name);
    if (!label) continue;
    const who = strings(members);
    parts.push(`${quote(label)}${who.length > 0 ? ` (${who.join(', ')})` : ''}`);
  }
  return parts.length > 0
    ? `The table split into groups: ${parts.join('; ')}; anyone not listed stayed at the main table`
    : 'The groups were merged: everyone is back at the main table';
}

/**
 * The recording's non-speech moments as cues, on the recording's clock: scene changes (with the sounds
 * they started), sound effects and loops, the DM's character voice, party splits and merges.
 *
 * These are cues for the summary to colour what people said, not events: the model is told so (prompts.ts).
 * Anything not well-formed is dropped rather than guessed at. Pure.
 */
export function eventCues(events: readonly RecordingEvent[], startedAt: number): SummaryCue[] {
  const cues: SummaryCue[] = [];
  const sceneStarts = events.filter((e) => e.event === 'scene' && e.detail?.action === 'start');
  for (const e of events) {
    const d = e.detail;
    if (!d) continue;
    const atMs = Math.max(0, e.at - startedAt);
    if (e.event === 'scene') {
      if (d.action === 'start') {
        const name = str(d.name);
        if (!name) continue;
        const sounds = strings(d.ambience);
        const text = `Scene started: ${quote(name)}${sounds.length > 0 ? ` (sounds: ${sounds.join(', ')})` : ''}`;
        cues.push({ atMs, kind: 'scene', text });
      } else if (d.action === 'stop') {
        // A scene change is "stopped, then started": only a stop with no start right after it is an ending.
        const swapped = sceneStarts.some((o) => o.at >= e.at && o.at - e.at <= SCENE_SWAP_MS);
        if (!swapped) cues.push({ atMs, kind: 'scene', text: 'The scene ended' });
      }
    } else if (e.event === 'sound') {
      const name = str(d.name);
      if (d.action === 'play' && name) {
        const category = str(d.category);
        const label = `${quote(name)}${category ? ` (${category})` : ''}`;
        const text = d.mode === 'loop' ? `Loop started: ${label}` : `Sound effect: ${label}`;
        cues.push({ atMs, kind: 'effect', text });
      } else if (d.action === 'stop') {
        cues.push({
          atMs,
          kind: 'effect',
          text: name ? `Loop stopped: ${quote(name)}` : 'All sounds stopped',
        });
      }
    } else if (e.event === 'voice') {
      const voice = str(d.voice);
      if (!voice) continue;
      const by = str(d.by) ?? 'The Game Master';
      const text =
        voice === 'normal'
          ? `${by} went back to their normal voice`
          : `${by} switched to the character voice ${quote(voice)}`;
      cues.push({ atMs, kind: 'voice', text });
    } else if (e.event === 'aside') {
      const player = str(d.player) ?? 'a player';
      cues.push({
        atMs,
        kind: 'aside',
        text:
          d.phase === 'end'
            ? 'The private talk ended; the table is together again'
            : `The Game Master took ${player} aside for a private talk (not recorded)`,
      });
    } else if (e.event === 'group') {
      cues.push({ atMs, kind: 'group', text: groupText(d.groups) });
    }
  }
  return cues.sort((a, b) => a.atMs - b.atMs);
}

const PRIORITY: Record<SummaryCue['kind'], number> = { scene: 0, group: 1, aside: 1, voice: 2, effect: 3 };

/**
 * Keeps a summary's cue list short: repeated effects become one line with a count, and when there are still
 * more than `max` lines the least story-relevant (effects, then voices, groups, scenes) go first, with a
 * closing note of how many were left out. The prompt must stay bounded however busy the soundboard was.
 */
export function compactCues(cues: readonly SummaryCue[], max = MAX_CUES): SummaryCue[] {
  const counts = new Map<string, number>();
  for (const c of cues) if (c.kind === 'effect') counts.set(c.text, (counts.get(c.text) ?? 0) + 1);
  const seen = new Set<string>();
  const merged: SummaryCue[] = [];
  for (const c of cues) {
    if (c.kind !== 'effect') {
      merged.push(c);
      continue;
    }
    if (seen.has(c.text)) continue;
    seen.add(c.text);
    const n = counts.get(c.text) ?? 1;
    merged.push(n > 1 ? { ...c, text: `${c.text} (${n} times)` } : c);
  }
  if (merged.length <= max) return merged;
  const keep = new Set(
    merged
      .map((c, i) => ({ c, i }))
      .sort((a, b) => PRIORITY[a.c.kind] - PRIORITY[b.c.kind] || a.i - b.i)
      .slice(0, max - 1)
      .map((x) => x.c),
  );
  const kept = merged.filter((c) => keep.has(c));
  const last = kept[kept.length - 1] as SummaryCue;
  kept.push({
    atMs: last.atMs,
    kind: 'effect',
    text: `${merged.length - kept.length} more minor cues left out`,
  });
  return kept;
}
