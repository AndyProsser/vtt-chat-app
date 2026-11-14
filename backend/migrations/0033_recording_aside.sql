-- A private aside (the DM speaks to one player, only they hear) is noted in the recording's timeline as 'aside'. Its audio
-- is never recorded: the two people's tracks are not captured while it runs. Metadata only.
ALTER TABLE recording_events DROP CONSTRAINT recording_events_event_check;
ALTER TABLE recording_events
  ADD CONSTRAINT recording_events_event_check
    CHECK (event IN ('started', 'paused', 'resumed', 'stopped', 'interrupted', 'sound', 'scene', 'chat', 'voice', 'group', 'aside'));
