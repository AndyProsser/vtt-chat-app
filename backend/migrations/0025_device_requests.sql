-- A desktop app shows a code; a signed-in browser approves it (APP-SIGN-IN.md).
-- Only hashes are stored: the user code and the poll secret never sit in the database in the clear.
CREATE TABLE IF NOT EXISTS device_requests (
  id               UUID PRIMARY KEY,
  user_code_hash   TEXT   NOT NULL UNIQUE,
  poll_secret_hash TEXT   NOT NULL,
  device_label     TEXT,
  request_ip       TEXT,
  created_at       BIGINT NOT NULL,
  expires_at       BIGINT NOT NULL,
  approved_user_id UUID REFERENCES users (id) ON DELETE CASCADE,
  delivered_at     BIGINT
);
