-- The session bookmarks: when a recording started, paused, resumed and stopped. A campaign is one
-- continuous history; these events (not a separate "session" object) are the anchors for summaries
-- (RECORDING-AND-SUMMARIES.md, decided 2026-11-05).
CREATE TABLE recording_events (
  id            BIGSERIAL PRIMARY KEY,
  recording_id  UUID   NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  at            BIGINT NOT NULL,
  event         TEXT   NOT NULL CHECK (event IN ('started', 'paused', 'resumed', 'stopped', 'interrupted'))
);
CREATE INDEX recording_events_recording_idx ON recording_events (recording_id, at, id);
