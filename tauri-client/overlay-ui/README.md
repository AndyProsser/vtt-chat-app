# overlay-ui — LEGACY (becomes `panels-ui`)

> **This package belongs to the previous design** (a React overlay injected into D&D Beyond Maps via Shadow DOM). It is scheduled to be **replaced by `panels-ui/`** in [ROADMAP Stage 1](../../ROADMAP.md#stage-1--pivot-cleanup). Do not add features to the overlay.

**What `panels-ui/` keeps from here:** the Vite + Vitest scaffolding, the Radix Themes + Zustand setup, the leaf-isolated store pattern (`speakingStore`, `microphoneStore`, `useIsSpeaking`, …), the churn-diagnostics tooling, and the `avatarColor` helper. See [STATE-AND-RESILIENCE.md](../../docs/architecture/STATE-AND-RESILIENCE.md).

**What goes:** the Shadow DOM mount and portal-container plumbing, the injected single-file `overlay.js` build, `CompactPanel` / `ExpandedPanel` / `OverlayCornerMenu` and the corner/expand stores, `backendClient` as written (it talks the DDB-identity session contract), and every `pointer-events` workaround that existed to keep a panel from eating clicks meant for DDB's canvas.

## What `panels-ui/` will be

React 19 + Radix UI + Zustand panels, served as **local pages** by the Tauri app (no injection, no Shadow DOM, no remote content):

- Connection / roster / mute / channel switcher
- Chat and whispers, handouts, loot drops
- History and AI summaries
- RSVP / upcoming sessions
- DM soundboard, party split, recording control (DM only)

Pure UI: it talks to the Rust core over Tauri IPC, and the core owns the audio and the server connection. A panel hydrates from a snapshot every time it opens and does nothing while hidden.

## Folder Layout

Per [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md):

```text
src/
├── components/
├── hooks/
├── consts/
├── types/
├── styles/        # Radix theme tokens; light/dark follows the OS
├── lib/           # stores, Tauri IPC client, API client
└── index.ts
```

## Depends On

- `shared/` — cross-module contracts (campaign/channel/message shapes, recording state, IPC payloads)
