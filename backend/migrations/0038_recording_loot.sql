-- Loot moving on the table (dropped, given, taken, stored, returned, split, removed) is noted in the recording's
-- timeline as 'loot', so the summaries can say who got what. Names only. ROADMAP Stage 10, part 6.
ALTER TABLE recording_events DROP CONSTRAINT recording_events_event_check;
ALTER TABLE recording_events
  ADD CONSTRAINT recording_events_event_check
    CHECK (event IN ('started', 'paused', 'resumed', 'stopped', 'interrupted', 'sound', 'scene', 'chat', 'voice', 'group', 'aside', 'loot'));
