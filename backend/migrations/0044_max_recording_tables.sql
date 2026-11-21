-- How many tables may be recording at once (an operator setting, `vtt-admin settings set recording.max-tables`).
-- Default 2: the server was built for one table at a time and handles two comfortably; 0 means no limit. It only
-- refuses the START of a recording past the limit; chat, voice and the records pipeline are unaffected.
ALTER TABLE instance_settings
  ADD COLUMN max_recording_tables INTEGER NOT NULL DEFAULT 2 CHECK (max_recording_tables >= 0);
