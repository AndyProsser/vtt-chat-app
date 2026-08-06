# ddb

DDB auth and extraction module — see [CLAUDE.md §8.5](../CLAUDE.md) and [docs/architecture/DDB-AUTH.md](../docs/architecture/DDB-AUTH.md).

**Status:** Stage 1 subset implemented — cobalt-token exchange, Character Service calls, and the identity-extraction orchestrator. DOM extraction (current map, token conditions) is Stage 3.

## Responsibilities

- Cobalt cookie detection helpers
- `POST /v1/cobalt-token` exchange (cobalt cookie → DDB JWT)
- JWT parsing
- DDB Character Service API calls (character list, selected character, campaign metadata, DM role)
- DOM extraction helpers for data not available via API (current map, live token conditions)
- TypeScript types for everything above, re-exported for use by `overlay-ui/` and `backend/`

## Consumers

- `tauri-client/overlay-ui/` — runs the full extraction inside the DDB WebView, then hands the normalized `DdbIdentity` to `backend/` over REST (`backend/` does not import `ddb/` — see [docs/architecture/DDB-AUTH.md](../docs/architecture/DDB-AUTH.md))

## Non-Goals

No bulk scraping, no caching of DDB content beyond what's needed for the active session, no modification of DDB data. See [CLAUDE.md §14, §16](../CLAUDE.md) and the Third-Party IP Notice in [README.md](../README.md).
