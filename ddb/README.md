# ddb

**Optional** D&D Beyond character import. Not part of the default install and not on any critical path — see [CLAUDE.md §8.7](../.claude/CLAUDE.md).

**Status:** built (see [DDB-SYNC.md](../docs/architecture/DDB-SYNC.md)); off unless the operator sets `DDB_SYNC=1`. Not yet run against the live service.

## What it is

A small, pure module: read the id from a public sheet address, fetch the character from the sheet's own public service, and parse name / race / class / level / portrait address. The backend does the syncing (link, sync now, hourly timer). Public sheets only; no login, no cookie.

## What was removed, and why

The previous design authenticated users through D&D Beyond's `CobaltSession` cookie inside an embedded WebView and treated DDB as the identity provider. That coupling is gone: identity is now this app's own (design pending — [CLAUDE.md §11](../.claude/CLAUDE.md)). The old flow is documented in [docs/archive/architecture/DDB-AUTH.md](../docs/archive/architecture/DDB-AUTH.md); its **Character Service endpoints** and the "re-exchange, don't cache" lesson are the useful parts if a token-based import is ever added.

## Non-Goals

No bulk scraping, no caching of DDB content beyond what an import needs, no modification of DDB data, no embedding of DDB pages. See the third-party notice in [README.md](../README.md).
