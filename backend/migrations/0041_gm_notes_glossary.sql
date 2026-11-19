-- Stage 11 items 5 and 6: the Game Master's notes (one Markdown page per campaign, with picture and PDF
-- attachments) and the campaign glossary (names, places, items, spells and their aliases).
-- Both are the Game Master's alone at the API. The attachments are ordinary media files (the same store as
-- handouts); the sweeper must not treat them as unused, so it also checks gm_note_files.
CREATE TABLE gm_notes (
  campaign_id  UUID PRIMARY KEY REFERENCES campaigns (id) ON DELETE CASCADE,
  body         TEXT   NOT NULL DEFAULT '',
  updated_at   BIGINT NOT NULL,
  updated_by   UUID   REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE gm_note_files (
  id           UUID PRIMARY KEY,
  campaign_id  UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  media_id     UUID   NOT NULL REFERENCES media_files (id),
  name         TEXT   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  created_at   BIGINT NOT NULL
);
CREATE INDEX gm_note_files_campaign_idx ON gm_note_files (campaign_id, created_at);

-- `suggested` terms wait for the Game Master's approval; nothing fills them until Stage 12's vocabulary learning.
CREATE TABLE glossary_terms (
  id           UUID PRIMARY KEY,
  campaign_id  UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  term         TEXT   NOT NULL CHECK (char_length(term) BETWEEN 1 AND 100),
  kind         TEXT   NOT NULL DEFAULT 'other' CHECK (kind IN ('person', 'place', 'item', 'spell', 'other')),
  aliases      JSONB  NOT NULL DEFAULT '[]'::jsonb,
  status       TEXT   NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'suggested')),
  created_at   BIGINT NOT NULL
);
CREATE UNIQUE INDEX glossary_terms_unique ON glossary_terms (campaign_id, lower(term));
