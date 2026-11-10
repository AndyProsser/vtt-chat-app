-- The recording's timeline also keeps what was typed into the table's public chat while it ran
-- (never a whisper), so the transcript can show typed lines among the spoken ones.
ALTER TABLE recording_events DROP CONSTRAINT recording_events_event_check;
ALTER TABLE recording_events
  ADD CONSTRAINT recording_events_event_check
    CHECK (event IN ('started', 'paused', 'resumed', 'stopped', 'interrupted', 'sound', 'scene', 'chat'));
