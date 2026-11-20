-- Campaign memory (ROADMAP Stage 12 F): what a campaign has already met, kept by the server between sessions so the
-- tale and the Chronicler can say "the party has met this person before". The records worker writes it after each
-- session from the scribe's notes; nothing here is Game Master-only or private (it comes from what was said and typed
-- at the table, never from whispers or private audio). It is read through `vtt-admin memory`; no app screen yet.
-- Deliberately no foreign key to recordings: deleting a session must not silently unlearn the campaign.
CREATE TABLE campaign_memory (
  id                  UUID PRIMARY KEY,
  campaign_id         UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  kind                TEXT   NOT NULL CHECK (kind IN ('npc', 'creature', 'location', 'faction', 'quest', 'item')),
  name                TEXT   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  aliases             JSONB  NOT NULL DEFAULT '[]'::jsonb,
  gist                TEXT   NOT NULL CHECK (char_length(gist) BETWEEN 1 AND 400),
  first_recording_id  UUID,
  first_seen          BIGINT NOT NULL,
  last_seen           BIGINT NOT NULL,
  times_seen          INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX campaign_memory_name_unique ON campaign_memory (campaign_id, lower(name));

-- Which recordings have already taught the memory, so a job that runs again (a retry, a reprocess) does not count a
-- session twice. Also without a foreign key: the marker outlives the recording on purpose.
CREATE TABLE campaign_memory_applied (
  recording_id  UUID PRIMARY KEY,
  campaign_id   UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  applied_at    BIGINT NOT NULL
);
