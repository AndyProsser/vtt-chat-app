-- What a job used of Claude (Stage 12 CL): the model, the tokens in and out, and the number of calls, summed over every
-- attempt. Null for a job that ran locally. `vtt-admin jobs list` shows it with an estimated cost.
ALTER TABLE jobs ADD COLUMN usage JSONB;
