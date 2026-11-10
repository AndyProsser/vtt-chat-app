-- A picture handout is a set of up to twelve pictures, shown in order; a PDF handout is a single file.
-- Captions are the handout's body for any kind, so the old "body only for text" rule goes.
ALTER TABLE handouts DROP CONSTRAINT handouts_check;
ALTER TABLE handouts ADD CONSTRAINT handouts_text_needs_body CHECK (kind <> 'text' OR body IS NOT NULL);

CREATE TABLE handout_files (
  handout_id  UUID NOT NULL REFERENCES handouts (id) ON DELETE CASCADE,
  position    INT  NOT NULL CHECK (position BETWEEN 0 AND 11),
  media_id    UUID NOT NULL REFERENCES media_files (id),
  PRIMARY KEY (handout_id, position)
);

INSERT INTO handout_files (handout_id, position, media_id)
  SELECT id, 0, media_id FROM handouts WHERE media_id IS NOT NULL;
ALTER TABLE handouts DROP COLUMN media_id;
