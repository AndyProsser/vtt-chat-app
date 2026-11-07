import { DEFAULT_AI_SETTINGS, type AiSettings } from '@vtt-chat-app/shared';

import type {
  Recording,
  RecordingStatus,
  RecordingTrack,
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

  private key = (recordingId: string, kind: string, subject: string) =>
    `${recordingId}|${kind}|${subject}`;
  getSummary = async (recordingId: string, kind: string, subject: string) =>
    this.summaries.get(this.key(recordingId, kind, subject));
  putSummary = async (s: StoredSummary) =>
    void this.summaries.set(this.key(s.recordingId, s.kind, s.subject), { ...s });

  campaignName = async (campaignId: string) => this.campaigns.get(campaignId);
  getAiSettings = async () => this.aiSettings;
}
