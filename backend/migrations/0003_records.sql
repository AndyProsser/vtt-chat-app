-- Recordings, their per-speaker tracks, transcripts, summaries and the job queue that produces them.
-- Owned by the schema (this directory) but used by the `ai/` worker; see
-- docs/architecture/RECORDING-AND-SUMMARIES.md. Timestamps are epoch milliseconds, like the rest.

CREATE TABLE recordings (
  id           UUID PRIMARY KEY,
  campaign_id  UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  started_at   BIGINT NOT NULL,
  stopped_at   BIGINT,
  -- recording: still capturing · stopped: audio is in, not yet processed · processing: a job has it
  -- processed: transcript and summaries exist · failed: the job ran out of attempts (retry from the CLI)
  status       TEXT   NOT NULL DEFAULT 'recording'
               CHECK (status IN ('recording', 'stopped', 'processing', 'processed', 'failed'))
);
CREATE INDEX recordings_campaign_idx ON recordings (campaign_id, started_at);

CREATE TABLE recording_tracks (
  id              UUID PRIMARY KEY,
  recording_id    UUID   NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  speaker_id      TEXT   NOT NULL,           -- the LiveKit identity: the account id of whoever spoke
  speaker_name    TEXT   NOT NULL,           -- what the transcript shows (character or display name)
  file_path       TEXT   NOT NULL,
  start_offset_ms BIGINT NOT NULL DEFAULT 0, -- when this track began, relative to the recording start
  -- Whispers and private-channel audio. A private track is never transcribed or summarised.
  private         BOOLEAN NOT NULL DEFAULT FALSE,
  transcribed_at  BIGINT
);
CREATE INDEX recording_tracks_recording_idx ON recording_tracks (recording_id);

CREATE TABLE transcript_segments (
  track_id  UUID    NOT NULL REFERENCES recording_tracks (id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  start_ms  BIGINT  NOT NULL,                -- relative to the track's own audio
  end_ms    BIGINT  NOT NULL,
  text      TEXT    NOT NULL,
  PRIMARY KEY (track_id, seq)
);

-- Defence in depth for the hard privacy rule: even a bug in the worker cannot store a transcript
-- of a private track.
CREATE FUNCTION forbid_private_transcripts() RETURNS trigger AS $$
BEGIN
  IF (SELECT private FROM recording_tracks WHERE id = NEW.track_id) THEN
    RAISE EXCEPTION 'track % is private and must never be transcribed', NEW.track_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transcript_segments_not_private
  BEFORE INSERT ON transcript_segments
  FOR EACH ROW EXECUTE FUNCTION forbid_private_transcripts();

CREATE TABLE summaries (
  id            UUID PRIMARY KEY,
  recording_id  UUID   NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  kind          TEXT   NOT NULL CHECK (kind IN ('session', 'dm-only', 'character')),
  subject       TEXT   NOT NULL DEFAULT '',  -- the character, for kind = character
  -- Who may read it, enforced by the API (not the UI): campaign members, or the DM only.
  visibility    TEXT   NOT NULL CHECK (visibility IN ('members', 'dm')),
  text          TEXT   NOT NULL,
  model_calls   INTEGER NOT NULL DEFAULT 0,
  created_at    BIGINT NOT NULL,
  UNIQUE (recording_id, kind, subject),
  CHECK (kind <> 'dm-only' OR visibility = 'dm')
);

CREATE TABLE jobs (
  id            UUID PRIMARY KEY,
  kind          TEXT   NOT NULL,
  recording_id  UUID   REFERENCES recordings (id) ON DELETE CASCADE,
  state         TEXT   NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  run_after     BIGINT NOT NULL,             -- not before this time (retry backoff)
  locked_until  BIGINT,                      -- a running job's lease; expired = the worker died
  last_error    TEXT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX jobs_claim_idx ON jobs (state, run_after);
