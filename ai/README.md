# ai

The **records pipeline**: transcode → transcribe → diarize-by-track → summarise. **Core**, not optional — see [CLAUDE.md §8.4](../.claude/CLAUDE.md) and [docs/architecture/RECORDING-AND-SUMMARIES.md](../docs/architecture/RECORDING-AND-SUMMARIES.md).

**Status:** scaffold only — not yet implemented. De-risked first by a throwaway smoke test in [ROADMAP Stage 2 Part B](../ROADMAP.md#stage-2--audio--records-spike); built for real in Stage 5.

## Responsibilities

- Consume per-speaker recordings that **LiveKit Egress** wrote to local storage
- **Transcode** with ffmpeg (16 kHz mono for Whisper; compact archival copy)
- **Transcribe** each track with **Whisper.cpp** (local, default); merge by timestamp so speaker = track owner
- **Summarise** with a local LLM via **Ollama** (default): session, chapter, character-specific and DM-only summaries; map-reduce for long sessions
- Run as a retryable job queue (Postgres/Redis): a failed stage keeps earlier output and can be re-run from the Admin CLI without re-recording
- Expose reprocess / backup / restore / delete hooks to the Admin CLI (via `backend/`, not directly)

## Providers are an interface

Transcription and summarisation sit behind provider interfaces. The default implementations (`whisper-cpp`, `ollama`) are local. Cloud providers (OpenAI Whisper, a cloud LLM, Workers AI) are **optional adapters** that an operator must enable explicitly; the UI must say when session content is configured to leave the server. The default path must work with all of them absent.

## Hard rules

- Private/whisper audio is excluded from recording at the routing layer; this module must never be handed it, and must refuse to produce a shared artifact from anything flagged private.
- DM-only summaries carry that flag all the way to the API.

## Depends On

- `shared/` — recording, transcript and summary types
- `backend/` — job dispatch and storage of transcripts/summaries in Postgres
- External native binaries: ffmpeg, Whisper.cpp, Ollama

## Non-Goals

No cloud calls unless the operator opted in. No live (during-session) summaries until measured CPU headroom justifies them.
