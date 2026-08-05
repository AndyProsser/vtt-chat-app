# Contributing to VTT Chat App

Thanks for wanting to help. This project is a lightweight, self-hosted voice + chat overlay for D&D Beyond — see [CLAUDE.md](CLAUDE.md) for the full spec and [README.md](README.md) for an overview. Read [DEVELOPING.md](DEVELOPING.md) first to get a local environment running.

## Before You Start

- Check open issues and pull requests to avoid duplicate work.
- For anything beyond a small fix, open an issue first describing what you want to build and why. This project intentionally stays lean — see [CLAUDE.md §13 (Non-Goals)](CLAUDE.md) before proposing a new feature.
- Keep changes scoped to one module where possible. Cross-cutting changes (touching `shared/` plus multiple consumers) are fine, but should be flagged in the PR description.

## Code Conventions

Follow [CLAUDE.md §3](CLAUDE.md) and [docs/CONVENTIONS.md](docs/CONVENTIONS.md):

- TypeScript everywhere except `tauri-client/src-tauri/` and `tauri-client/rust-livekit/` (Rust).
- React 19 + Radix UI for every UI surface — no second frontend framework.
- Each TypeScript package separates `components/`, `hooks/`, `consts/`, `types/`, `styles/`, `lib/` — don't dump logic and markup into one file.
- Cross-module types and contracts belong in `shared/`, not duplicated per-module.
- `rustfmt` + `clippy` clean for Rust; ESLint + Prettier clean for TypeScript.

## Making Changes

1. Fork or branch from `main`.
2. Make your changes, following the folder conventions for the module you're touching.
3. Update the relevant documentation in the same change — see [CLAUDE.md §17](CLAUDE.md). A behavior change without a doc update is an incomplete PR.
4. Run lint/format for any module you touched (see each module's `README.md` for its scripts once implemented).
5. Keep the PR focused — one concern per PR.

## Pull Requests

- Give the PR a clear title and a short description of *why*, not just *what*.
- Note any manual testing you did (this project doesn't have a full test suite yet — call out what you verified by hand).
- Link the issue it addresses, if any.

## Reporting Bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your platform (Windows/macOS/Linux + distro/desktop environment if Linux)

## Code of Conduct

Be respectful. This is a small hobby project built by players, for players.
