import { request } from '../api.js';
import type {
  CampaignItem,
  HandoutItem,
  RecordingItem,
  RsvpStatus,
  SearchHit,
  SessionItem,
  SummaryItem,
  Utterance,
} from '../../types/phone.js';
import { lineFromHistory } from './chat.js';

interface Login {
  sessionToken: string | null;
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

export const acceptConsent = (token: string, version: string) =>
  request('POST', '/api/auth/consent', { token, body: { version } });

export const me = (token: string) =>
  request<{ user: { id: string; displayName: string } }>('GET', '/api/auth/me', { token });

export const logout = (token: string) =>
  request('POST', '/api/auth/logout', { token }).catch(() => undefined);

export async function campaigns(token: string): Promise<CampaignItem[]> {
  const res = await request<{
    campaigns: { campaign: { id: string; name: string }; role: 'dm' | 'player' }[];
  }>('GET', '/api/campaigns', { token });
  return res.campaigns.map((c) => ({ id: c.campaign.id, name: c.campaign.name, role: c.role }));
}

export async function chatHistory(token: string, campaignId: string, before?: number) {
  const query = before === undefined ? '?limit=50' : `?limit=50&before=${before}`;
  const res = await request<{ messages: Parameters<typeof lineFromHistory>[0][] }>(
    'GET',
    `/api/campaigns/${campaignId}/chat${query}`,
    { token },
  );
  return res.messages.map(lineFromHistory);
}

export async function sessions(token: string, campaignId: string): Promise<SessionItem[]> {
  const res = await request<{ sessions: SessionItem[] }>(
    'GET',
    `/api/campaigns/${campaignId}/sessions`,
    { token },
  );
  return res.sessions;
}

export const answerRsvp = (
  token: string,
  campaignId: string,
  sessionId: string,
  status: RsvpStatus,
) =>
  request('PUT', `/api/campaigns/${campaignId}/sessions/${sessionId}/rsvp`, {
    token,
    body: { status },
  });

export async function handouts(token: string, campaignId: string): Promise<HandoutItem[]> {
  const res = await request<{ handouts: HandoutItem[] }>(
    'GET',
    `/api/campaigns/${campaignId}/handouts`,
    { token },
  );
  return res.handouts;
}

export async function recordings(token: string, campaignId: string): Promise<RecordingItem[]> {
  const res = await request<{ recordings: RecordingItem[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings`,
    { token },
  );
  return res.recordings;
}

export async function recording(token: string, campaignId: string, id: string) {
  return request<{ summaries: SummaryItem[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings/${id}`,
    { token },
  );
}

export async function transcript(
  token: string,
  campaignId: string,
  id: string,
): Promise<Utterance[]> {
  const res = await request<{ utterances: Utterance[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings/${id}/transcript`,
    { token },
  );
  return res.utterances;
}

/** A handout's file, as a Blob. The sign-in travels in a header, so it cannot be an `<img src>` directly. */
export async function handoutFile(
  token: string,
  campaignId: string,
  handoutId: string,
  index: number,
): Promise<Blob> {
  const response = await fetch(
    `/api/campaigns/${campaignId}/handouts/${handoutId}/files/${index}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!response.ok) throw new Error(`file ${response.status}`);
  return response.blob();
}

/** Searches what was said, typed and summarised in the campaign's recorded sessions. */
export async function searchHistory(
  token: string,
  campaignId: string,
  q: string,
): Promise<SearchHit[]> {
  const res = await request<{ hits: SearchHit[] }>(
    'GET',
    `/api/campaigns/${campaignId}/recordings/search?q=${encodeURIComponent(q)}`,
    { token },
  );
  return res.hits;
}
