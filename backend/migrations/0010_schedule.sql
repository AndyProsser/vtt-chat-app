-- Scheduled sessions, who can make them, reminders, and the stored notifications that carry all of
-- it (and "summary ready", loot, …) to players, including those whose app was not running.
CREATE TABLE scheduled_sessions (
  id            UUID PRIMARY KEY,
  campaign_id   UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  starts_at     BIGINT NOT NULL,                -- UTC, epoch milliseconds; clients show local time
  title         TEXT   NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes         TEXT   NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_by    UUID   REFERENCES users (id) ON DELETE SET NULL,
  created_at    BIGINT NOT NULL,
  cancelled_at  BIGINT
);
CREATE INDEX scheduled_sessions_campaign_idx ON scheduled_sessions (campaign_id, starts_at);

CREATE TABLE session_rsvps (
  session_id  UUID NOT NULL REFERENCES scheduled_sessions (id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('yes', 'late', 'no')),
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

-- One row per (session, offset) once the reminder has gone out, so a restart cannot send it twice.
CREATE TABLE session_reminders (
  session_id  UUID NOT NULL REFERENCES scheduled_sessions (id) ON DELETE CASCADE,
  offset_min  INTEGER NOT NULL,
  sent_at     BIGINT NOT NULL,
  PRIMARY KEY (session_id, offset_min)
);

CREATE TABLE notifications (
  id            UUID PRIMARY KEY,
  user_id       UUID   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  campaign_id   UUID   REFERENCES campaigns (id) ON DELETE CASCADE,
  kind          TEXT   NOT NULL,
  title         TEXT   NOT NULL,
  body          TEXT   NOT NULL DEFAULT '',
  data          JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at    BIGINT NOT NULL,
  read_at       BIGINT,
  pushed_at     BIGINT                              -- set once it has been sent to a live socket
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at);
CREATE INDEX notifications_unpushed_idx ON notifications (created_at) WHERE pushed_at IS NULL;
