import { createHash, randomUUID } from 'node:crypto';

import {
  MAX_CAMPAIGN_HANDOUT_BYTES,
  MAX_HANDOUT_BYTES,
  MAX_HANDOUT_IMAGES,
  MAX_TEXT_HANDOUT_CHARS,
} from '../../consts/index.js';
import { DomainError } from '../errors.js';
import { detectMedia, type MediaStorage } from '../media/mediaStorage.js';
import type { Store } from '../store/store.js';
import type { User } from '../../types/index.js';
import type { Handout, HandoutKind, MediaFile, TableStore, Viewer } from './tableStore.js';

export interface HandoutDeps {
  store: Store;
  table: TableStore;
  media: MediaStorage | undefined;
  now?: () => number;
  newId?: () => string;
}

/** Who a handout was just shown to, for the live notification. */
export interface Audience {
  everyone: boolean;
  userIds: string[];
}

/**
 * Handouts, maps, images and text snippets. The DM prepares them as drafts (visible to the DM only)
 * and shows them to everyone or to chosen players; players read only what has been shown to them.
 * Files are checked by their actual bytes, size-limited, and counted against a per-campaign quota.
 */
export class HandoutService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: HandoutDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  private async viewer(user: User, campaignId: string): Promise<Viewer> {
    const m = await this.deps.store.getMembership(campaignId, user.id);
    if (!m) throw new DomainError('forbidden', 'not a member of this campaign');
    return { userId: user.id, isDm: m.role === 'dm' };
  }

  private async requireDm(user: User, campaignId: string): Promise<void> {
    if (!(await this.viewer(user, campaignId)).isDm) {
      throw new DomainError('forbidden', 'only the DM can do that');
    }
  }

  async createText(
    user: User,
    campaignId: string,
    input: { title: string; body: string },
  ): Promise<Handout> {
    await this.requireDm(user, campaignId);
    const title = input.title.trim();
    if (title.length < 1 || title.length > 200)
      throw new DomainError('invalid_input', 'title must be 1–200 characters');
    if (input.body.length < 1 || input.body.length > MAX_TEXT_HANDOUT_CHARS) {
      throw new DomainError('invalid_input', `text must be 1–${MAX_TEXT_HANDOUT_CHARS} characters`);
    }
    const handout: Handout = {
      id: this.newId(),
      campaignId,
      title,
      kind: 'text',
      body: input.body,
      mediaIds: [],
      visibility: 'dm',
      recipients: [],
      createdBy: user.id,
      createdAt: this.now(),
    };
    await this.deps.table.putHandout(handout);
    return handout;
  }

  async createFile(
    user: User,
    campaignId: string,
    input: {
      title: string;
      kind: Exclude<HandoutKind, 'text'>;
      bytes: Buffer;
      originalName: string;
    },
  ): Promise<Handout> {
    await this.requireDm(user, campaignId);
    const title = input.title.trim();
    if (title.length < 1 || title.length > 200)
      throw new DomainError('invalid_input', 'title must be 1–200 characters');
    const media = await this.storeFile(
      user,
      campaignId,
      input,
      input.kind === 'pdf' ? 'pdf' : 'image',
    );
    try {
      const handout: Handout = {
        id: this.newId(),
        campaignId,
        title,
        // Pictures and maps are the same thing now: a set of pictures.
        kind: input.kind === 'pdf' ? 'pdf' : 'image',
        body: null,
        mediaIds: [media.id],
        visibility: 'dm',
        recipients: [],
        createdBy: user.id,
        createdAt: this.now(),
      };
      await this.deps.table.putHandout(handout);
      return handout;
    } catch (error) {
      await this.discard(media.id);
      throw error;
    }
  }

  /** Adds a picture to the end of a picture handout (never to a note or a PDF). */
  async addImage(
    user: User,
    campaignId: string,
    handoutId: string,
    input: { bytes: Buffer; originalName: string },
  ): Promise<Handout> {
    await this.requireDm(user, campaignId);
    const current = await this.own(campaignId, handoutId);
    if (current.kind !== 'image' && current.kind !== 'map')
      throw new DomainError('invalid_input', 'only a picture handout can take more pictures');
    if (current.mediaIds.length >= MAX_HANDOUT_IMAGES)
      throw new DomainError(
        'invalid_input',
        `a handout holds at most ${MAX_HANDOUT_IMAGES} pictures`,
      );
    const media = await this.storeFile(user, campaignId, input, 'image');
    try {
      const next: Handout = { ...current, mediaIds: [...current.mediaIds, media.id] };
      await this.deps.table.putHandout(next);
      return next;
    } catch (error) {
      await this.discard(media.id);
      throw error;
    }
  }

  /** Takes one picture out of a set (never the last: delete the handout instead). The rest close up. */
  async removeImage(
    user: User,
    campaignId: string,
    handoutId: string,
    index: number,
  ): Promise<Handout> {
    await this.requireDm(user, campaignId);
    const current = await this.own(campaignId, handoutId);
    this.requirePictureSet(current);
    const mediaId = current.mediaIds[index];
    if (mediaId === undefined) throw new DomainError('not_found');
    if (current.mediaIds.length <= 1)
      throw new DomainError(
        'invalid_input',
        'a handout needs at least one picture; delete it instead',
      );
    const next: Handout = { ...current, mediaIds: current.mediaIds.filter((_, i) => i !== index) };
    await this.deps.table.putHandout(next);
    await this.deps.table.deleteMedia(mediaId);
    await this.deps.media?.delete(mediaId);
    return next;
  }

  /** Puts a set's pictures in a new order: `order[i]` is the old position of the picture that is now `i`. */
  async reorderImages(
    user: User,
    campaignId: string,
    handoutId: string,
    order: number[],
  ): Promise<Handout> {
    await this.requireDm(user, campaignId);
    const current = await this.own(campaignId, handoutId);
    this.requirePictureSet(current);
    const n = current.mediaIds.length;
    const shuffle =
      order.length === n &&
      new Set(order).size === n &&
      order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
    if (!shuffle) throw new DomainError('invalid_input', 'the order must list each picture once');
    const next: Handout = { ...current, mediaIds: order.map((i) => current.mediaIds[i]!) };
    await this.deps.table.putHandout(next);
    return next;
  }

  private requirePictureSet(handout: Handout): void {
    if (handout.kind !== 'image' && handout.kind !== 'map')
      throw new DomainError('invalid_input', 'only a picture handout has pictures to change');
  }

  /** Checks and stores one uploaded file, returning its record. */
  private async storeFile(
    user: User,
    campaignId: string,
    input: { bytes: Buffer; originalName: string },
    wanted: 'image' | 'pdf',
  ): Promise<MediaFile> {
    if (!this.deps.media)
      throw new DomainError(
        'conflict',
        'file storage is not configured on this server (MEDIA_DIR)',
      );
    if (input.bytes.length === 0) throw new DomainError('invalid_input', 'the file is empty');
    if (input.bytes.length > MAX_HANDOUT_BYTES)
      throw new DomainError('too_large', 'that file is too large');
    const detected = detectMedia(input.bytes);
    if (!detected || detected.kind !== wanted) {
      throw new DomainError(
        'unsupported_media',
        `that is not a supported ${wanted === 'pdf' ? 'PDF' : 'image (PNG, JPEG, GIF or WebP)'}`,
      );
    }
    const used = await this.deps.table.campaignHandoutBytes(campaignId);
    if (used + input.bytes.length > MAX_CAMPAIGN_HANDOUT_BYTES) {
      throw new DomainError('too_large', 'this campaign has used up its file storage');
    }
    const media: MediaFile = {
      id: this.newId(),
      ownerId: user.id,
      kind: detected.kind,
      mime: detected.mime,
      bytes: input.bytes.length,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      originalName: input.originalName.slice(0, 200),
      createdAt: this.now(),
    };
    await this.deps.media.put(media.id, input.bytes);
    try {
      await this.deps.table.putMedia(media);
    } catch (error) {
      await this.discard(media.id);
      throw error;
    }
    return media;
  }

  /** Don't leave an orphaned file behind if a database write failed. */
  private async discard(mediaId: string): Promise<void> {
    await this.deps.media?.delete(mediaId).catch(() => undefined);
    await this.deps.table.deleteMedia(mediaId).catch(() => undefined);
  }

  /** Shows a handout to everyone, or to the listed members only. Returns who it was shown to. */
  async show(
    user: User,
    campaignId: string,
    handoutId: string,
    to: 'all' | string[],
  ): Promise<{ handout: Handout; audience: Audience }> {
    await this.requireDm(user, campaignId);
    const handout = await this.own(campaignId, handoutId);
    let next: Handout;
    if (to === 'all') {
      next = { ...handout, visibility: 'all', recipients: [] };
    } else {
      const ids = [...new Set(to)];
      if (ids.length === 0) throw new DomainError('invalid_input', 'choose at least one player');
      for (const id of ids) {
        if (!(await this.deps.store.getMembership(campaignId, id))) {
          throw new DomainError(
            'invalid_input',
            'every recipient must be a member of this campaign',
          );
        }
      }
      next = { ...handout, visibility: 'some', recipients: ids };
    }
    await this.deps.table.putHandout(next);
    return { handout: next, audience: { everyone: to === 'all', userIds: next.recipients } };
  }

  /** Takes a handout back to a DM-only draft. */
  async hide(user: User, campaignId: string, handoutId: string): Promise<Handout> {
    await this.requireDm(user, campaignId);
    const next: Handout = {
      ...(await this.own(campaignId, handoutId)),
      visibility: 'dm',
      recipients: [],
    };
    await this.deps.table.putHandout(next);
    return next;
  }

  /** Renames a handout and/or rewrites its text (text handouts only). The DM only. */
  async update(
    user: User,
    campaignId: string,
    handoutId: string,
    changes: { title?: string; text?: string },
  ): Promise<Handout> {
    await this.requireDm(user, campaignId);
    const current = await this.own(campaignId, handoutId);
    const next: Handout = { ...current };
    if (changes.title !== undefined) {
      const title = changes.title.trim();
      if (title.length < 1 || title.length > 200)
        throw new DomainError('invalid_input', 'title must be 1–200 characters');
      next.title = title;
    }
    if (changes.text !== undefined) {
      // A note's text is required; a picture or PDF may carry a caption, or none.
      const optional = current.kind !== 'text';
      if (changes.text.length > MAX_TEXT_HANDOUT_CHARS || (!optional && changes.text.length < 1)) {
        throw new DomainError(
          'invalid_input',
          `text must be ${optional ? 0 : 1}–${MAX_TEXT_HANDOUT_CHARS} characters`,
        );
      }
      next.body = optional && changes.text.trim() === '' ? null : changes.text;
    }
    await this.deps.table.putHandout(next);
    return next;
  }

  list(user: User, campaignId: string): Promise<Handout[]> {
    return this.viewer(user, campaignId).then((v) => this.deps.table.listHandouts(campaignId, v));
  }

  /** One handout, only if this person may see it; otherwise exactly as if it did not exist. */
  async get(user: User, campaignId: string, handoutId: string): Promise<Handout> {
    const viewer = await this.viewer(user, campaignId);
    const visible = (await this.deps.table.listHandouts(campaignId, viewer)).find(
      (h) => h.id === handoutId,
    );
    if (!visible) throw new DomainError('not_found');
    return visible;
  }

  async readFile(
    user: User,
    campaignId: string,
    handoutId: string,
    index = 0,
  ): Promise<{ media: MediaFile; bytes: Buffer }> {
    const handout = await this.get(user, campaignId, handoutId);
    const mediaId = handout.mediaIds[index];
    if (!mediaId || !this.deps.media) throw new DomainError('not_found');
    const [media, bytes] = await Promise.all([
      this.deps.table.getMedia(mediaId),
      this.deps.media.get(mediaId),
    ]);
    if (!media || !bytes) throw new DomainError('not_found');
    return { media, bytes };
  }

  async delete(user: User, campaignId: string, handoutId: string): Promise<void> {
    await this.requireDm(user, campaignId);
    const handout = await this.own(campaignId, handoutId);
    await this.deps.table.deleteHandout(handout.id);
    for (const mediaId of handout.mediaIds) {
      await this.deps.table.deleteMedia(mediaId);
      await this.deps.media?.delete(mediaId);
    }
  }

  private async own(campaignId: string, handoutId: string): Promise<Handout> {
    const handout = await this.deps.table.getHandout(handoutId);
    if (!handout || handout.campaignId !== campaignId) throw new DomainError('not_found');
    return handout;
  }
}
