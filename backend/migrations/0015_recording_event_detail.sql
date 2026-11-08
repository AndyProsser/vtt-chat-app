-- The recording timeline also notes which sound effects and scenes the DM played (never their audio):
-- two more event kinds and a free-form `detail` (sound id, take, scene name…).
ALTER TABLE recording_events DROP CONSTRAINT recording_events_event_check;
ALTER TABLE recording_events
  ADD CONSTRAINT recording_events_event_check
    CHECK (event IN ('started', 'paused', 'resumed', 'stopped', 'interrupted', 'sound', 'scene')),
  ADD COLUMN detail JSONB;
