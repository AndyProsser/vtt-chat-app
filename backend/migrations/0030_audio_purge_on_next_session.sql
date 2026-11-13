-- Optional retention rule: when a recording starts, purge the raw audio of that campaign's earlier,
-- fully processed recordings (the text stays). Off by default; `vtt-admin settings set
-- audio-purge-next-session on` turns it on.
ALTER TABLE instance_settings
  ADD COLUMN audio_purge_on_next_session TEXT NOT NULL DEFAULT 'off'
    CHECK (audio_purge_on_next_session IN ('on', 'off'));
