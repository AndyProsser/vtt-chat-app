-- A chapter's scribe's notes, cached only so a job that dies partway through a long, many-chapter
-- recording (0.6.5 interim reliability fix, Andy 2026-11-27: a real session kept failing on a flaky
-- remote GPU server, redoing every already-finished chapter from scratch on every retry) resumes from
-- the chapter it reached instead of chapter one every time. Separate from `summaries` on purpose: a
-- half-finished chapter's notes must never be visible through the records API, where only the
-- complete, combined copy (`summaries`, kind `notes`, subject '') is read by anyone. Cascades with the
-- recording: this is scratch, not a record worth keeping once the recording itself is gone.
CREATE TABLE chapter_notes_cache (
  recording_id  UUID   NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  subject       TEXT   NOT NULL,
  text          TEXT   NOT NULL,
  created_at    BIGINT NOT NULL,
  PRIMARY KEY (recording_id, subject)
);
