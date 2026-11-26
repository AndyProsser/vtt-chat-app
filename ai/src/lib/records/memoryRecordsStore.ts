import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_BARD,
  type AiSettings,
  type BardId,
} from '@vtt-chat-app/shared';

import type { LlmUsage } from '../../consts/claude.js';
import type { MemoryEntry } from '../memory.js';
import type { VocabularyTerm } from '../vocabulary.js';

import type {
  Recording,
  RecordingEvent,
  RecordingStatus,
  RecordingTrack,
  SearchHit,
  Segment,
  StoredSummary,
  TrackTranscript,
  JobModels,
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
    options: { includeDmOnly: boolean; includeTranscript: boolean; limit: number },
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
        if (!options.includeTranscript || t.recordingId !== r.id || t.private) continue;
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
        if (!options.includeTranscript || e.recordingId !== r.id || e.event !== 'chat' || !d)
          continue;
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

  bards = new Map<string, BardId>();
  notesOf = new Map<string, string>();
  campaignBard = async (campaignId: string): Promise<BardId> =>
    this.bards.get(campaignId) ?? DEFAULT_BARD;
  gmNotes = async (campaignId: string) => this.notesOf.get(campaignId) ?? '';
  memory = new Map<string, MemoryEntry[]>();
  appliedMemory = new Set<string>();
  listMemory = async (campaignId: string) =>
    (this.memory.get(campaignId) ?? []).map((e) => ({ ...e }));
  forgetMemory = async (campaignId: string, name: string): Promise<number> => {
    const key = name.trim().toLowerCase();
    const all = this.memory.get(campaignId) ?? [];
    const kept = all.filter(
      (e) => ![e.name, ...e.aliases].some((n) => n.trim().toLowerCase() === key),
    );
    this.memory.set(campaignId, kept);
    return all.length - kept.length;
  };
  memoryApplied = async (recordingId: string) => this.appliedMemory.has(recordingId);
  saveMemory = async (
    campaignId: string,
    recordingId: string,
    entries: readonly MemoryEntry[],
    _now: number,
  ): Promise<boolean> => {
    if (this.appliedMemory.has(recordingId)) return false;
    const all = new Map((this.memory.get(campaignId) ?? []).map((e) => [e.id, e]));
    for (const e of entries) all.set(e.id, { ...e });
    this.memory.set(campaignId, [...all.values()]);
    this.appliedMemory.add(recordingId);
    return true;
  };
  /** Which models each job used (test-facing). */
  jobModels = new Map<string, JobModels>();
  setJobModels = async (jobId: string, models: JobModels): Promise<void> => {
    this.jobModels.set(jobId, models);
  };
  /** What each job used of Claude (test-facing). */
  jobUsage = new Map<string, LlmUsage>();
  addJobUsage = async (jobId: string, usage: LlmUsage): Promise<void> => {
    const before = this.jobUsage.get(jobId);
    this.jobUsage.set(jobId, {
      model: usage.model,
      inputTokens: (before?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (before?.outputTokens ?? 0) + usage.outputTokens,
      calls: (before?.calls ?? 0) + usage.calls,
      ...(usage.costUsd !== undefined || before?.costUsd !== undefined
        ? { costUsd: (before?.costUsd ?? 0) + (usage.costUsd ?? 0) }
        : {}),
    });
  };
  vocabulary = new Map<string, VocabularyTerm[]>();
  campaignVocabulary = async (campaignId: string) => this.vocabulary.get(campaignId) ?? [];
  campaignName = async (campaignId: string) => this.campaigns.get(campaignId);
  /** Players per campaign (everyone but the DM). */
  players = new Map<string, string[]>();
  playerIds = async (campaignId: string) => [...(this.players.get(campaignId) ?? [])];
  getAiSettings = async () => this.aiSettings;
  anyRecordingLive = async (now: number) =>
    [...this.recordings.values()].some(
      (r) => r.status === 'recording' && r.stoppedAt === null && r.startedAt > now - 12 * 3_600_000,
    );
  onlineUsers = 0;
  onlineUserCount = async () => this.onlineUsers;
}
