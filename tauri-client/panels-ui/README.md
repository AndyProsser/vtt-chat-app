# panels-ui

React 19 + Radix UI + Zustand panels, served as **local pages** by the Tauri app — no injection, no Shadow DOM, no remote content. Light/dark follows the OS.

**Status:** a minimal placeholder (`PanelRoot`: mute control + connected state) that proves the page → Rust core wiring. It replaced the old `overlay-ui` in Stage 1. The real panels arrive in [Stage 4](../../ROADMAP.md#stage-4--tray-client) and later.

**Kept from the old overlay:** the Vite + Vitest scaffolding, the Radix Themes + Zustand setup, the leaf-isolated stores (`speakingStore`, `microphoneStore`, `useIsSpeaking`, …), the churn-diagnostics tooling, and the `avatarColor` helper. See [STATE-AND-RESILIENCE.md](../../docs/architecture/STATE-AND-RESILIENCE.md).

## What it will be

- Connection / roster / mute / channel switcher
- Chat and whispers, handouts, loot drops
- History and AI summaries
- RSVP / upcoming sessions
- DM soundboard, party split, recording control (DM only)
- A connection-status screen for the DM/Admin (stability, jitter, latency per player)

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
└── main.tsx       # mounts <PanelRoot /> into index.html
```

## Depends On

- `shared/` — cross-module contracts (IPC payloads and event names today; campaign/recording shapes later)
