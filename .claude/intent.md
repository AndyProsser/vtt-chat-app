# Intent

Current goals and session-spanning threads for this repo — the "what are we doing right now and
why" that would otherwise live only in one machine's conversation history. Distinct from
`ROADMAP.md` (tracking-only, per `CLAUDE.md` §17 — detailed decisions belong in `docs/`, not
here or there). See also [memory.md](memory.md) for durable facts rather than active threads.

Update this file as threads open, progress, or close — stale entries here are worse than none.

## Active threads

- **Stage 3a: Plan A done, Plan B next.** `ROADMAP.md`'s Stage 3 is split into 3a (compact/
  expanded overlay, WS sync layer, conditions — themselves split into Plan A/B/C) and 3b (DDB DOM
  extraction). Plan A (compact/expanded overlay UI) is fully implemented, task-reviewed, and
  whole-branch-reviewed as of 2026-08-31 — 15 commits on `main` (`73faa04`..`bf32ff5`), executed
  via `superpowers:subagent-driven-development`. See [memory.md](memory.md) for the durable
  lessons that came out of that review (overlay scoping correction, local-identity gap, two
  Radix/pointer-events bugs).
  - **Next up: Plan B** — the backend WS sync layer
    (`docs/superpowers/plans/2026-08-14-ws-layer-plan-b-plan.md`), Rust-owned connection/state
    machine (consistent with `rust-livekit` owning LiveKit's), TS/JS stays pure UI, reuses the
    already-issued `appSessionToken` for WS auth. Written, self-reviewed, and committed
    2026-08-14 — execution not yet started as of this file's creation (2026-09-09).
  - **Then Plan C** — conditions (`docs/superpowers/plans/2026-08-14-conditions-plan-c-plan.md`),
    consumes Plan B's `wsSend`/`onWsMessage` primitives. Also written and committed, not started.
  - Stage 3.5 (text chat) depends on Plan B's WS layer once it exists, not the other way around.

## Open questions / noticed in passing

- **Local player identity isn't exposed to the overlay** — `useParticipantIdentities()` only
  returns remote participants. Flagged during Stage 3a Plan A's review as out of scope for that
  UI-only plan; worth folding into Stage 3b or a Plan A follow-up rather than getting lost. See
  [memory.md](memory.md) for the technical detail.
- **Animated Maps VTT backgrounds render blank on Linux (WebKitGTK)** — likely the same root
  cause as the Stage 1 homepage NVIDIA EGL driver crash (confirmed bug, workaround tried and
  reverted). Directly threatens Stage 3's "overlay injection scoped to Maps VTT" deliverable for
  any campaign using an animated map background. Not yet investigated further as of `ROADMAP.md`'s
  Stage 3 section — see [docs/WEBKITGTK-NVIDIA-EGL-CRASH.md](../docs/WEBKITGTK-NVIDIA-EGL-CRASH.md)
  for the full account and the cheap diagnostic check (`__EGL_VENDOR_LIBRARY_FILENAMES` override)
  noted there.

## Resolved

- **This `.claude/` restructure (2026-09-09).** Moved root `CLAUDE.md` → `.claude/CLAUDE.md`
  (history preserved via `git mv`), added this file and `memory.md`, seeded from this machine's
  (`CachyOS`) local Claude Code auto-memory for this repo. Mirrors the pattern built out in
  `HomeLab` — see that repo's `.claude/intent.md` for the cross-machine reconciliation context
  this is part of.