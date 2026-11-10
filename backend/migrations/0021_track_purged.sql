-- When a recording's raw audio file was deleted (retention, or `vtt-admin recording purge`). The
-- transcript and summaries stay; this only records that the audio is gone, so reprocessing knows.
ALTER TABLE recording_tracks ADD COLUMN purged_at BIGINT;
