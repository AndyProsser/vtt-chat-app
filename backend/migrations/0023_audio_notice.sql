-- When the DM was warned that a recording's raw audio will be deleted to free disk space (once).
ALTER TABLE recordings ADD COLUMN audio_notice_at BIGINT;
