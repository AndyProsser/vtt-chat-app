-- What the records worker last reported about the local AI: whether the Whisper server answers and whether the
-- summary model is in Ollama, downloading (with a percentage) or failed. The worker writes it; the status page and
-- `vtt-admin status` read it. It replaces the one-shot containers that used to download the models before the stack
-- could start (ROADMAP Stage 9), so a slow or failed download is visible instead of a hung start-up.
-- Shape: { at, llm: { state, percent?, detail? } | null, whisper: { ... } | null } (ai/src/types/localAi.ts).
ALTER TABLE instance_settings ADD COLUMN local_ai JSONB;
