-- The campaign's storyteller: which of the five preset bards tells each session's tale (ROADMAP Stage 11, item 4).
-- Stored and shown from 0.6.0; the AI work (Stage 12) makes it do something. A preset id, never free text.
-- The ids are the same list as BARD_PERSONAS in shared/; an unknown id is refused here and at the API.
ALTER TABLE campaigns
  ADD COLUMN bard TEXT NOT NULL DEFAULT 'tavern'
  CHECK (bard IN ('tavern', 'dry', 'drunken', 'sarcastic', 'bored'));
