import { request } from '../api.js';
import type {
  CampaignItem,
  HandoutItem,
  RecordingItem,
  RsvpStatus,
  SceneMarker,
  SearchHit,
  SessionItem,
  SummaryItem,
  Utterance,
} from '../../types/phone.js';
import { lineFromHistory } from './chat.js';
import type { DmRequest, OpenTable } from './joinRequests.js';
import { transcriptRows, type TranscriptRow } from './transcriptRows.js';

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
      campaign: { id: string; name: string; allowJoin?: boolean };
      role: 'dm' | 'player';
    }[];
  }>('GET', '/api/campaigns');
  return res.campaigns.map((c) => ({
    id: c.campaign.id,
    name: c.campaign.name,
    role: c.role,
    ...(c.campaign.allowJoin === undefined ? {} : { allowJoin: c.campaign.allowJoin }),
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

export async function transcript(campaignId: string, id: string): Promise<TranscriptRow[]> {
  const res = await request<{ utterances: Utterance[]; markers?: SceneMarker[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings/${id}/transcript`,
  );
  return transcriptRows(res.utterances, res.markers);
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

/** Searches what was said, typed and summarised in the campaign's recorded sessions. */
export async function searchHistory(campaignId: string, q: string): Promise<SearchHit[]> {
  const res = await request<{ hits: SearchHit[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings/search?q=${encodeURIComponent(q)}`,
  );
  return res.hits;
}
