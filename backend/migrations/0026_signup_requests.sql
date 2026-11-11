-- Visitor sign-up requests (docs/architecture/SIGN-IN-OPTIONS.md). Off by default: the operator turns
-- the setting on, then approves or rejects each request in the Admin CLI (`vtt-admin signup ...`).
-- Approval creates the account; this table only keeps the visitor's ask and the decision.
ALTER TABLE instance_settings
  ADD COLUMN signup_requests TEXT NOT NULL DEFAULT 'off' CHECK (signup_requests IN ('on', 'off'));

CREATE TABLE signup_requests (
  id           UUID PRIMARY KEY,
  email        TEXT   NOT NULL CHECK (email = lower(email)),
  display_name TEXT   NOT NULL,
  message      TEXT   NOT NULL DEFAULT '',
  status       TEXT   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   BIGINT NOT NULL,
  decided_at   BIGINT
);
CREATE INDEX signup_requests_status ON signup_requests (status, created_at);
