-- Accounts, sessions, campaigns, membership, characters and invites.
-- Mirrors backend/src/types/index.ts. Timestamps are epoch milliseconds (BIGINT) so the Postgres
-- adapter and the in-memory store agree exactly and tests can drive a fake clock.
--
-- UNTESTED: written without a Postgres instance to run it against (ROADMAP Stage 3). Apply it to
-- a scratch database and fix whatever it finds before relying on it.

BEGIN;

-- One row, id fixed at 1: the Admin and the CLI edit these.
CREATE TABLE instance_settings (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  campaign_creation   TEXT     NOT NULL DEFAULT 'closed' CHECK (campaign_creation IN ('closed', 'open')),
  offline_limit_days  INTEGER  NOT NULL DEFAULT 30 CHECK (offline_limit_days > 0),
  invite_expiry_days  INTEGER  NOT NULL DEFAULT 7  CHECK (invite_expiry_days > 0),
  consent_version     TEXT     NOT NULL DEFAULT '1'
);
INSERT INTO instance_settings (id) VALUES (1);

CREATE TABLE users (
  id               UUID PRIMARY KEY,
  email            TEXT   NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name     TEXT   NOT NULL,
  password_hash    TEXT,                       -- NULL: signs in by magic link / OIDC only
  is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version  TEXT   NOT NULL,            -- the "you may be recorded" text accepted
  consent_at       BIGINT NOT NULL,
  created_at       BIGINT NOT NULL
);

-- Long-lived, remotely revocable. Only a hash of the secret is stored.
CREATE TABLE sessions (
  id            UUID PRIMARY KEY,
  user_id       UUID   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    TEXT   NOT NULL,
  device_label  TEXT,
  created_at    BIGINT NOT NULL,
  last_seen_at  BIGINT NOT NULL,               -- updated by the client's periodic ping
  revoked_at    BIGINT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE magic_links (
  id          UUID PRIMARY KEY,
  email       TEXT   NOT NULL,
  purpose     TEXT   NOT NULL CHECK (purpose IN ('signin', 'reset')),
  token_hash  TEXT   NOT NULL UNIQUE,
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  used_at     BIGINT
);

CREATE TABLE campaigns (
  id          UUID PRIMARY KEY,
  name        TEXT   NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE TABLE characters (
  id           UUID PRIMARY KEY,
  user_id      UUID   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  campaign_id  UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  name         TEXT   NOT NULL,
  class_name   TEXT,
  race         TEXT,
  level        INTEGER,
  avatar_url   TEXT,
  source_url   TEXT                            -- public D&D Beyond URL, if imported
);
CREATE INDEX characters_campaign_user_idx ON characters (campaign_id, user_id);

-- Roles are per campaign. active/suspended character: see types (a DM's character is parked, not lost).
CREATE TABLE memberships (
  campaign_id             UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  user_id                 UUID   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role                    TEXT   NOT NULL CHECK (role IN ('dm', 'player')),
  active_character_id     UUID   REFERENCES characters (id) ON DELETE SET NULL,
  suspended_character_id  UUID   REFERENCES characters (id) ON DELETE SET NULL,
  joined_at               BIGINT NOT NULL,
  PRIMARY KEY (campaign_id, user_id),
  -- A DM never has an active character; a player never has a parked one.
  CHECK (role = 'player' OR active_character_id IS NULL),
  CHECK (role = 'dm' OR suspended_character_id IS NULL)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- Exactly one DM per campaign. A partial unique index can't be deferred, so a DM swap must demote
-- the old DM *before* promoting the new one inside its transaction (CampaignService.swapDm does).
CREATE UNIQUE INDEX one_dm_per_campaign ON memberships (campaign_id) WHERE role = 'dm';

-- One code for the whole group: multi-use, expiring. Only a hash of the code is stored.
CREATE TABLE invites (
  id           UUID PRIMARY KEY,
  campaign_id  UUID   NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  code_hash    TEXT   NOT NULL UNIQUE,
  created_by   UUID   NOT NULL REFERENCES users (id),
  created_at   BIGINT NOT NULL,
  expires_at   BIGINT NOT NULL,
  uses         INTEGER NOT NULL DEFAULT 0,
  revoked_at   BIGINT
);

COMMIT;
