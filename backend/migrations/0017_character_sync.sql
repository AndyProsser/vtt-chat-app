-- D&D Beyond sync: when a linked character was last refreshed, and the DDB portrait address we last
-- imported (so a portrait the player chose themselves is only replaced when DDB's own changes).
ALTER TABLE characters ADD COLUMN synced_at bigint;
ALTER TABLE characters ADD COLUMN source_avatar text;
