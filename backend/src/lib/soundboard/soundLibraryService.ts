import { createHash, randomUUID } from 'node:crypto';

import {
  MAX_BOARD_BUTTONS,
  MAX_LIBRARY_BYTES,
  MAX_SCENE_LAYERS,
  MAX_SOUND_BYTES,
} from '../../consts/index.js';
import type { User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import { detectMedia, type MediaStorage } from '../media/mediaStorage.js';
import type { Store } from '../store/store.js';
import type { MediaFile, TableStore } from '../table/tableStore.js';
import type {
  Board,
  BoardButton,
  ButtonMode,
  LayerMode,
  Scene,
  SceneLayer,
  Sound,
  SoundCategory,
  SoundStore,
  Take,
} from './soundStore.js';

export interface SoundLibraryDeps {
  store: Store;
  sounds: SoundStore;
  table: TableStore;
  media: MediaStorage | undefined;
  now?: () => number;
  newId?: () => string;
}

const CATEGORIES: SoundCategory[] = ['effect', 'ambience', 'music'];
const clamp01 = (v: unknown, fallback = 1): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

function cleanName(value: string, what: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 120)
    throw new DomainError('invalid_input', `${what} name must be 1–120 characters`);
  return name;
}

function cleanTags(tags: string[] | undefined): string[] {
  const out = [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (out.length > 20 || out.some((t) => t.length > 40))
    throw new DomainError('invalid_input', 'up to 20 tags of up to 40 characters');
  return out;
}

/**
 * The DM's own sound library — a mini version of thaumaturgy.app (decided 2026-11-07). Everything
 * here is owner-only: your sounds, boards and scenes are yours, and usable in any campaign you are
 * DM of. Clips are type-checked by their bytes and size-limited like any upload.
 */
export class SoundLibraryService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: SoundLibraryDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  async library(owner: User): Promise<{ sounds: Sound[]; boards: Board[]; scenes: Scene[] }> {
    const { sounds } = this.deps;
    const [s, b, c] = await Promise.all([
      sounds.listSounds(owner.id),
      sounds.listBoards(owner.id),
      sounds.listScenes(owner.id),
    ]);
    return { sounds: s, boards: b, scenes: c };
  }

  // ---- sounds and takes ----

  private async storeClip(owner: User, bytes: Buffer, originalName: string): Promise<MediaFile> {
    const { media, table } = this.deps;
    if (!media)
      throw new DomainError(
        'conflict',
        'file storage is not configured on this server (MEDIA_DIR)',
      );
    if (bytes.length === 0) throw new DomainError('invalid_input', 'the file is empty');
    if (bytes.length > MAX_SOUND_BYTES)
      throw new DomainError('too_large', 'that clip is too large');
    const detected = detectMedia(bytes);
    if (!detected || detected.kind !== 'audio') {
      throw new DomainError(
        'unsupported_media',
        'that is not a supported audio file (OGG, WAV, MP3 or FLAC)',
      );
    }
    if ((await table.ownerAudioBytes(owner.id)) + bytes.length > MAX_LIBRARY_BYTES) {
      throw new DomainError('too_large', 'your sound library has used up its storage');
    }
    const file: MediaFile = {
      id: this.newId(),
      ownerId: owner.id,
      kind: 'audio',
      mime: detected.mime,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      originalName: originalName.slice(0, 200),
      createdAt: this.now(),
    };
    await media.put(file.id, bytes);
    await table.putMedia(file).catch(async (error: unknown) => {
      await media.delete(file.id).catch(() => undefined);
      throw error;
    });
    return file;
  }

  async addSound(
    owner: User,
    input: {
      name: string;
      category: SoundCategory;
      tags?: string[];
      bytes: Buffer;
      originalName: string;
    },
  ): Promise<Sound> {
    const name = cleanName(input.name, 'sound');
    if (!CATEGORIES.includes(input.category))
      throw new DomainError('invalid_input', 'category must be effect, ambience or music');
    const tags = cleanTags(input.tags);
    const file = await this.storeClip(owner, input.bytes, input.originalName);
    const id = this.newId();
    const sound: Sound = {
      id,
      ownerId: owner.id,
      name,
      category: input.category,
      tags,
      createdAt: this.now(),
      takes: [{ id: this.newId(), soundId: id, mediaId: file.id, level: 1, position: 0 }],
    };
    try {
      await this.deps.sounds.putSound(sound);
    } catch (error) {
      await this.dropMedia(file.id);
      throw error;
    }
    return sound;
  }

  async addTake(
    owner: User,
    soundId: string,
    input: { bytes: Buffer; originalName: string; level?: number },
  ): Promise<Sound> {
    const sound = await this.ownSound(owner, soundId);
    const file = await this.storeClip(owner, input.bytes, input.originalName);
    const take: Take = {
      id: this.newId(),
      soundId,
      mediaId: file.id,
      level: clamp01(input.level),
      position: sound.takes.length,
    };
    const next = { ...sound, takes: [...sound.takes, take] };
    try {
      await this.deps.sounds.putSound(next);
    } catch (error) {
      await this.dropMedia(file.id);
      throw error;
    }
    return next;
  }

  async updateSound(
    owner: User,
    soundId: string,
    patch: {
      name?: string;
      category?: SoundCategory;
      tags?: string[];
      levels?: Record<string, number>;
    },
  ): Promise<Sound> {
    const sound = await this.ownSound(owner, soundId);
    if (patch.category !== undefined && !CATEGORIES.includes(patch.category))
      throw new DomainError('invalid_input', 'bad category');
    const next: Sound = {
      ...sound,
      ...(patch.name !== undefined ? { name: cleanName(patch.name, 'sound') } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.tags !== undefined ? { tags: cleanTags(patch.tags) } : {}),
      takes: sound.takes.map((t) =>
        patch.levels && t.id in patch.levels ? { ...t, level: clamp01(patch.levels[t.id]) } : t,
      ),
    };
    await this.deps.sounds.putSound(next);
    return next;
  }

  async removeTake(owner: User, soundId: string, takeId: string): Promise<Sound> {
    const sound = await this.ownSound(owner, soundId);
    const take = sound.takes.find((t) => t.id === takeId);
    if (!take) throw new DomainError('not_found');
    if (sound.takes.length === 1)
      throw new DomainError(
        'conflict',
        'a sound needs at least one take; delete the sound instead',
      );
    const next = {
      ...sound,
      takes: sound.takes.filter((t) => t.id !== takeId).map((t, i) => ({ ...t, position: i })),
    };
    await this.deps.sounds.putSound(next);
    await this.dropMedia(take.mediaId);
    return next;
  }

  /** Deletes the sound, its clips, and any board button or scene layer that used it. */
  async deleteSound(owner: User, soundId: string): Promise<void> {
    const sound = await this.ownSound(owner, soundId);
    await this.deps.sounds.deleteSound(sound.id);
    for (const take of sound.takes) await this.dropMedia(take.mediaId);
    for (const board of await this.deps.sounds.listBoards(owner.id)) {
      const buttons = board.buttons.filter((b) => b.soundId !== soundId);
      if (buttons.length !== board.buttons.length)
        await this.deps.sounds.putBoard({ ...board, buttons });
    }
    for (const scene of await this.deps.sounds.listScenes(owner.id)) {
      const layers = scene.layers.filter((l) => l.soundId !== soundId);
      if (layers.length !== scene.layers.length)
        await this.deps.sounds.putScene({ ...scene, layers });
    }
  }

  // ---- boards ----

  async saveBoard(
    owner: User,
    boardId: string | undefined,
    input: { name: string; buttons: Partial<BoardButton>[] },
  ): Promise<Board> {
    const existing = boardId ? await this.ownBoard(owner, boardId) : undefined;
    if (input.buttons.length > MAX_BOARD_BUTTONS)
      throw new DomainError('invalid_input', `a board holds at most ${MAX_BOARD_BUTTONS} buttons`);
    const buttons: BoardButton[] = [];
    for (const b of input.buttons) {
      await this.requireSound(owner, b.soundId);
      const mode: ButtonMode = b.mode === 'loop' ? 'loop' : 'oneshot';
      buttons.push({
        id: b.id ?? this.newId(),
        label: cleanName(b.label ?? '', 'button'),
        soundId: b.soundId as string,
        mode,
        volume: clamp01(b.volume),
        note: (b.note ?? '').slice(0, 500),
      });
    }
    const board: Board = {
      id: existing?.id ?? this.newId(),
      ownerId: owner.id,
      name: cleanName(input.name, 'board'),
      buttons,
      createdAt: existing?.createdAt ?? this.now(),
    };
    await this.deps.sounds.putBoard(board);
    return board;
  }

  async deleteBoard(owner: User, boardId: string): Promise<void> {
    await this.deps.sounds.deleteBoard((await this.ownBoard(owner, boardId)).id);
  }

  // ---- scenes ----

  async saveScene(
    owner: User,
    sceneId: string | undefined,
    input: { name: string; layers: Partial<SceneLayer>[] },
  ): Promise<Scene> {
    const existing = sceneId ? await this.ownScene(owner, sceneId) : undefined;
    if (input.layers.length > MAX_SCENE_LAYERS)
      throw new DomainError('invalid_input', `a scene holds at most ${MAX_SCENE_LAYERS} layers`);
    const layers: SceneLayer[] = [];
    for (const l of input.layers) {
      await this.requireSound(owner, l.soundId);
      const mode: LayerMode = l.mode === 'random' ? 'random' : 'loop';
      let min: number | null = null;
      let max: number | null = null;
      if (mode === 'random') {
        min = l.minIntervalSec ?? 10;
        max = l.maxIntervalSec ?? Math.max(min, 30);
        if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min || max > 3600) {
          throw new DomainError('invalid_input', 'random layers need 1 ≤ min ≤ max ≤ 3600 seconds');
        }
      }
      layers.push({
        id: l.id ?? this.newId(),
        soundId: l.soundId as string,
        mode,
        volume: clamp01(l.volume),
        minIntervalSec: min,
        maxIntervalSec: max,
      });
    }
    const scene: Scene = {
      id: existing?.id ?? this.newId(),
      ownerId: owner.id,
      name: cleanName(input.name, 'scene'),
      layers,
      createdAt: existing?.createdAt ?? this.now(),
    };
    await this.deps.sounds.putScene(scene);
    return scene;
  }

  async deleteScene(owner: User, sceneId: string): Promise<void> {
    await this.deps.sounds.deleteScene((await this.ownScene(owner, sceneId)).id);
  }

  // ---- playback access ----

  /**
   * A clip's bytes, for a player in a campaign. Allowed only if you are a member of that campaign and
   * the sound belongs to someone who is its DM — so a take id from another table's library gets nothing.
   */
  async readTake(
    user: User,
    campaignId: string,
    takeId: string,
  ): Promise<{ media: MediaFile; bytes: Buffer }> {
    const { store, sounds, table, media } = this.deps;
    if (!(await store.getMembership(campaignId, user.id)))
      throw new DomainError('forbidden', 'not a member of this campaign');
    const found = await sounds.getTake(takeId);
    const ownerMembership = found
      ? await store.getMembership(campaignId, found.sound.ownerId)
      : undefined;
    if (!found || ownerMembership?.role !== 'dm' || !media) throw new DomainError('not_found');
    const [file, bytes] = await Promise.all([
      table.getMedia(found.take.mediaId),
      media.get(found.take.mediaId),
    ]);
    if (!file || !bytes) throw new DomainError('not_found');
    return { media: file, bytes };
  }

  // ---- helpers ----

  private async dropMedia(mediaId: string): Promise<void> {
    await this.deps.table.deleteMedia(mediaId).catch(() => undefined);
    await this.deps.media?.delete(mediaId).catch(() => undefined);
  }
  private async ownSound(owner: User, id: string): Promise<Sound> {
    const s = await this.deps.sounds.getSound(id);
    if (!s || s.ownerId !== owner.id) throw new DomainError('not_found');
    return s;
  }
  private async requireSound(owner: User, id: string | undefined): Promise<void> {
    if (!id) throw new DomainError('invalid_input', 'every button and layer needs a sound');
    const s = await this.deps.sounds.getSound(id);
    if (!s || s.ownerId !== owner.id)
      throw new DomainError('invalid_input', 'that sound is not in your library');
  }
  private async ownBoard(owner: User, id: string): Promise<Board> {
    const b = await this.deps.sounds.getBoard(id);
    if (!b || b.ownerId !== owner.id) throw new DomainError('not_found');
    return b;
  }
  private async ownScene(owner: User, id: string): Promise<Scene> {
    const s = await this.deps.sounds.getScene(id);
    if (!s || s.ownerId !== owner.id) throw new DomainError('not_found');
    return s;
  }
}
