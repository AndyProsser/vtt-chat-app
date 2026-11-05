# Repo Memory

Durable, cross-machine notes about this repo that aren't derivable from the code, docs, or git
history — the things Claude (or Andy) would otherwise have to re-learn every session. This file
is committed to git specifically so it isn't lost to Claude Code's per-machine auto-memory system
(`~/.claude/projects/*/memory/`), which does not sync between Andy's machines.

**This file is a manually-reconciled subset, not a mirror.** Any given machine's local
auto-memory — and Andy's **Memory Hub** (`memory.prosser.online`, cross-project) — may hold more,
or more current, entries than this file. See
[HomeLab's equivalent file](../../HomeLab/.claude/memory.md) for the fuller version of this
pattern and its reconciliation conventions.

## Feedback — how to work in this repo

- **Default to working directly on `main`, not an isolated worktree, when executing an
  implementation plan.** (Andy, 2026-08-31.)
  **Why:** matches this repo's git history — single-branch development, no feature-branch PRs —
  and how `ROADMAP.md` tracks stage/task progress against `main` directly.
  **How to apply:** expect "work directly on main" as the answer when a skill's workflow prompts
  for worktree consent, but still ask each time per that skill's own consent requirement — a plan
  touching riskier surfaces (Rust, backend) might warrant a different answer.

- **`git push` doesn't work from some Claude Code session environments here** — no credential
  helper configured, so pushes fail with "could not read Username for 'https://github.com'",
  even though credentials exist and work from Andy's own terminal/window.
  **How to apply:** don't attempt workarounds (embedding tokens, changing the remote URL). Leave
  commits local and tell Andy pushing is needed.

- **Self-host first; cloud is an optional advanced adapter.** (Andy, 2026-11-05.)
  **Why:** he wants other people to deploy their own instance, so nothing in the default path may
  need a third-party account. Cloudflare (TURN, Realtime SFU, Workers AI, Pages) and cloud
  LLM/transcription are for advanced users only.
  **How to apply:** never write code, docs or a sketch that implies Cloudflare is part of the
  stack. When a design offers a cloud shortcut, make the self-hosted path the default and the
  cloud one an adapter behind an interface. (The first architecture sketch drew Cloudflare boxes
  as if they were core — that framing is wrong now.)

- **Ask before designing identity, sync, or records details.** (CLAUDE.md §14, restated 2026-11-05
  when the design was left deliberately open.) The open topics are listed in
  [intent.md](intent.md); don't resolve one by writing code.

## Project context — decisions, state, and gotchas not obvious from the code

- **The project pivoted on 2026-10-29 (decided) / 2026-11-05 (repo rewritten): from a Tauri DDB
  browser with an injected overlay to a self-hosted, audio-only tray app with server-side records.**
  There is no embedded browser, page restriction, ad-block, overlay injection, cobalt-cookie auth
  or DDB coupling any more. The old design is in `docs/archive/`; its code is still in
  `tauri-client/src-tauri/`, `tauri-client/overlay-ui/`, `ddb/`, and `backend/`'s `POST /api/session`
  until ROADMAP Stage 1 removes it.
  **Why:** the group's real behaviour is one Discord channel with open mics; the missing value is
  *records and AI summaries*, and the embedded browser carried large platform risk (the
  WebKitGTK/NVIDIA crash and blank-render investigation) for little benefit.
  **How to apply:** if code you find references the overlay, the allowlist, `usePageMode`, the
  cobalt cookie or DDB identity, it's legacy awaiting removal — not a pattern to copy or extend.
  The 2026-08-31 "overlay everywhere, not Maps-scoped" note is moot.

- **Records & AI summary are CORE, not a plugin; recording is server-side.** (Andy, 2026-11-05.)
  LiveKit Egress writes **per-speaker tracks** (no mixed file), then ffmpeg → Whisper.cpp →
  Ollama run on the same server. Local by default; cloud providers are opt-in adapters.
  **Why per-speaker:** diarisation becomes free (speaker = track owner) and one person's audio can
  be dropped without re-processing everyone.
  **How to apply:** see `docs/architecture/RECORDING-AND-SUMMARIES.md`. Whispers/private audio are
  excluded at the routing layer, never filtered out of transcripts afterwards.

- **The consent cue plays locally on each client, not through the SFU.** Keeps it out of the
  recording/transcript, makes it work while muted, and makes it independent of the server being
  healthy. Late joiners hear it before their audio is captured; a network-blip rejoin doesn't
  replay it; acknowledgement is per-player-per-recording with an expiry; recording state is server
  truth. (Andy agreed, 2026-10-29.)

- **UDP is accepted.** The operator opens a UDP range for LiveKit media (+ `7881/tcp` fallback).
  Cloudflare Tunnel cannot carry WebRTC media and must never be presented as a substitute.
  Built-in LiveKit TURN is the self-host fallback for restrictive networks; cloud TURN is optional.

- **Platform priority: Windows > Linux/Ubuntu (Andy) > macOS (maybe later).** Most players are on
  Windows. Incomplete tray support on a Linux desktop is acceptable ("reliable, not perfect").
  Players keep the app hidden ~90% of the time — favour auto-rejoin, ~0 idle CPU, autostart,
  auto-update, crash recovery, and an honest tray icon.

- **Hotkey platform findings still hold (they're about the OS, not the overlay).** A bare-modifier
  PTT can't be an OS-global shortcut on any platform (`global-hotkey` has no scancode for it), and
  global shortcuts silently no-op on Wayland. GNOME also needs an AppIndicator extension for a tray
  icon. Design around these; don't rediscover them. (Detail: `DEVELOPING.md`.)

- **Windows build gotcha:** `rust-livekit`'s `libwebrtc_sys` is built against the static CRT, so
  `tauri-client/.cargo/config.toml` forces `+crt-static`. Don't remove it or you get `LNK2038`.

- **Docker is still a "no" — but only because it hasn't been revisited.** Andy's global default is
  "containerize everything"; this repo's CLAUDE.md says native services, no Docker. With the new
  goal of *other people* deploying their own instance, an optional container bundle is an open
  question. Don't add one, and don't assume the answer stays "no" forever.

## Reconciliation log

- 2026-09-09 (from `CachyOS`) — file created as part of moving `CLAUDE.md` into `.claude/`,
  mirroring the pattern built out in `HomeLab`.
- 2026-11-05 (from the Windows machine) — rewritten for the tray-app pivot, reconciled against the
  Memory Hub records `vtt-chat-simplified-direction-2026-10` and
  `vtt-chat-architecture-sketch-2026-10`. **Dropped** the overlay-specific entries (Maps scoping
  correction, local-identity gap, Radix-portal/Shadow-DOM and `pointer-events` lessons) — they
  described code that is being deleted; they remain in git history and the archive. **Added** the
  pivot, self-host-first, records-are-core, consent-cue, UDP, platform-priority and Docker notes.
  The hub records `vtt-chat-app-architecture-and-decisions` and
  `vtt-chat-app-state-resilience-and-overlay-gotchas` are **not yet retired** (Andy wants to review
  before they're dropped) and still describe the old design.
