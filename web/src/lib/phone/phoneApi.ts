import type { CharacterRecord } from '@vtt-chat-app/shared';

import { ApiError, request } from '../api.js';
import type {
  CampaignItem,
  GmNoteFileItem,
  GmNotesData,
  LootItem,
  HandoutItem,
  RecordingItem,
  RsvpStatus,
  SearchHit,
  SessionItem,
  SummaryItem,
} from '../../types/phone.js';
import { lineFromHistory } from './chat.js';
import type { DmRequest, OpenTable } from './joinRequests.js';

interface Login {
  signedIn?: boolean;
  needsConsent?: boolean;
  user?: { id?: string; displayName?: string };
}

export interface Providers {
  consentVersion: string;
}

export const providers = () => request<Providers>('GET', '/api/auth/providers');

/** Signs in with email and password. The result says whether a changed recording notice must be accepted. */
export const login = (email: string, password: string) =>
  request<Login>('POST', '/api/auth/login', {
    body: { email, password, deviceLabel: 'Phone (browser)' },
  });

/** Signs in with a one-time code the DM or operator handed over. */
export const redeemCode = (code: string) =>
  request<Login>('POST', '/api/auth/magic-link/redeem', {
    body: { token: code.trim(), deviceLabel: 'Phone (browser)' },
  });

export const acceptConsent = (version: string) =>
  request('POST', '/api/auth/consent', { body: { version } });

/** Is the browser's session cookie still good? Also slides its expiry, so opening the app keeps you signed in. */
export const me = () =>
  request<{ user: { id: string; displayName: string } }>('GET', '/api/auth/me');

export async function campaigns(): Promise<CampaignItem[]> {
  const res = await request<{
    campaigns: {
      campaign: {
        id: string;
        name: string;
        allowJoin?: boolean;
        description?: string;
        bard?: string;
      };
      role: 'dm' | 'player';
    }[];
  }>('GET', '/api/campaigns');
  return res.campaigns.map((c) => ({
    id: c.campaign.id,
    name: c.campaign.name,
    role: c.role,
    ...(c.campaign.allowJoin === undefined ? {} : { allowJoin: c.campaign.allowJoin }),
    ...(c.campaign.description === undefined ? {} : { description: c.campaign.description }),
    ...(c.campaign.bard === undefined ? {} : { bard: c.campaign.bard }),
  }));
}

/** Tables that take requests to join (empty when the operator's directory is off). */
export const openTables = () =>
  request<{ campaigns: OpenTable[] }>('GET', '/api/campaigns/open').then((r) => r.campaigns);

export const requestToJoin = (campaignId: string, message: string) =>
  request('POST', `/api/campaigns/${campaignId}/join-requests`, {
    body: message ? { message } : {},
  });

export const withdrawJoinRequest = (campaignId: string) =>
  request('DELETE', `/api/campaigns/${campaignId}/join-requests/mine`);

/** The DM's view: the switch and every request (pending and recent decisions). */
export const joinRequests = (campaignId: string) =>
  request<{ allowJoin: boolean; requests: DmRequest[] }>(
    'GET',
    `/api/campaigns/${campaignId}/join-requests`,
  );

export const decideJoinRequest = (campaignId: string, requestId: string, approve: boolean) =>
  request('POST', `/api/campaigns/${campaignId}/join-requests/${requestId}/decision`, {
    body: { approve },
  });

/** The DM edits the name and description, and picks the storyteller; send only what changed. */
export const updateCampaign = (
  campaignId: string,
  body: { name?: string; description?: string; bard?: string },
) => request('PATCH', `/api/campaigns/${campaignId}`, { body });

/** Which storytellers this server offers, and who will tell this campaign's tales. */
export const storytellers = (campaignId: string) =>
  request<{ offered: string[]; chosen: string; effective: string }>(
    'GET',
    `/api/campaigns/${campaignId}/storytellers`,
  );

/** One invite code for the whole group (the server's default expiry). */
export const createInvite = (campaignId: string) =>
  request<{ code: string; expiresAt?: number }>('POST', `/api/campaigns/${campaignId}/invites`, {
    body: {},
  });

/** Stops every invite link still in use. */
export const resetInvites = (campaignId: string) =>
  request('DELETE', `/api/campaigns/${campaignId}/invites`);

export const leaveCampaign = (campaignId: string) =>
  request('POST', `/api/campaigns/${campaignId}/leave`, { body: {} });

export const setAllowJoin = (campaignId: string, allowJoin: boolean) =>
  request('PATCH', `/api/campaigns/${campaignId}`, { body: { allowJoin } });

export async function chatHistory(campaignId: string, before?: number) {
  const query = before === undefined ? '?limit=50' : `?limit=50&before=${before}`;
  const res = await request<{ messages: Parameters<typeof lineFromHistory>[0][] }>(
    'GET',
    `/api/campaigns/${campaignId}/chat${query}`,
  );
  return res.messages.map(lineFromHistory);
}

export async function sessions(campaignId: string): Promise<SessionItem[]> {
  const res = await request<{ sessions: SessionItem[] }>(
    'GET',
    `/api/campaigns/${campaignId}/sessions`,
  );
  return res.sessions;
}

export const answerRsvp = (campaignId: string, sessionId: string, status: RsvpStatus) =>
  request('PUT', `/api/campaigns/${campaignId}/sessions/${sessionId}/rsvp`, {
    body: { status },
  });

export async function handouts(campaignId: string): Promise<HandoutItem[]> {
  const res = await request<{ handouts: HandoutItem[] }>(
    'GET',
    `/api/campaigns/${campaignId}/handouts`,
  );
  return res.handouts;
}

// ---- the party's loot ----

export async function lootItems(campaignId: string): Promise<LootItem[]> {
  const res = await request<{ loot: LootItem[] }>('GET', `/api/campaigns/${campaignId}/loot`);
  return res.loot;
}

/** One action on one item: the path and body come from `lootRequest` (shared with the desktop app). */
export const lootDo = (
  campaignId: string,
  itemId: string,
  req: { path: string; body: Record<string, unknown> },
) => request('POST', `/api/campaigns/${campaignId}/loot/${itemId}/${req.path}`, { body: req.body });

/** Ticks (or un-ticks) "I have added this to my game sheet" for an item you hold, the party stash or your share. */
export const lootConfirm = (campaignId: string, itemId: string, confirmed: boolean) =>
  request('POST', `/api/campaigns/${campaignId}/loot/${itemId}/confirm`, { body: { confirmed } });

// ---- the DM's tools (the server refuses anyone else with 403) ----

/** A new note: a DM-only draft until it is shown. */
export const createNote = (campaignId: string, title: string, text: string) =>
  request<{ handout: HandoutItem }>('POST', `/api/campaigns/${campaignId}/handouts`, {
    body: { title, text },
  }).then((r) => r.handout);

export const updateNote = (
  campaignId: string,
  id: string,
  patch: { title?: string; text?: string },
) =>
  request<{ handout: HandoutItem }>('PATCH', `/api/campaigns/${campaignId}/handouts/${id}`, {
    body: patch,
  }).then((r) => r.handout);

export const showHandout = (campaignId: string, id: string) =>
  request('POST', `/api/campaigns/${campaignId}/handouts/${id}/show`, { body: { to: 'all' } });

export const hideHandout = (campaignId: string, id: string) =>
  request('POST', `/api/campaigns/${campaignId}/handouts/${id}/hide`, { body: {} });

export const deleteHandout = (campaignId: string, id: string) =>
  request('DELETE', `/api/campaigns/${campaignId}/handouts/${id}`);

export const createSession = (
  campaignId: string,
  body: { title: string; startsAt: number; durationMinutes: number; notes: string },
) => request('POST', `/api/campaigns/${campaignId}/sessions`, { body });

export const updateSession = (
  campaignId: string,
  id: string,
  patch: { title?: string; startsAt?: number; durationMinutes?: number; notes?: string },
) => request('PATCH', `/api/campaigns/${campaignId}/sessions/${id}`, { body: patch });

export const cancelSession = (campaignId: string, id: string) =>
  request('DELETE', `/api/campaigns/${campaignId}/sessions/${id}`);

export async function recordings(campaignId: string): Promise<RecordingItem[]> {
  const res = await request<{ recordings: RecordingItem[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings`,
  );
  return res.recordings;
}

export async function recording(campaignId: string, id: string) {
  return request<{ summaries: SummaryItem[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings/${id}`,
  );
}

/** A handout's file, as a Blob. Fetched (with the session cookie) so a failure can be told from a missing picture, then shown from a blob URL. */
export async function handoutFile(
  campaignId: string,
  handoutId: string,
  index: number,
): Promise<Blob> {
  const response = await fetch(
    `/api/campaigns/${campaignId}/handouts/${handoutId}/files/${index}`,
    { credentials: 'same-origin' },
  );
  if (!response.ok) throw new Error(`file ${response.status}`);
  return response.blob();
}

/**
 * Searches the campaign's tales and summaries. The server also gives a DM the lines of the transcript; the
 * phone has no transcript view (that is the desktop app's, in dev mode), so they are left out here.
 */
export async function searchHistory(campaignId: string, q: string): Promise<SearchHit[]> {
  const res = await request<{ hits: SearchHit[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings/search?q=${encodeURIComponent(q)}`,
  );
  return res.hits.filter((h) => h.source === 'summary');
}

// ---- Characters and the D&D Beyond link (existing routes; the desktop app uses the same ones) ----

export const myCharacters = (campaignId: string) =>
  request<{ characters: CharacterRecord[] }>('GET', `/api/campaigns/${campaignId}/characters`);

export const saveCharacter = (
  campaignId: string,
  characterId: string,
  patch: Record<string, unknown>,
) =>
  request<{ character: CharacterRecord }>(
    'PATCH',
    `/api/campaigns/${campaignId}/characters/${characterId}`,
    { body: patch },
  );

export const addCharacter = (campaignId: string, body: Record<string, unknown>) =>
  request<{ character: CharacterRecord }>('POST', `/api/campaigns/${campaignId}/characters`, {
    body,
  });

/** Deletes one of your own characters (the server hands the part to your next one if it was the one played). */
export const deleteCharacter = (campaignId: string, characterId: string) =>
  request('DELETE', `/api/campaigns/${campaignId}/characters/${characterId}`);

/** Makes this the character the table sees you playing. */
export const playCharacter = (campaignId: string, characterId: string) =>
  request('PUT', `/api/campaigns/${campaignId}/active-character`, { body: { characterId } });

/** Whether the operator switched D&D Beyond sync on. */
export const ddbEnabled = () => request<{ enabled: boolean }>('GET', '/api/ddb/status');

export const ddbCall = (
  action: 'link' | 'sync' | 'unlink',
  campaignId: string,
  characterId: string,
  url?: string,
) =>
  request<{ character: CharacterRecord }>('POST', `/api/ddb/${action}`, {
    body: { campaignId, characterId, ...(url ? { url } : {}) },
  });

// ---- The Game Master's notes (the Game Master's alone; the same endpoints as the desktop app) -------------------

/** The notes page, its attachments, and the largest file this server takes. */
export const gmNotes = (campaignId: string) =>
  request<GmNotesData>('GET', `/api/campaigns/${campaignId}/gm/notes`);

export const saveGmNotes = (campaignId: string, body: string) =>
  request('PUT', `/api/campaigns/${campaignId}/gm/notes`, { body: { body } });

/** An attachment, as a Blob: fetched with the session cookie so a failure can be told from a picture that is just slow. */
export async function gmNoteFile(campaignId: string, fileId: string): Promise<Blob> {
  const response = await fetch(`/api/campaigns/${campaignId}/gm/notes/files/${fileId}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(`file ${response.status}`);
  return response.blob();
}

/** Attaches a picture or PDF: the file's own bytes in the body, its name in the query (the server decides the type from the bytes). */
export async function addGmNoteFile(campaignId: string, file: File): Promise<GmNoteFileItem> {
  const response = await fetch(
    `/api/campaigns/${campaignId}/gm/notes/files?name=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-VTT-Client': 'web', 'Content-Type': 'application/octet-stream' },
      body: file,
    },
  );
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiError(
      String(data.error ?? 'error'),
      String(data.message ?? `upload failed (${response.status})`),
      response.status,
    );
  }
  return data.file as GmNoteFileItem;
}

export const deleteGmNoteFile = (campaignId: string, fileId: string) =>
  request('DELETE', `/api/campaigns/${campaignId}/gm/notes/files/${fileId}`);
