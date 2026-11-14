-- The recording's timeline also keeps the table's story cues while it ran: the DM's character-voice
-- changes ('voice') and party splits and merges ('group'), next to the 'scene' and 'sound' events it
-- already holds. Metadata only; the summaries read them as cues (RECORDING-AND-SUMMARIES.md).
ALTER TABLE recording_events DROP CONSTRAINT recording_events_event_check;
ALTER TABLE recording_events
  ADD CONSTRAINT recording_events_event_check
    CHECK (event IN ('started', 'paused', 'resumed', 'stopped', 'interrupted', 'sound', 'scene', 'chat', 'voice', 'group'));
