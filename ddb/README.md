# ddb

**Optional** D&D Beyond character import. Not part of the default install and not on any critical path — see [CLAUDE.md §8.7](../.claude/CLAUDE.md).

**Status:** the previous design's code is still here — cobalt-token exchange, Character Service calls, and an identity-extraction orchestrator, all built for an embedded DDB WebView. **It is legacy** and will be reduced or removed in [ROADMAP Stage 1](../ROADMAP.md#stage-1--pivot-cleanup). The import feature itself is Stage 10.

## What it will be

A small module that, given a **public character URL** (or, if easy, a login token), fetches character name / class / portrait so a player's profile can show it. Public pages only. No login, no cookie access, no scraping beyond that page.

## What was removed, and why

The previous design authenticated users through D&D Beyond's `CobaltSession` cookie inside an embedded WebView and treated DDB as the identity provider. That coupling is gone: identity is now this app's own (design pending — [CLAUDE.md §11](../.claude/CLAUDE.md)). The old flow is documented in [docs/archive/architecture/DDB-AUTH.md](../docs/archive/architecture/DDB-AUTH.md); its **Character Service endpoints** and the "re-exchange, don't cache" lesson are the useful parts if a token-based import is ever added.

## Non-Goals

No bulk scraping, no caching of DDB content beyond what an import needs, no modification of DDB data, no embedding of DDB pages. See the third-party notice in [README.md](../README.md).
