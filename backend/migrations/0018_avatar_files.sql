-- Which stored pictures are portraits someone uploaded, and when, so ones nobody uses any more can be
-- swept up. Pictures uploaded before this table existed have no row and are never swept.
CREATE TABLE avatar_files (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at bigint NOT NULL
);
