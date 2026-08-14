# Overlay Redesign: Compact View, Groups, Conditions & DM Voice FX

**Status:** Approved 2026-08-14 (brainstormed live, following the mounting/z-index/stacking fixes to Stage 3a's overlay).
**Depends on:** [Stage 3a](2026-08-11-stage-3a-overlay-shell-voice-ui-design.md) (shipped). Parts of this design depend on Stage 3b (DDB DOM extraction) and Stage 4 (multi-window, DM controls, group routing) — see [Scope & Phasing](#scope--phasing) below for exactly which parts.

## Why

Stage 3a shipped a working `FullPanel`/`MicPill` split, but real usage (2026-08-14, the first live session testing it) surfaced that the split itself is more machinery than the UI needs: a single compact view, always defaulting to minimal, covers both cases. This spec also captures the DM-facing group/condition/voice-FX vision now, ahead of the stages that implement it, per CLAUDE.md §14 ("ask clarifying questions... document assumptions explicitly") — better to design it deliberately than build Stage 4 against an unstated assumption.

**Guiding principle, stated directly by the project owner:** the visual overlay should be as minimal as practical — just enough info to be useful, but never get in the way.

## Scope & Phasing

This spec covers four areas that sit at different points in the roadmap. Building it is not one task — treat each tier as its own future plan.

| Tier | Covers | Needs |
| --- | --- | --- |
| **Buildable now** | Compact view (flat, no groups), expand/collapse + fade, corner positioning, avatar placeholders, conditions as a manual/local stopgap | Nothing beyond what Stage 3a already ships |
| **Blocked on Stage 3b** | Real DDB avatars replacing placeholders; conditions sourced from DDB token data instead of manually toggled | DDB DOM extraction |
| **Blocked on Stage 4 + new `rust-livekit` work** | Actual groups (creation, DM drag-drop, Whisper, broadcast-vs-lock), DM voice modifiers, per-listener-different condition audio (silenced, drunk/confused) | LiveKit room-topology/subscription routing; new audio DSP capability in `rust-livekit` |

Explicitly **out of scope**: text chat. Sequenced after voice is solid (Stage 3c), not touched by this spec at all.

## Compact View (the one default view)

Replaces Stage 3a's `FullPanel`/`MicPill` split entirely — there is one compact view, everywhere, always the default on load.

**Ungrouped (the common case — most of the time, nobody's been split into groups):**

```
[Mute] │ (avatar)(avatar)(avatar)...              [⌄ expand]
```

- Mute icon: leftmost, clickable (same toggle as Stage 3a's `MuteButton`), separated from the avatar row by a thin vertical divider.
- Avatar row: small circular avatars, one per participant, including the local player's own (lightly marked so it's identifiable as "you" — simpler than special-casing self out of the leaf selector).
- Speaking indicator: a ring/glow around the avatar itself, replacing Stage 3a's separate `SpeakingDot`-next-to-name — same underlying `useIsSpeaking(participantId)` selector, different visual treatment.
- Expand icon: rightmost, small dedicated chevron (sidebar-style), click toggles to the full view with a brief fade transition. No elaborate animation needed.

**Grouped (once Stage 4's group routing exists):**

```
[Mute] │ Scouting                                 [⌄ expand]
         (avatar)(avatar)
       │ Jail
         (avatar)
```

- Group headers only render once the DM has actually split the table. The default "everyone together" state stays exactly like the ungrouped layout above — no header, no visual change from the common case. This keeps the minimal case minimal even after groups exist as a feature.
- Each active group: small text header (group name), avatar row underneath.

**Conditions in the compact view:** not explicitly discussed during brainstorming, so documenting the call made here — compact-view avatars show at most a small indicator dot when any condition is active (not full badge icons; that level of detail is expanded-view-only), consistent with "just enough info to be useful, never get in the way." Revisit if this reads as too vague in practice.
- Empty groups: invisible to players. The DM's view differs — see [Groups](#groups).

## Expand / Collapse

- Trigger: the dedicated expand icon on the compact view (not click-anywhere, not buried in a menu — it's used often enough to deserve its own affordance).
- Transition: brief fade, nothing more elaborate.
- **State scope: per-instance, zero persistence.** Each window/page runs its own separate injected overlay (a consequence of `initialization_script` being per-WebView), so "expand one window, not others" requires no new mechanism — it's already true by construction once expand/collapse is treated as in-memory UI-only state, matching the existing `overlayVisibilityStore` pattern (no `localStorage`, resets to collapsed on every fresh mount/refresh/navigation). This is a deliberate choice, not an oversight: forcing the compact view on every load ensures critical info is never hidden behind a state nobody remembers setting. May revisit based on player feedback.

## Corner Positioning

- Interaction: **pick-a-corner** (4 fixed positions), not free-form drag, for v1. Free drag is a possible later enhancement, not this pass.
- Invocation: hidden behind right-click — a simple context menu, not a visible settings icon, keeping the compact view's footprint minimal. This is the shared right-click surface every user gets (see [Groups](#groups) for the DM-only items added to the same menu).
- **Persistence model:**
  - One persisted value (`localStorage`, following the existing `OVERLAY_EVERYWHERE_STORAGE_KEY` pattern — no backend/account sync exists for arbitrary UI prefs yet, and none is needed here) — changing the corner updates this value for **future** page loads and app restarts.
  - Windows already open when the corner changes do **not** jump to the new corner immediately — only newly-loaded pages pick it up.
  - Nice-to-have, not required: while the app is running, a given window may remember its own corner across that window's own refreshes/navigations even if it temporarily diverges from the persisted value — but only if that's easy to implement; if it adds real complexity, just always read from the persisted value on every load.

## Groups

Groups exist only for the DM to isolate voice for a side-quest (scouting, jail, one player talking to an NPC alone, etc.) — most sessions, most of the time, nobody's grouped at all.

- **Default state:** everyone in one un-isolated group. No setup needed for normal play.
- **DM's view is structurally richer than a player's:** the DM always sees **Main** (the default group, explicitly labeled for them even though players see it as headerless) and **Whisper** (always present, empty until used), plus a **[+]** to create new named groups on demand.
- **Player's view:** only groups that currently have members render at all. Empty groups are invisible to players.
- **Assignment:** DM drags players between groups (including into/out of Whisper). Players don't self-assign.
- **Groups only isolate voice** — no effect on chat or anything else, once chat exists.
- **DM broadcast behavior:** by default the DM's own voice reaches every group simultaneously (normal narration/table-wide communication). DM can override this to lock to one specific group (a private aside with just that subset). **Exception — Whisper:** entering Whisper automatically locks the DM to that group until they explicitly finish the whisper; there's no accidental broadcast-while-whispering.
- **Session-scoped, ephemeral by design.** Rather than an explicit "session end" trigger — which CLAUDE.md §10 deliberately avoids (no session state machine, just a continuous timeline with bookmarks) — groups are modeled as pure ephemeral state (Redis-backed, scoped to the live room, never written to Postgres). Sessions are typically weeks apart, so a short inactivity TTL (on the order of an hour) naturally resets group state before the next session starts, with no special-case reset logic needed.
- **Future direction, not spec'd here:** the same TTL expiry that clears groups could double as an automatic trigger for CLAUDE.md's "session-start"/"session-end" bookmark types (system-inferred rather than requiring the DM to remember to place them), and potentially for kicking off post-session AI processing (Stage 7). The DM could still force this early. This needs its own design pass when Stage 5 (Redis ephemeral state) and Stage 7 (AI pipeline) are actually being built — the exact TTL, what "post-session processing" means, and how auto-placed bookmarks interact with DM-placed ones are open questions, not decisions made here.

## Conditions

- Fixed list, matched to the D&D 5e SRD condition set (blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious, exhaustion levels) — not free text.
- Displayed as small badges on each avatar.
- **Two permission tiers, by condition, not a single global toggle:**
  - Conditions **with** an audio effect (silenced, drunk/confused, etc.) are **always DM-only** — never player-editable, at any setting. Silenced: the DM hears the player, other players don't. Drunk/confused: other players hear that participant's voice muddled. Since these drive real per-listener audio routing, letting a player self-apply one would be a way to grief the audio pipeline, not a roleplay choice.
  - Conditions **without** an audio effect default to **player-editable** — trusting players by default. The DM can flip a setting to lock these down to DM-only too, and can always directly override any condition regardless of who's allowed to edit it.
- **Now vs. later:** the condition list and badges are buildable today as a manual, local stopgap (DM/player toggles them by hand). Syncing from DDB's actual token-condition data is Stage 3b work — this spec doesn't block on it.

## DM Voice Modifiers

- Real-time voice effects applied to the DM's own captured mic audio — dragon, mouse, god, monster, etc. — giving every DM a "voice of doom" regardless of their own vocal range.
- **Processing lives client-side, in `rust-livekit`**, applied before publishing — matches what CLAUDE.md already scopes as a `rust-livekit` responsibility ("native audio FX"), not server-side LiveKit processing. Everyone hears the modified voice as the actual published track; there's no per-listener difference here (unlike the locked conditions above).
- Fixed preset list to start, not a raw DSP parameter panel.
- **Access:** right-click submenu (same DM-only surface as group management), plus a small persistent indicator near the DM's own avatar/mute icon when a preset is active, so current state is visible at a glance without needing to reopen the menu. Not a frequently-changed control, so tucking the picker in right-click is fine — the indicator is what keeps it "easy to access/change" per the minimal-footprint goal.

## Expanded (Full) View

Opt-in per-instance (see [Expand/Collapse](#expand--collapse)). Chosen direction, confirmed via mockup comparison: **sectioned groups**, not a flat list with group tags — each group renders as its own labeled block with member rows underneath, directly mirroring the compact view's grouped structure at higher detail (avatar, name, condition badges, speaking ring, mute state all inline per row). This was chosen specifically because it's visually easier to spot who's in which group at a glance, and because group sections are clearer drag-drop targets for the DM than tags would be.

General shape takes inspiration from the archived `vtt-chat`'s equivalent panels (per CLAUDE.md §16 — consulted for ideas, not copied wholesale). Exact spacing/visual polish is left to implementation time, not pixel-specified here.

## State & Data Architecture

Extends the existing Stage 0.5 rules ([STATE-AND-RESILIENCE.md](../../architecture/STATE-AND-RESILIENCE.md)) — domain vs. UI-only, leaf isolation, no-op-guarded writes.

**New domain state** (backend-sourced, wholesale-replaced, each in its own store per the existing "don't fold high-frequency data into a low-frequency store" rule):

- `groups: Group[]` — `{ id, name, isWhisper }`. Separate from the roster.
- `groupAssignments: Record<participantId, groupId>` — separate from `groups` itself and from `speakingStore`: group membership changes at a completely different rate than speaking state, so folding them together would churn one on every change to the other, the same mistake Stage 0.5 already documents for the prior system.
- `conditions: Record<participantId, ConditionId[]>` — `ConditionId` drawn from the fixed 5e list; each condition's definition carries whether it's DM-locked (has an audio effect) or player-editable-by-default.
- DM's active voice-modifier preset.

**New leaf-isolated selector:** `useConditions(participantId)`, same pattern as `useIsSpeaking` — one participant's condition badges changing must not re-render every other avatar.

**UI-only state** (unchanged reasoning from earlier sections): expand/collapse (per-instance, zero persistence), corner position (persisted, single value + optional per-window in-memory override).

## Out of Scope

- Text chat — deliberately not covered anywhere in this spec. Comes after voice is solid (Stage 3c), on its own design pass.
- Free-drag corner positioning (v1 is pick-a-corner only).
- The exact TTL/session-boundary/AI-pipeline-trigger mechanism (noted as a future direction under [Groups](#groups), not decided here).
