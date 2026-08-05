# ddb

DDB auth and extraction module — see [CLAUDE.md §8.5](../CLAUDE.md) and [docs/architecture/DDB-AUTH.md](../docs/architecture/DDB-AUTH.md).

**Status:** scaffold only — not yet implemented.

## Responsibilities

- Cobalt cookie detection helpers
- `POST /v1/cobalt-token` exchange (cobalt cookie → DDB JWT)
- JWT parsing
- DDB Character Service API calls (character list, selected character, campaign metadata, DM role)
- DOM extraction helpers for data not available via API (current map, live token conditions)
- TypeScript types for everything above, re-exported for use by `overlay-ui/` and `backend/`

## Consumers

- `tauri-client/overlay-ui/` — runs the extraction inside the DDB WebView
- `backend/` — verifies the identity handed off from the client and caches character/campaign data

## Non-Goals

No bulk scraping, no caching of DDB content beyond what's needed for the active session, no modification of DDB data. See [CLAUDE.md §14, §16](../CLAUDE.md) and the Third-Party IP Notice in [README.md](../README.md).
