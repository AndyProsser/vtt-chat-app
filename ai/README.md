# ai

Recording, transcription, and AI summary plugin — see [CLAUDE.md §8.6](../CLAUDE.md). Optional at runtime; off by default.

**Status:** scaffold only — not yet implemented.

## Responsibilities

- **Recording** — LiveKit server-side recording, or client-side recording uploaded to `backend/`
- **Transcription** — local (Whisper.cpp) or cloud (OpenAI Whisper API); transcripts stored in Postgres via `backend/`
- **AI summaries** — local (Ollama) or cloud (OpenAI/Claude); generates session, chapter, character-specific, and DM-only summaries, anchored to DM bookmarks (see [CLAUDE.md §10](../CLAUDE.md))
- Backup/restore/delete hooks for recordings, transcripts, and summaries, exposed to the Admin CLI (via `backend/`, not directly)

## Depends On

- `shared/` — bookmark and summary types
- `backend/` — job dispatch, storage of transcripts/summaries in Postgres

## Non-Goals

Does not run unless explicitly enabled. Does not send session content to a cloud provider unless the user has opted in — see [CLAUDE.md §8.6](../CLAUDE.md).
