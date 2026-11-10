import { createHash, randomUUID } from 'node:crypto';

import {
  MAX_CAMPAIGN_HANDOUT_BYTES,
  MAX_HANDOUT_BYTES,
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
      mediaId: null,
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
    if (!this.deps.media)
      throw new DomainError(
        'conflict',
        'file storage is not configured on this server (MEDIA_DIR)',
      );
    const title = input.title.trim();
    if (title.length < 1 || title.length > 200)
      throw new DomainError('invalid_input', 'title must be 1–200 characters');
    if (input.bytes.length === 0) throw new DomainError('invalid_input', 'the file is empty');
    if (input.bytes.length > MAX_HANDOUT_BYTES)
      throw new DomainError('too_large', 'that file is too large');

    const detected = detectMedia(input.bytes);
    const wanted = input.kind === 'pdf' ? 'pdf' : 'image';
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
      const handout: Handout = {
        id: this.newId(),
        campaignId,
        title,
        kind: input.kind,
        body: null,
        mediaId: media.id,
        visibility: 'dm',
        recipients: [],
        createdBy: user.id,
        createdAt: this.now(),
      };
      await this.deps.table.putHandout(handout);
      return handout;
    } catch (error) {
      // Don't leave an orphaned file behind if the database write failed.
      await this.deps.media.delete(media.id).catch(() => undefined);
      await this.deps.table.deleteMedia(media.id).catch(() => undefined);
      throw error;
    }
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
      if (current.kind !== 'text')
        throw new DomainError('invalid_input', 'only text can be edited');
      if (changes.text.length < 1 || changes.text.length > MAX_TEXT_HANDOUT_CHARS) {
        throw new DomainError(
          'invalid_input',
          `text must be 1–${MAX_TEXT_HANDOUT_CHARS} characters`,
        );
      }
      next.body = changes.text;
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
  ): Promise<{ media: MediaFile; bytes: Buffer }> {
    const handout = await this.get(user, campaignId, handoutId);
    if (!handout.mediaId || !this.deps.media) throw new DomainError('not_found');
    const [media, bytes] = await Promise.all([
      this.deps.table.getMedia(handout.mediaId),
      this.deps.media.get(handout.mediaId),
    ]);
    if (!media || !bytes) throw new DomainError('not_found');
    return { media, bytes };
  }

  async delete(user: User, campaignId: string, handoutId: string): Promise<void> {
    await this.requireDm(user, campaignId);
    const handout = await this.own(campaignId, handoutId);
    await this.deps.table.deleteHandout(handout.id);
    if (handout.mediaId) {
      await this.deps.table.deleteMedia(handout.mediaId);
      await this.deps.media?.delete(handout.mediaId);
    }
  }

  private async own(campaignId: string, handoutId: string): Promise<Handout> {
    const handout = await this.deps.table.getHandout(handoutId);
    if (!handout || handout.campaignId !== campaignId) throw new DomainError('not_found');
    return handout;
  }
}
