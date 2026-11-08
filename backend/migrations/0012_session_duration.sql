-- How long a scheduled session is expected to run, so the app can show when it should finish.
ALTER TABLE scheduled_sessions
  ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 180
    CHECK (duration_minutes BETWEEN 15 AND 720);
