-- Uploaded files (handouts now, soundboard clips later) and the handouts that use them.
-- File bytes live on the media volume under the file's id; this table is the metadata and the only
-- thing that decides who may read a file.
CREATE TABLE media_files (
  id             UUID PRIMARY KEY,
  owner_id       UUID   REFERENCES users (id) ON DELETE SET NULL,
  kind           TEXT   NOT NULL CHECK (kind IN ('image', 'pdf', 'audio')),
  mime           TEXT   NOT NULL,
  bytes          BIGINT NOT NULL CHECK (bytes > 0),
  sha256         TEXT   NOT NULL,
  original_name  TEXT   NOT NULL,
  created_at     BIGINT NOT NULL
);

CREATE TABLE handouts (
  id           UUID PRIMARY KEY,
  campaign_id  UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  title        TEXT   NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind         TEXT   NOT NULL CHECK (kind IN ('image', 'map', 'pdf', 'text')),
  body         TEXT   CHECK (body IS NULL OR char_length(body) <= 20000),
  media_id     UUID   REFERENCES media_files (id),
  -- dm: a draft only the DM sees · all: every member · some: the members in handout_recipients
  visibility   TEXT   NOT NULL DEFAULT 'dm' CHECK (visibility IN ('dm', 'all', 'some')),
  created_by   UUID   REFERENCES users (id) ON DELETE SET NULL,
  created_at   BIGINT NOT NULL,
  CHECK ((kind = 'text' AND body IS NOT NULL AND media_id IS NULL)
      OR (kind <> 'text' AND media_id IS NOT NULL AND body IS NULL))
);
CREATE INDEX handouts_campaign_idx ON handouts (campaign_id, created_at);

CREATE TABLE handout_recipients (
  handout_id  UUID NOT NULL REFERENCES handouts (id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (handout_id, user_id)
);
