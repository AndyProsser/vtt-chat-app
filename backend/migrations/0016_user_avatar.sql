-- A person's own portrait (an uploaded picture or a built-in emblem), shown for the DM and for anyone
-- who has no character portrait. Same value formats as a character's avatar.
ALTER TABLE users ADD COLUMN avatar_url text;
