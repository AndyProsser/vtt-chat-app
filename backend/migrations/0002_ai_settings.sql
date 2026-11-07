-- Where transcription and summarisation run (local, or a remote OpenAI-compatible server) and the
-- fallback policy. JSONB so adding a setting later is not a migration; the application fills in
-- defaults for anything missing (shared/src/lib/aiSettings.ts, normaliseAiSettings).
-- API keys are deliberately NOT stored here; they come from the environment.
ALTER TABLE instance_settings ADD COLUMN ai JSONB NOT NULL DEFAULT '{}'::jsonb;
