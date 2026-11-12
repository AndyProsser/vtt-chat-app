-- Chapter summaries: one per stretch of a recording between pauses (the start / pause / resume / stop
-- bookmarks are the session's anchors, RECORDING-AND-SUMMARIES.md). `subject` is the chapter number.
ALTER TABLE summaries DROP CONSTRAINT summaries_kind_check;
ALTER TABLE summaries
  ADD CONSTRAINT summaries_kind_check CHECK (kind IN ('session', 'dm-only', 'character', 'chapter'));
