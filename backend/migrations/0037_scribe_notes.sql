-- The scribe's notes of a recording, kept for the Game Master (decided 2026-11-17): players read the tale,
-- the Game Master also reads the plain record it was told from. One row per recording, kind `notes`,
-- never visible to players.
ALTER TABLE summaries DROP CONSTRAINT summaries_kind_check;
ALTER TABLE summaries
  ADD CONSTRAINT summaries_kind_check
  CHECK (kind IN ('session', 'dm-only', 'character', 'chapter', 'notes'));
ALTER TABLE summaries
  ADD CONSTRAINT summaries_notes_dm_only CHECK (kind <> 'notes' OR visibility = 'dm');
