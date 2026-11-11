-- Asking to join a campaign (docs/architecture/CAMPAIGN-JOIN-REQUESTS.md). A signed-in person asks, the
-- campaign's DM approves or declines. `allow_join` is the DM's switch (default on: a fresh instance's first
-- campaign must be findable); `campaign_directory` is the operator's master switch for every listing.
ALTER TABLE campaigns
  ADD COLUMN allow_join BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE instance_settings
  ADD COLUMN campaign_directory TEXT NOT NULL DEFAULT 'on' CHECK (campaign_directory IN ('on', 'off'));

CREATE TABLE join_requests (
  id           UUID PRIMARY KEY,
  campaign_id  UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  user_id      UUID   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  message      TEXT   NOT NULL DEFAULT '',
  status       TEXT   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
  created_at   BIGINT NOT NULL,
  decided_at   BIGINT,
  decided_by   UUID
);
-- One open request per person per campaign; the race between two clicks is settled here.
CREATE UNIQUE INDEX join_requests_one_pending ON join_requests (campaign_id, user_id) WHERE status = 'pending';
CREATE INDEX join_requests_campaign ON join_requests (campaign_id, created_at);
CREATE INDEX join_requests_user ON join_requests (user_id, created_at);
