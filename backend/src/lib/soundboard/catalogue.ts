import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DomainError } from '../errors.js';
import { detectMedia, type MediaStorage } from '../media/mediaStorage.js';
import type { TableStore } from '../table/tableStore.js';
import type {
  Board,
  BoardButton,
  Scene,
  SceneLayer,
  Sound,
  SoundCategory,
  SoundStore,
} from './soundStore.js';

/**
 * The server's shared starter catalogue (decided 2026-11-16, docs/tracker/specs/2026-11-16-starter-sounds-design.md):
 * sounds, boards of stingers and scenes that every DM sees from their first minute, written at start-up from the
 * pack that ships in `backend/assets/sounds/`. They have no owner (`ownerId` null), so a DM can use them but not
 * edit or delete them, and a server update can add to or change them.
 */
export interface CatalogueManifest {
  version: 1;
  sounds: {
    key: string;
    name: string;
    category: SoundCategory;
    tags?: string[];
    /** Clip paths, relative to the pack directory. Several takes make a button vary. */
    takes: string[];
    /** Loudness trim, 0–1. */
    level?: number;
  }[];
  boards: {
    key: string;
    name: string;
    buttons: {
      label: string;
      sound: string;
      mode?: 'oneshot' | 'loop';
      volume?: number;
      note?: string;
    }[];
  }[];
  scenes: {
    key: string;
    name: string;
    layers: {
      sound: string;
      mode: 'loop' | 'random';
      volume?: number;
      minIntervalSec?: number;
      maxIntervalSec?: number;
    }[];
  }[];
}

export interface SeedDeps {
  /** The pack directory (holds `catalogue.json` and the clips). */
  dir: string;
  sounds: SoundStore;
  table: TableStore;
  media: MediaStorage;
  now?: () => number;
}

export const DEFAULT_CATALOGUE_DIR = new URL('../../../assets/sounds/', import.meta.url);

/** A stable UUID for a name, so the same pack always produces the same ids (and a re-seed changes nothing). */
export function stableId(kind: string, key: string): string {
  const h = createHash('sha1').update(`vtt-catalogue:${kind}:${key}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const clamp01 = (v: number | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/**
 * Makes the shared rows match the pack: adds and updates what it lists, removes what it no longer lists, and
 * leaves every DM's own library alone. Everything is checked (clips exist and are audio, names resolve) before
 * anything is written, so a bad pack changes nothing. Returns how many of each it holds.
 */
export async function seedCatalogue(
  deps: SeedDeps,
): Promise<{ sounds: number; boards: number; scenes: number }> {
  let manifest: CatalogueManifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(deps.dir, 'catalogue.json'), 'utf8'),
    ) as CatalogueManifest;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return { sounds: 0, boards: 0, scenes: 0 };
    throw error;
  }
  if (manifest.version !== 1) throw new DomainError('invalid_input', 'unknown catalogue version');
  const { sounds, table, media } = deps;

  // 1. Read and check every clip.
  const clips = new Map<string, { bytes: Buffer; sha: string; mime: string }>();
  for (const s of manifest.sounds) {
    if (s.takes.length === 0) throw new DomainError('invalid_input', `sound ${s.key} has no clips`);
    for (const file of s.takes) {
      if (clips.has(file)) continue;
      const bytes = await readFile(path.join(deps.dir, file)).catch(() => {
        throw new DomainError('invalid_input', `catalogue clip missing: ${file}`);
      });
      const detected = detectMedia(bytes);
      if (!detected || detected.kind !== 'audio')
        throw new DomainError('invalid_input', `catalogue clip is not audio: ${file}`);
      clips.set(file, {
        bytes,
        sha: createHash('sha256').update(bytes).digest('hex'),
        mime: detected.mime,
      });
    }
  }
  const soundIds = new Map(manifest.sounds.map((s) => [s.key, stableId('sound', s.key)]));
  const soundId = (key: string, where: string): string => {
    const id = soundIds.get(key);
    if (!id) throw new DomainError('invalid_input', `${where} names an unknown sound: ${key}`);
    return id;
  };
  const boards: Board[] = manifest.boards.map((b, i) => ({
    id: stableId('board', b.key),
    ownerId: null,
    name: b.name,
    createdAt: i + 1,
    buttons: b.buttons.map((btn, j): BoardButton => ({
      id: stableId('button', `${b.key}:${j}`),
      label: btn.label,
      soundId: soundId(btn.sound, `board ${b.key}`),
      mode: btn.mode ?? 'oneshot',
      volume: clamp01(btn.volume, 1),
      note: btn.note ?? '',
    })),
  }));
  const scenes: Scene[] = manifest.scenes.map((sc, i) => ({
    id: stableId('scene', sc.key),
    ownerId: null,
    name: sc.name,
    createdAt: i + 1,
    layers: sc.layers.map((l, j): SceneLayer => ({
      id: stableId('layer', `${sc.key}:${j}`),
      soundId: soundId(l.sound, `scene ${sc.key}`),
      mode: l.mode,
      volume: clamp01(l.volume, 1),
      minIntervalSec: l.mode === 'random' ? (l.minIntervalSec ?? 10) : null,
      maxIntervalSec: l.mode === 'random' ? (l.maxIntervalSec ?? 30) : null,
    })),
  }));

  // 2. Store clips (one media file per distinct clip content) and write the rows.
  const before = await sounds.listSounds(null);
  const usedMedia = new Set<string>();
  const mediaFor = async (file: string): Promise<string> => {
    const clip = clips.get(file) as { bytes: Buffer; sha: string; mime: string };
    const id = stableId('media', clip.sha);
    usedMedia.add(id);
    if (!(await table.getMedia(id)) || !(await media.get(id))) {
      await media.put(id, clip.bytes);
      await table.putMedia({
        id,
        ownerId: null,
        kind: 'audio',
        mime: clip.mime,
        bytes: clip.bytes.length,
        sha256: clip.sha,
        originalName: path.basename(file).slice(0, 200),
        createdAt: (deps.now ?? Date.now)(),
      });
    }
    return id;
  };
  for (const [i, s] of manifest.sounds.entries()) {
    const id = soundIds.get(s.key) as string;
    const takes = [];
    for (const [position, file] of s.takes.entries()) {
      takes.push({
        id: stableId('take', `${s.key}:${position}`),
        soundId: id,
        mediaId: await mediaFor(file),
        level: clamp01(s.level, 1),
        position,
      });
    }
    const sound: Sound = {
      id,
      ownerId: null,
      name: s.name,
      category: s.category,
      tags: s.tags ?? [],
      takes,
      createdAt: i + 1,
    };
    await sounds.putSound(sound);
  }
  for (const b of boards) await sounds.putBoard(b);
  for (const sc of scenes) await sounds.putScene(sc);

  // 3. Remove what the pack no longer lists, and the clips nothing uses.
  const keepSounds = new Set(soundIds.values());
  for (const old of before) {
    if (keepSounds.has(old.id)) continue;
    await sounds.deleteSound(old.id);
  }
  const keepBoards = new Set(boards.map((b) => b.id));
  for (const old of await sounds.listBoards(null))
    if (!keepBoards.has(old.id)) await sounds.deleteBoard(old.id);
  const keepScenes = new Set(scenes.map((s) => s.id));
  for (const old of await sounds.listScenes(null))
    if (!keepScenes.has(old.id)) await sounds.deleteScene(old.id);
  for (const old of before) {
    for (const take of old.takes) {
      if (usedMedia.has(take.mediaId)) continue;
      await table.deleteMedia(take.mediaId).catch(() => undefined);
      await media.delete(take.mediaId).catch(() => undefined);
    }
  }
  return { sounds: manifest.sounds.length, boards: boards.length, scenes: scenes.length };
}
