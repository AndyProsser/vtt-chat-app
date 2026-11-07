/** One recognised phrase from Whisper, in milliseconds from the start of its own audio track. */
export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Speaker {
  /** Stable account/participant id — the LiveKit identity that owned the track. */
  id: string;
  /** Name to show in transcripts: the active character's name, or the player's display name. */
  name: string;
}

/**
 * Everything one speaker said, from one per-speaker track. Because tracks are per speaker,
 * "who said it" is known without diarisation (RECORDING-AND-SUMMARIES.md).
 */
export interface TrackTranscript {
  speaker: Speaker;
  /** When this track began, relative to the start of the recording. Egress tracks start late if the player joined late. */
  startOffsetMs: number;
  /** True for whispers / private-channel audio. These must never reach a shared artifact. */
  private?: boolean;
  segments: Segment[];
}

/** A merged, speaker-attributed line on the shared timeline. */
export interface Utterance {
  speaker: Speaker;
  startMs: number;
  endMs: number;
  text: string;
}

export type SummaryKind = 'session' | 'dm-only' | 'character';

export interface SummaryContext {
  campaignName?: string;
  /** Required when `kind` is `character`. */
  characterName?: string;
}

/** Sends a prompt to a language model and returns its text. Local (Ollama) by default. */
export type GenerateText = (prompt: string) => Promise<string>;

/**
 * Transcribes one short WAV (a speech window) and returns segments with times relative to the
 * start of that file. Local whisper.cpp and any OpenAI-compatible server both fit this shape.
 */
export type TranscribeWav = (wavPath: string) => Promise<Segment[]>;
