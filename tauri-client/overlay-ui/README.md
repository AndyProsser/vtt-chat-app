# overlay-ui

The React + Radix UI Shadow DOM overlay injected into D&D Beyond's Maps VTT canvas — see [CLAUDE.md §9](../../CLAUDE.md).

**Status:** Stage 3a implemented (manual verification outstanding — see [ROADMAP.md](../../ROADMAP.md#stage-3--overlay-ui-ddb-extraction--chat)). Page-scoped Shadow DOM root — `FullPanel` (Maps VTT: `ConnectionStatus`, `MicrophoneStatus`, `MuteButton`, `ParticipantList` with per-row `SpeakingDot`) or `MicPill` (everywhere else allowed) chosen by `usePageMode()`, all leaf-isolated per [STATE-AND-RESILIENCE.md](../../docs/architecture/STATE-AND-RESILIENCE.md). Built via Vite into a single injectable `dist/overlay.js`, tested via Vitest. Group selector moved to Stage 4; chat and DDB DOM extraction are 3b/3c.

## Responsibilities

- A single injected root `<div>` using a Shadow DOM to avoid CSS collisions with DDB's page
- Left-panel UI: voice controls, group selector, minimal chat, speaking indicators, DM controls (if DM)
- Collapsible via UI button or hotkey; must never intercept pointer events meant for the DDB canvas
- Cobalt cookie / DOM extraction glue that talks to `ddb/` for typed extraction helpers
- REST calls to `backend/` for bookmarks, groups, audio FX
- Tauri IPC calls to `rust-livekit/` (via `src-tauri/`) for voice control

## Tech

React 19 + Radix UI + TypeScript, npm workspace package. Bundled and injected by `src-tauri/` — see [CLAUDE.md §3](../../CLAUDE.md) for why this uses the same stack as `status/` rather than a lighter framework.

## Folder Layout

Per [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md):

```text
src/
├── components/    # VoicePanel, GroupSelector, ChatPanel, DmControls, etc.
├── hooks/
├── consts/
├── types/
├── styles/        # Radix theme tokens scoped to the Shadow DOM root
├── lib/           # DDB extraction glue, backend API client, Tauri IPC client
└── index.ts
```

## Depends On

- `ddb/` — extraction types and helpers
- `shared/` — cross-module contracts (bookmark types, IPC event payloads)
