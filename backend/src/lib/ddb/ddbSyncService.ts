import { randomUUID } from 'node:crypto';

import {
  characterIdFromUrl,
  characterSheetUrl,
  fetchCharacter,
  portraitAllowed,
  PORTRAIT_HOSTS,
  type DdbCharacter,
  type FetchLike,
  type FetchOutcome,
} from '@vtt-chat-app/ddb';

import { MAX_AVATAR_BYTES } from '../../consts/index.js';
import type { CampaignService } from '../campaigns/campaignService.js';
import { DomainError } from '../errors.js';
import { detectMedia, type MediaStorage } from '../media/mediaStorage.js';
import type { Store } from '../store/store.js';
import type { Character, User } from '../../types/index.js';

export interface DdbSyncDeps {
  store: Store;
  campaigns: CampaignService;
  media?: MediaStorage;
  /** Off by default: the sync reaches out to a third party, so the operator must opt in. */
  enabled: boolean;
  intervalMs: number;
  /** Called when a sync changed a character, so live clients refresh the roster. */
  onChanged?: (campaignId: string) => void;
  now?: () => number;
  fetchSheet?: (id: string) => Promise<FetchOutcome>;
  fetchImage?: (url: string) => Promise<Buffer | undefined>;
}

export type SyncResult =
  'updated' | 'unchanged' | 'private' | 'not_found' | 'unavailable' | 'unreadable';

const REASON_TEXT: Record<string, string> = {
  private: 'that character is private: on D&D Beyond, set its sharing to public',
  not_found: 'D&D Beyond has no character with that id',
  unavailable: 'D&D Beyond could not be reached just now; try again shortly',
  unreadable: 'D&D Beyond sent something this app does not understand',
};

/**
 * Keeps a character in step with its public D&D Beyond sheet: name, race, class, level and portrait.
 * A link is made by the player, refreshed on demand or on a timer, and removed by the player; nothing
 * here touches D&D Beyond unless a player linked a character and the operator enabled the sync.
 */
export class DdbSyncService {
  private readonly now: () => number;
  private readonly fetchSheet: (id: string) => Promise<FetchOutcome>;
  private readonly fetchImage: (url: string) => Promise<Buffer | undefined>;

  constructor(private readonly deps: DdbSyncDeps) {
    this.now = deps.now ?? Date.now;
    this.fetchSheet =
      deps.fetchSheet ?? ((id) => fetchCharacter(id, fetch as unknown as FetchLike));
    this.fetchImage = deps.fetchImage ?? defaultFetchImage;
  }

  get enabled(): boolean {
    return this.deps.enabled;
  }

  /** Links one of the caller's characters to a sheet and reads it straight away. */
  async link(user: User, campaignId: string, characterId: string, url: string): Promise<Character> {
    this.requireEnabled();
    const mine = await this.ownCharacter(user, campaignId, characterId);
    const id = characterIdFromUrl(url);
    if (!id) throw new DomainError('invalid_input', 'that is not a D&D Beyond character link');
    const outcome = await this.fetchSheet(id);
    if (!outcome.ok) throw new DomainError('invalid_input', REASON_TEXT[outcome.reason]!);
    // A fresh link forgets the old portrait source so the new sheet's portrait is imported.
    const linked: Character = {
      ...mine,
      sourceUrl: characterSheetUrl(id),
      sourceAvatar: null,
      sheet: null,
    };
    return this.apply(linked, outcome.character);
  }

  async unlink(user: User, campaignId: string, characterId: string): Promise<Character> {
    this.requireEnabled();
    const mine = await this.ownCharacter(user, campaignId, characterId);
    const next: Character = {
      ...mine,
      sourceUrl: null,
      syncedAt: null,
      sourceAvatar: null,
      sheet: null,
    };
    await this.deps.store.putCharacter(next);
    this.deps.onChanged?.(next.campaignId);
    return next;
  }

  /** "Sync now" from the character screen. */
  async syncNow(user: User, campaignId: string, characterId: string): Promise<Character> {
    this.requireEnabled();
    const mine = await this.ownCharacter(user, campaignId, characterId);
    if (!mine.sourceUrl) throw new DomainError('invalid_input', 'this character is not linked');
    const result = await this.syncCharacter(mine);
    if (result !== 'updated' && result !== 'unchanged')
      throw new DomainError('invalid_input', REASON_TEXT[result]!);
    return (await this.deps.store.getCharacter(characterId)) ?? mine;
  }

  /** The timer's work: every linked character not read within the interval, one at a time. */
  async syncDue(): Promise<number> {
    if (!this.deps.enabled) return 0;
    const cutoff = this.now() - this.deps.intervalMs;
    let done = 0;
    for (const character of await this.deps.store.listLinkedCharacters()) {
      if (character.syncedAt !== null && character.syncedAt > cutoff) continue;
      await this.syncCharacter(character).catch(() => undefined);
      done += 1;
    }
    return done;
  }

  async syncCharacter(character: Character): Promise<SyncResult> {
    const id = character.sourceUrl ? characterIdFromUrl(character.sourceUrl) : undefined;
    if (!id) return 'unreadable';
    const outcome = await this.fetchSheet(id);
    // A failure keeps the last good data and leaves syncedAt alone, so the next tick tries again.
    if (!outcome.ok) return outcome.reason;
    const before = JSON.stringify(character);
    const after = await this.apply(character, outcome.character);
    return JSON.stringify(after) === before ? 'unchanged' : 'updated';
  }

  private async apply(character: Character, sheet: DdbCharacter): Promise<Character> {
    let { avatarUrl, sourceAvatar } = character;
    if (sheet.portraitUrl && sheet.portraitUrl !== sourceAvatar) {
      const stored = await this.importPortrait(sheet.portraitUrl);
      // Only mark it imported when it was stored, so a too-large picture is retried only if it changes.
      sourceAvatar = sheet.portraitUrl;
      if (stored) avatarUrl = stored;
    }
    const next: Character = {
      ...character,
      name: sheet.name,
      race: sheet.race ?? character.race,
      className: sheet.className ?? character.className,
      level: sheet.level ?? character.level,
      avatarUrl,
      sourceAvatar,
      // A sheet that stops parsing keeps the last good numbers, like every other field.
      sheet: sheet.sheet ?? character.sheet,
      syncedAt: this.now(),
    };
    await this.deps.store.putCharacter(next);
    const changed =
      JSON.stringify({ ...next, syncedAt: 0 }) !== JSON.stringify({ ...character, syncedAt: 0 });
    if (changed) this.deps.onChanged?.(next.campaignId);
    return next;
  }

  /** Fetches the portrait into our own storage (the app never loads from the open web). */
  private async importPortrait(url: string): Promise<string | undefined> {
    const { media } = this.deps;
    if (!media || !portraitAllowed(url, PORTRAIT_HOSTS)) return undefined;
    const bytes = await this.fetchImage(url).catch(() => undefined);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return undefined;
    if (detectMedia(bytes)?.kind !== 'image') return undefined;
    const id = randomUUID();
    await media.put(id, bytes);
    return `avatar:${id}`;
  }

  private requireEnabled(): void {
    if (!this.deps.enabled)
      throw new DomainError('not_found', 'D&D Beyond sync is not enabled on this server');
  }

  private async ownCharacter(
    user: User,
    campaignId: string,
    characterId: string,
  ): Promise<Character> {
    await this.deps.campaigns.listMyCharacters(user, campaignId); // membership check
    const c = await this.deps.store.getCharacter(characterId);
    if (!c || c.userId !== user.id || c.campaignId !== campaignId)
      throw new DomainError('not_found');
    return c;
  }
}

async function defaultFetchImage(url: string): Promise<Buffer | undefined> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
    headers: { 'User-Agent': 'vtt-chat-app character sync' },
  });
  if (!response.ok) return undefined;
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_AVATAR_BYTES) return undefined;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length <= MAX_AVATAR_BYTES ? bytes : undefined;
}
