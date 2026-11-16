-- The server's shared starter catalogue: sounds, boards and scenes with no owner (owner_id NULL) that every
-- DM can use but nobody can edit or delete from the app. They are written at start-up from the pack that
-- ships with the server (backend/assets/sounds), so a server update can add to them.
ALTER TABLE sounds      ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE soundboards ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE scenes      ALTER COLUMN owner_id DROP NOT NULL;
