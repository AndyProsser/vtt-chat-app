-- Loot the DM drops at the table. Dropping reveals it to every member; the first player to claim an
-- item gets it, exactly once (the claim is a single conditional UPDATE), and who/when is kept.
CREATE TABLE loot_items (
  id           UUID PRIMARY KEY,
  campaign_id  UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  name         TEXT   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description  TEXT   NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100000),
  dropped_by   UUID   REFERENCES users (id) ON DELETE SET NULL,
  dropped_at   BIGINT NOT NULL,
  claimed_by   UUID   REFERENCES users (id) ON DELETE SET NULL,
  claimed_at   BIGINT,
  CHECK ((claimed_at IS NULL) = (claimed_by IS NULL) OR claimed_by IS NULL)
);
CREATE INDEX loot_items_campaign_idx ON loot_items (campaign_id, dropped_at);
