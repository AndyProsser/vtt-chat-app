-- Durable chat. A row with a NULL recipient is said to the whole table; a row with a recipient is
-- a whisper, visible to its sender and that recipient only (never to the DM, unless the DM is one
-- of the two). Reads are filtered by viewer inside the store, not by callers.
CREATE TABLE chat_messages (
  id            UUID PRIMARY KEY,
  campaign_id   UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  sender_id     UUID   REFERENCES users (id) ON DELETE SET NULL,
  sender_name   TEXT   NOT NULL,              -- as shown at the time (character or display name)
  recipient_id  UUID   REFERENCES users (id) ON DELETE CASCADE,
  text          TEXT   NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  at            BIGINT NOT NULL,
  CHECK (recipient_id IS NULL OR sender_id IS NOT NULL)
);
CREATE INDEX chat_messages_campaign_idx ON chat_messages (campaign_id, at, id);
CREATE INDEX chat_messages_recipient_idx ON chat_messages (recipient_id, at) WHERE recipient_id IS NOT NULL;
