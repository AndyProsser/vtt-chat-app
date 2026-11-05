# Contributing to VTT Chat App

Thanks for wanting to help. This project is a lightweight, **self-hosted** voice + chat + session-records system for tabletop groups — see [CLAUDE.md](.claude/CLAUDE.md) for the full spec and [README.md](README.md) for an overview. Read [DEVELOPING.md](DEVELOPING.md) first to get a local environment running.

> The project is mid-pivot (see [ROADMAP.md](ROADMAP.md)). Code from the previous design (a DDB-embedding overlay) still exists until Stage 1 removes it — please don't extend it, and don't treat it as a pattern.

## Before You Start

- Check open issues and pull requests to avoid duplicate work.
- For anything beyond a small fix, open an issue first describing what you want to build and why. This project intentionally stays lean — see [CLAUDE.md §13 (Non-Goals)](.claude/CLAUDE.md) before proposing a new feature.
- Several design topics are deliberately **still open** (identity and access, the sync protocol, the records details) — see [.claude/intent.md](.claude/intent.md). Please discuss before building against them.
- **Self-host first:** a change must work with every cloud adapter (Cloudflare, cloud LLM/transcription) disabled. Optional adapters are welcome; making the default path depend on one is not.
- **Consent is visible:** anything touching recording, transcripts or summaries needs extra care — read [RECORDING-AND-SUMMARIES.md](docs/architecture/RECORDING-AND-SUMMARIES.md) first, especially the privacy rules.
- Keep changes scoped to one module where possible. Cross-cutting changes (touching `shared/` plus multiple consumers) are fine, but should be flagged in the PR description.

## Code Conventions

Follow [CLAUDE.md §4](.claude/CLAUDE.md) and [docs/CONVENTIONS.md](docs/CONVENTIONS.md):

- TypeScript everywhere except `tauri-client/src-tauri/` and `tauri-client/rust-livekit/` (Rust).
- React 19 + Radix UI (+ Zustand) for every UI surface — no second frontend framework. Light/dark follows the OS.
- LF line endings.
- Each TypeScript package separates `components/`, `hooks/`, `consts/`, `types/`, `styles/`, `lib/` — don't dump logic and markup into one file.
- Cross-module types and contracts belong in `shared/`, not duplicated per-module.
- `rustfmt` + `clippy` clean for Rust; ESLint + Prettier clean for TypeScript.

## State & Resilience Checklist

Before merging any new store, selector, or effect touching per-participant or per-session state (`panels-ui/`, `web/`, `status/`, or Zustand/React tooling UIs), check it against [docs/architecture/STATE-AND-RESILIENCE.md](docs/architecture/STATE-AND-RESILIENCE.md):

- [ ] No composed "projection" object is passed as a prop to a leaf component — high-frequency/per-participant data (speaking, mic level, presence, typing) flows through a dedicated leaf subscribing to one primitive selector for one key.
- [ ] Every store write checks whether the value actually changed before writing (no unconditional collection replacement).
- [ ] Anything on an interval only runs while actually needed (visible/transmitting), capped around 30Hz — not defaulted to `requestAnimationFrame`.
- [ ] Every unbounded-growth collection (chat, activity feed, per-participant history) has an explicit retention limit decided at creation time.
- [ ] Domain state (backend-sourced) and UI-only state (client-only) aren't blurred — domain state is replaced wholesale on reconnect, never merged/patched.
- [ ] Nothing runs while no panel is visible: no intervals, animation frames, or running CSS animations. Tray state comes from the Rust core, not a React store.

This is a manual checklist, not an automated lint rule yet — reviewers apply it by hand until enforcement tooling exists.

## Making Changes

1. Fork or branch from `main`.
2. Make your changes, following the folder conventions for the module you're touching.
3. Update the relevant documentation in the same change — see [CLAUDE.md §17](.claude/CLAUDE.md). A behavior change without a doc update is an incomplete PR.
4. Run lint/format for any module you touched (see each module's `README.md` for its scripts once implemented).
5. Keep the PR focused — one concern per PR.

## Pull Requests

- Give the PR a clear title and a short description of *why*, not just *what*.
- Run `npm test` for any change touching a workspace with a `test` script (`panels-ui/` and, until Stage 1, `overlay-ui/`) and note any manual testing you did beyond that — most modules still don't have automated coverage, so call out what you verified by hand.
- Link the issue it addresses, if any.

## Reporting Bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your platform (Windows/macOS/Linux + distro/desktop environment if Linux)

## Code of Conduct

Be respectful. This is a small hobby project built by players, for players.
