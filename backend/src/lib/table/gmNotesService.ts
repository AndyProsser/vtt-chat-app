import { createHash, randomUUID } from 'node:crypto';

import {
  GLOSSARY_ALIASES_MAX,
  GLOSSARY_TERM_MAX,
  GLOSSARY_TERMS_MAX,
  GM_NOTES_BODY_MAX,
  isGlossaryKind,
  type GlossaryKind,
} from '@vtt-chat-app/shared';

import { MAX_CAMPAIGN_HANDOUT_BYTES } from '../../consts/index.js';
import type { User } from '../../types/index.js';
import { DomainError } from '../errors.js';
import { detectMedia, type MediaStorage } from '../media/mediaStorage.js';
import type { Store } from '../store/store.js';
import type { GlossaryTerm, GmNoteFile, MediaFile, TableStore } from './tableStore.js';

export interface GmNotesDeps {
  store: Store;
  table: TableStore;
  media: MediaStorage | undefined;
  /** The largest single attachment, in bytes (the operator's `GM_NOTES_MAX_MB`). */
  maxFileBytes: number;
  now?: () => number;
  newId?: () => string;
}

/** What the apps see of an attachment. */
export interface GmNoteFileView {
  id: string;
  name: string;
  kind: 'image' | 'pdf';
  mime: string;
  bytes: number;
  createdAt: number;
}

/**
 * The Game Master's notes and the campaign glossary (Stage 11 items 5 and 6). **Both are the Game Master's alone**:
 * every method refuses anyone who is not the DM of that campaign, a player included. The notes are one Markdown page
 * per campaign with picture and PDF attachments (checked by their bytes, like handouts); the glossary is a list of
 * terms, with room for suggestions that wait for approval.
 */
export class GmNotesService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: GmNotesDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  private async requireDm(user: User, campaignId: string): Promise<void> {
    const m = await this.deps.store.getMembership(campaignId, user.id);
    if (!m) throw new DomainError('forbidden', 'not a member of this campaign');
    if (m.role !== 'dm') throw new DomainError('forbidden', 'only the Game Master can read this');
  }

  // ── Notes ──────────────────────────────────────────────────────────────

  async get(user: User, campaignId: string) {
    await this.requireDm(user, campaignId);
    const [notes, files] = await Promise.all([
      this.deps.table.getGmNotes(campaignId),
      this.deps.table.listGmNoteFiles(campaignId),
    ]);
    const views: GmNoteFileView[] = [];
    for (const f of files) {
      const media = await this.deps.table.getMedia(f.mediaId);
      if (media && (media.kind === 'image' || media.kind === 'pdf'))
        views.push({
          id: f.id,
          name: f.name,
          kind: media.kind,
          mime: media.mime,
          bytes: media.bytes,
          createdAt: f.createdAt,
        });
    }
    return {
      body: notes?.body ?? '',
      updatedAt: notes?.updatedAt ?? null,
      files: views,
      /** The largest attachment this server takes, so the app can say so before uploading. */
      maxFileBytes: this.deps.maxFileBytes,
    };
  }

  async save(user: User, campaignId: string, body: string): Promise<{ updatedAt: number }> {
    await this.requireDm(user, campaignId);
    const text = body.replace(/\r\n?/g, '\n');
    if ([...text].length > GM_NOTES_BODY_MAX)
      throw new DomainError('too_large', 'these notes are too long to save');
    const updatedAt = this.now();
    await this.deps.table.putGmNotes({ campaignId, body: text, updatedAt, updatedBy: user.id });
    return { updatedAt };
  }

  async addFile(
    user: User,
    campaignId: string,
    input: { bytes: Buffer; name: string },
  ): Promise<GmNoteFileView> {
    await this.requireDm(user, campaignId);
    if (!this.deps.media)
      throw new DomainError(
        'conflict',
        'file storage is not configured on this server (MEDIA_DIR)',
      );
    if (input.bytes.length === 0) throw new DomainError('invalid_input', 'the file is empty');
    if (input.bytes.length > this.deps.maxFileBytes)
      throw new DomainError('too_large', 'that file is larger than this server allows');
    const detected = detectMedia(input.bytes);
    if (!detected || (detected.kind !== 'image' && detected.kind !== 'pdf'))
      throw new DomainError(
        'unsupported_media',
        'attachments are pictures (PNG, JPEG, GIF or WebP) and PDFs',
      );
    const used = await this.deps.table.campaignHandoutBytes(campaignId);
    if (used + input.bytes.length > MAX_CAMPAIGN_HANDOUT_BYTES)
      throw new DomainError('too_large', 'this campaign has used up its file storage');
    const name = input.name.trim().slice(0, 200) || 'attachment';
    const media: MediaFile = {
      id: this.newId(),
      ownerId: user.id,
      kind: detected.kind,
      mime: detected.mime,
      bytes: input.bytes.length,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      originalName: name,
      createdAt: this.now(),
    };
    await this.deps.media.put(media.id, input.bytes);
    const file: GmNoteFile = {
      id: this.newId(),
      campaignId,
      mediaId: media.id,
      name,
      createdAt: this.now(),
    };
    try {
      await this.deps.table.putMedia(media);
      await this.deps.table.putGmNoteFile(file);
    } catch (error) {
      await this.discard(media.id);
      throw error;
    }
    return {
      id: file.id,
      name,
      kind: detected.kind,
      mime: media.mime,
      bytes: media.bytes,
      createdAt: file.createdAt,
    };
  }

  private async ownFile(campaignId: string, fileId: string): Promise<GmNoteFile> {
    const file = await this.deps.table.getGmNoteFile(fileId);
    // A file of another campaign is indistinguishable from a missing one.
    if (!file || file.campaignId !== campaignId) throw new DomainError('not_found');
    return file;
  }

  async readFile(
    user: User,
    campaignId: string,
    fileId: string,
  ): Promise<{ media: MediaFile; bytes: Buffer; name: string }> {
    await this.requireDm(user, campaignId);
    const file = await this.ownFile(campaignId, fileId);
    if (!this.deps.media) throw new DomainError('not_found');
    const [media, bytes] = await Promise.all([
      this.deps.table.getMedia(file.mediaId),
      this.deps.media.get(file.mediaId),
    ]);
    if (!media || !bytes) throw new DomainError('not_found');
    return { media, bytes, name: file.name };
  }

  async removeFile(user: User, campaignId: string, fileId: string): Promise<void> {
    await this.requireDm(user, campaignId);
    const file = await this.ownFile(campaignId, fileId);
    await this.deps.table.deleteGmNoteFile(file.id);
    await this.discard(file.mediaId);
  }

  private async discard(mediaId: string): Promise<void> {
    await this.deps.media?.delete(mediaId).catch(() => undefined);
    await this.deps.table.deleteMedia(mediaId).catch(() => undefined);
  }

  // ── Glossary ───────────────────────────────────────────────────────────

  async listGlossary(user: User, campaignId: string): Promise<GlossaryTerm[]> {
    await this.requireDm(user, campaignId);
    return this.deps.table.listGlossary(campaignId);
  }

  async addTerm(
    user: User,
    campaignId: string,
    input: { term: string; kind?: string | undefined; aliases?: string[] | undefined },
  ): Promise<GlossaryTerm> {
    await this.requireDm(user, campaignId);
    if ((await this.deps.table.listGlossary(campaignId)).length >= GLOSSARY_TERMS_MAX)
      throw new DomainError('too_large', `a glossary holds at most ${GLOSSARY_TERMS_MAX} terms`);
    const term: GlossaryTerm = {
      id: this.newId(),
      campaignId,
      ...cleanTerm(input),
      status: 'approved',
      createdAt: this.now(),
    };
    if (!(await this.deps.table.putGlossaryTerm(term)))
      throw new DomainError('conflict', 'the glossary already has that term');
    return term;
  }

  async updateTerm(
    user: User,
    campaignId: string,
    id: string,
    input: { term?: string; kind?: string; aliases?: string[] },
  ): Promise<GlossaryTerm> {
    await this.requireDm(user, campaignId);
    const current = await this.ownTerm(campaignId, id);
    const next: GlossaryTerm = {
      ...current,
      ...cleanTerm({
        term: input.term ?? current.term,
        kind: input.kind ?? current.kind,
        aliases: input.aliases ?? current.aliases,
      }),
    };
    if (!(await this.deps.table.putGlossaryTerm(next)))
      throw new DomainError('conflict', 'the glossary already has that term');
    return next;
  }

  /** Approves a suggested term (or leaves an approved one alone). */
  async approveTerm(user: User, campaignId: string, id: string): Promise<GlossaryTerm> {
    await this.requireDm(user, campaignId);
    const current = await this.ownTerm(campaignId, id);
    if (current.status === 'approved') return current;
    const next: GlossaryTerm = { ...current, status: 'approved' };
    await this.deps.table.putGlossaryTerm(next);
    return next;
  }

  /** Removes a term, or turns a suggestion down. */
  async removeTerm(user: User, campaignId: string, id: string): Promise<void> {
    await this.requireDm(user, campaignId);
    await this.ownTerm(campaignId, id);
    await this.deps.table.deleteGlossaryTerm(id);
  }

  private async ownTerm(campaignId: string, id: string): Promise<GlossaryTerm> {
    const term = await this.deps.table.getGlossaryTerm(id);
    if (!term || term.campaignId !== campaignId) throw new DomainError('not_found');
    return term;
  }
}

/** Trims and checks a term and its aliases: 1 to 100 characters each, at most ten aliases, none repeated. */
function cleanTerm(input: {
  term: string;
  kind?: string | undefined;
  aliases?: string[] | undefined;
}): {
  term: string;
  kind: GlossaryKind;
  aliases: string[];
} {
  const term = input.term.trim().replace(/\s+/g, ' ');
  if (term.length < 1 || term.length > GLOSSARY_TERM_MAX)
    throw new DomainError('invalid_input', `a term is 1 to ${GLOSSARY_TERM_MAX} characters`);
  const kind = input.kind ?? 'other';
  if (!isGlossaryKind(kind)) throw new DomainError('invalid_input', 'unknown kind of term');
  const seen = new Set([term.toLowerCase()]);
  const aliases: string[] = [];
  for (const raw of input.aliases ?? []) {
    const alias = raw.trim().replace(/\s+/g, ' ');
    if (alias === '' || seen.has(alias.toLowerCase())) continue;
    if (alias.length > GLOSSARY_TERM_MAX)
      throw new DomainError('invalid_input', `an alias is at most ${GLOSSARY_TERM_MAX} characters`);
    seen.add(alias.toLowerCase());
    aliases.push(alias);
  }
  if (aliases.length > GLOSSARY_ALIASES_MAX)
    throw new DomainError('invalid_input', `a term has at most ${GLOSSARY_ALIASES_MAX} aliases`);
  return { term, kind, aliases };
}
