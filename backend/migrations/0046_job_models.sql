-- Which models a processing job used (the transcriber, the scribe and the bard, and whether a remote one was unreachable
-- so the local one did the work), so a tale's quality can be traced to the model that wrote it. `vtt-admin jobs list`
-- and `status` show it. Null for a job that has not run, or one that uses no AI.
ALTER TABLE jobs ADD COLUMN models JSONB;
