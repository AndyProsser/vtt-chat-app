import { DEFAULT_AI_SETTINGS, type AiSettings } from '@vtt-chat-app/shared';

import type {
  Recording,
  RecordingEvent,
  RecordingStatus,
  RecordingTrack,
  SearchHit,
  Segment,
  StoredSummary,
  TrackTranscript,
} from '../../types/index.js';
import type { RecordsStore } from './recordsStore.js';

/** In-memory {@link RecordsStore} for tests and dry runs. */
export class MemoryRecordsStore implements RecordsStore {
  recordings = new Map<string, Recording>();
  tracks = new Map<string, RecordingTrack>();
  segments = new Map<string, Segment[]>();
  summaries = new Map<string, StoredSummary>();
  campaigns = new Map<string, string>();
  aiSettings: AiSettings = DEFAULT_AI_SETTINGS;

  getRecording = async (id: string) => this.recordings.get(id);
  putRecording = async (r: Recording) => void this.recordings.set(r.id, { ...r });
  setRecordingStatus = async (id: string, status: RecordingStatus) => {
    const r = this.recordings.get(id);
    if (r) r.status = status;
  };

  events: RecordingEvent[] = [];
  /** Recordings whose members were told the summary is ready. */
  notified: string[] = [];
  audioPurgeNotices: { recordingId: string; purgeAt: number }[] = [];
  markAudioNotice = async (recordingId: string, at: number) => {
    const r = this.recordings.get(recordingId);
    if (r && (r.audioNoticeAt ?? null) === null) r.audioNoticeAt = at;
  };
  notifyAudioPurgeSoon = async (recordingId: string, purgeAt: number) =>
    void this.audioPurgeNotices.push({ recordingId, purgeAt });
  notifySummaryReady = async (recordingId: string) => void this.notified.push(recordingId);
  addRecordingEvent = async (e: RecordingEvent) => void this.events.push({ ...e });
  listRecordingEvents = async (recordingId: string) =>
    this.events.filter((e) => e.recordingId === recordingId).map((e) => ({ ...e }));

  markTrackPurged = async (trackId: string, at: number) => {
    const track = this.tracks.get(trackId);
    if (track) track.purgedAt = at;
  };
  listPurgeableRecordings = async (stoppedBefore: number, limit: number) =>
    [...this.recordings.values()]
      .filter(
        (r) =>
          r.status === 'processed' &&
          r.stoppedAt !== null &&
          r.stoppedAt < stoppedBefore &&
          [...this.tracks.values()].some(
            (t) => t.recordingId === r.id && (t.purgedAt ?? null) === null,
          ),
      )
      .sort((a, b) => (a.stoppedAt ?? 0) - (b.stoppedAt ?? 0))
      .slice(0, limit);

  listTracks = async (recordingId: string) =>
    [...this.tracks.values()].filter((t) => t.recordingId === recordingId);
  putTrack = async (t: RecordingTrack) => void this.tracks.set(t.id, { ...t });

  saveTrackTranscript = async (trackId: string, segments: Segment[], now: number) => {
    const track = this.tracks.get(trackId);
    if (!track) throw new Error(`no track ${trackId}`);
    if (track.private) throw new Error(`track ${trackId} is private and must never be transcribed`);
    this.segments.set(
      trackId,
      segments.map((s) => ({ ...s })),
    );
    track.transcribedAt = now;
  };

  listTranscripts = async (recordingId: string): Promise<TrackTranscript[]> =>
    [...this.tracks.values()]
      .filter((t) => t.recordingId === recordingId && !t.private && t.transcribedAt !== null)
      .map((t) => ({
        speaker: { id: t.speakerId, name: t.speakerName },
        startOffsetMs: t.startOffsetMs,
        segments: this.segments.get(t.id) ?? [],
      }));

  listRecordings = async (limit: number) =>
    [...this.recordings.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map((r) => ({ ...r }));

  resetForReprocess = async (recordingId: string, options: { transcripts: boolean }) => {
    for (const key of [...this.summaries.keys()]) {
      if (key.startsWith(`${recordingId}|`)) this.summaries.delete(key);
    }
    if (!options.transcripts) return;
    for (const t of this.tracks.values()) {
      if (t.recordingId !== recordingId) continue;
      this.segments.delete(t.id);
      t.transcribedAt = null;
    }
  };

  listRecordingsForCampaign = async (campaignId: string) =>
    [...this.recordings.values()]
      .filter((r) => r.campaignId === campaignId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((r) => ({ ...r }));

  listSummaries = async (recordingId: string) =>
    [...this.summaries.values()]
      .filter((s) => s.recordingId === recordingId)
      .map((s) => ({ ...s }));

  deleteRecording = async (recordingId: string) => {
    this.recordings.delete(recordingId);
    for (const [id, t] of [...this.tracks]) {
      if (t.recordingId !== recordingId) continue;
      this.tracks.delete(id);
      this.segments.delete(id);
    }
    for (const key of [...this.summaries.keys()]) {
      if (key.startsWith(`${recordingId}|`)) this.summaries.delete(key);
    }
    this.events = this.events.filter((e) => e.recordingId !== recordingId);
  };

  search = async (
    campaignId: string,
    query: string,
    options: { includeDmOnly: boolean; limit: number },
  ): Promise<SearchHit[]> => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string): boolean => {
      const lower = text.toLowerCase();
      return terms.length > 0 && terms.every((t) => lower.includes(t));
    };
    const hits: SearchHit[] = [];
    for (const r of this.recordings.values()) {
      if (r.campaignId !== campaignId) continue;
      for (const t of this.tracks.values()) {
        if (t.recordingId !== r.id || t.private) continue;
        for (const s of this.segments.get(t.id) ?? []) {
          if (matches(s.text)) {
            hits.push({
              recordingId: r.id,
              source: 'transcript',
              speakerName: t.speakerName,
              atMs: t.startOffsetMs + s.startMs,
              snippet: s.text,
            });
          }
        }
      }
      for (const e of this.events) {
        const d = e.detail;
        if (e.recordingId !== r.id || e.event !== 'chat' || !d) continue;
        if (d.to !== undefined || d.recipientId !== undefined) continue; // never a whisper
        if (d.kind === 'ooc') continue; // never out of character
        if (typeof d.text === 'string' && matches(d.text)) {
          hits.push({
            recordingId: r.id,
            source: 'chat',
            speakerName: String(d.senderName ?? 'Someone'),
            atMs: Math.max(0, e.at - r.startedAt),
            snippet: d.text,
          });
        }
      }
      for (const s of this.summaries.values()) {
        if (s.recordingId !== r.id || (s.visibility === 'dm' && !options.includeDmOnly)) continue;
        if (matches(s.text)) {
          hits.push({
            recordingId: r.id,
            source: 'summary',
            kind: s.kind,
            snippet: s.text.slice(0, 200),
          });
        }
      }
    }
    return hits.slice(0, options.limit);
  };

  private key = (recordingId: string, kind: string, subject: string) =>
    `${recordingId}|${kind}|${subject}`;
  getSummary = async (recordingId: string, kind: string, subject: string) =>
    this.summaries.get(this.key(recordingId, kind, subject));
  putSummary = async (s: StoredSummary) =>
    void this.summaries.set(this.key(s.recordingId, s.kind, s.subject), { ...s });

  campaignName = async (campaignId: string) => this.campaigns.get(campaignId);
  /** Players per campaign (everyone but the DM). */
  players = new Map<string, string[]>();
  playerIds = async (campaignId: string) => [...(this.players.get(campaignId) ?? [])];
  getAiSettings = async () => this.aiSettings;
}
