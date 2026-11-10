-- D&D Beyond sync: the at-a-glance numbers (ability scores, max HP, AC, passive perception) worked out
-- from the sheet. Null until a linked character is synced.
ALTER TABLE characters ADD COLUMN sheet jsonb;
