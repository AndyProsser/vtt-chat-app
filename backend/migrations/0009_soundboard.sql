-- The DM's own sound library: sounds (each with one or more takes, so a button doesn't repeat the same
-- recording), boards of buttons, and scenes of looping/random layers — a small version of
-- thaumaturgy.app. The library belongs to the account that owns it and is usable in any campaign that
-- account is DM of. Clip bytes are media files (kind = audio); boards and scenes keep their small
-- ordered children as JSON, validated by the service.
CREATE TABLE sounds (
  id          UUID PRIMARY KEY,
  owner_id    UUID   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  category    TEXT   NOT NULL CHECK (category IN ('effect', 'ambience', 'music')),
  tags        TEXT[] NOT NULL DEFAULT '{}',
  created_at  BIGINT NOT NULL
);
CREATE INDEX sounds_owner_idx ON sounds (owner_id, created_at);

CREATE TABLE sound_takes (
  id        UUID PRIMARY KEY,
  sound_id  UUID    NOT NULL REFERENCES sounds (id) ON DELETE CASCADE,
  media_id  UUID    NOT NULL REFERENCES media_files (id),
  level     REAL    NOT NULL DEFAULT 1 CHECK (level BETWEEN 0 AND 1),
  position  INTEGER NOT NULL
);
CREATE INDEX sound_takes_sound_idx ON sound_takes (sound_id, position);

CREATE TABLE soundboards (
  id          UUID PRIMARY KEY,
  owner_id    UUID   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  buttons     JSONB  NOT NULL DEFAULT '[]'::jsonb,
  created_at  BIGINT NOT NULL
);

CREATE TABLE scenes (
  id          UUID PRIMARY KEY,
  owner_id    UUID   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT   NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  layers      JSONB  NOT NULL DEFAULT '[]'::jsonb,
  created_at  BIGINT NOT NULL
);
