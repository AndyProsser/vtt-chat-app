# Repo Memory

Durable, cross-machine notes about this repo that aren't derivable from the code, docs, or git
history — the things Claude (or Andy) would otherwise have to re-learn every session. This file
is committed to git specifically so it isn't lost to Claude Code's per-machine auto-memory system
(`~/.claude/projects/*/memory/`), which does not sync between Andy's machines.

**This file is a manually-reconciled subset, not a mirror.** Any given machine's local
auto-memory may hold more, or more current, entries than this file. See
[HomeLab's equivalent file](../../HomeLab/.claude/memory.md) for the fuller version of this
pattern and its reconciliation conventions.

## Feedback — how to work in this repo

- **Default to working directly on `main`, not an isolated worktree, when executing an
  implementation plan.** When offered a worktree per `superpowers:using-git-worktrees`, Andy
  chose to work directly on `main` (2026-08-31, Stage 3a Plan A's execution).
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

## Project context — decisions, state, and gotchas not obvious from the code

- **Overlay injection is "everywhere," not Maps-scoped, despite what §8.1 of this file's CLAUDE.md
  literally says in a couple of places.** The compact view (`tauri-client/overlay-ui`) is designed
  to always render, on every allowed page, as a minimal mic pill/avatar strip outside of Maps —
  this was a deliberate redesign decision (2026-08-31), not a regression. `usePageMode`/
  `pageMode.ts` (the page-classification logic that scoped injection to Maps) were deleted as part
  of it.
  **Why:** the CLAUDE.md's §8.1 "Overlay injection" bullet list predates this redesign and was
  never fully rewritten — a `> 2026-08-31 note:` correction was appended there, but read it as
  the current truth over the bullets above it.
  **How to apply:** don't reintroduce Maps-only scoping/`usePageMode` based on the older bullets;
  the corrective note in CLAUDE.md §8.1 and this entry are the current state.

- **Local player identity isn't exposed to the frontend, by design gap, not by oversight.**
  `useParticipantIdentities()` only returns remote participants — `rust-livekit`'s `emit_state`
  sources from `room.remote_participants()`, and the DDB-extracted identity in
  `useOverlayBridge.ts` is computed but never stored anywhere the compact/expanded overlay views
  can read it. Consequence: those views cannot show the local player's own avatar.
  **How to apply:** closing this needs either a small Rust change to `emit_state` (include
  `room.local_participant()`) or a new TS store field. Flagged during Stage 3a Plan A's review as
  out of scope for that UI-only plan — check whether it's been picked up in Stage 3b or a Plan A
  follow-up before assuming it's still open.

- **Radix `Tooltip`/`ContextMenu` portal to `document.body` by default — which escapes the Shadow
  DOM the injected overlay's CSS lives in.** Caught during Stage 3a Plan A's whole-branch review
  (invisible at per-task review scope), fixed in `47ba94d`.
  **How to apply:** any new Radix portal-based component added to the overlay needs an explicit
  portal-container override pointed at the Shadow DOM root, or it'll render unstyled outside it.

- **`.vtt-overlay`'s `pointer-events: none` only had a `button` element opt back in** — so the
  right-click corner-menu trigger (`OverlayCornerMenu`) was unreachable except when clicking
  exactly on an icon button. Fixed alongside the Radix-portal bug above, same commit.
  **How to apply:** any new interactive (non-`button`) element added directly inside
  `.vtt-overlay` needs its own explicit `pointer-events: auto` — it doesn't inherit reachability
  from the container.

## Reconciliation log

- 2026-09-09 (from `CachyOS`) — file created as part of moving `CLAUDE.md` into `.claude/`,
  mirroring the pattern built out in `HomeLab`. Seeded from this machine's local auto-memory for
  this repo (`feedback_work_on_main_directly.md`, folded in above) plus durable, still-relevant
  detail pulled out of `project_stage3a_plan_a_complete.md`'s implementation notes (the overlay
  scoping correction, the local-identity gap, and the two whole-branch-review bug fixes). The
  "what's next" part of that memory (Stage 3a Plan B/C sequencing) went to `intent.md` instead,
  since it's active-thread status, not a durable fact. Not yet reconciled against any other
  machine's local auto-memory for this repo.