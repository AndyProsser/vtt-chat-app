# Overlay Compact View Redesign (Plan A: UI/UX) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Stage 3a's `FullPanel`/`MicPill` page-based split with the one compact view the design spec calls for everywhere, plus per-instance expand/collapse (with fade), pick-a-corner positioning, and colored-circle avatar placeholders. Pure `overlay-ui` TypeScript — no Rust, no voice/audio behavior changes.

**Architecture:** A new `expandStore` (UI-only, per-instance, unpersisted) drives whether `OverlayRoot` renders `CompactPanel` (horizontal avatar strip) or `ExpandedPanel` (vertical list) — both wrapped in a shared Radix `ContextMenu` carrying the corner picker. `main.tsx` reads the persisted corner once at mount, before React renders, and applies it directly to the light-DOM host's inline style (unchanged from Stage 3a's fixed-positioning fix, just parameterized by corner instead of hardcoded top-left). `Avatar` absorbs `SpeakingDot`'s leaf-isolated role with a placeholder color hashed from the participant's identity string. This plan supersedes and removes most of Stage 3a's leaf-component tree (`FullPanel`, `MicPill`, `ConnectionStatus`, `MicrophoneStatus`, `MuteButton`, `ParticipantList`, `ParticipantRow`, `SpeakingDot`, `pageMode`/`usePageMode`) — see [Task 12](#task-12-remove-superseded-stage-3a-components).

**Tech Stack:** TypeScript, React 19, Zustand 5, `@radix-ui/themes` 3 (`IconButton`, `Tooltip`, `ContextMenu` — all confirmed present in the installed package before this plan was written).

**Design doc:** [docs/superpowers/specs/2026-08-14-overlay-compact-view-groups-dm-controls-design.md](../specs/2026-08-14-overlay-compact-view-groups-dm-controls-design.md) — this plan implements only the "buildable now" tier (compact view, expand/collapse, corner positioning, avatar placeholders). Groups, conditions, and DM voice modifiers are separate later plans (B and C) per that spec's phasing table.

## Global Constraints

- No composed "projection" object may be passed to a leaf component — `Avatar` takes only `participantId` ([STATE-AND-RESILIENCE.md § Leaf Isolation](../../architecture/STATE-AND-RESILIENCE.md#leaf-isolation-mandatory-for-highfrequencyperparticipant-data)).
- Every store write must no-op-guard where the value could plausibly not change — `expandStore.toggle()` is a pure flip (always changes by definition, no guard needed, matching `overlayVisibilityStore`'s existing precedent).
- UI-only state (expand/collapse, corner) must not be folded into any domain store, and must not itself become a place domain data leaks into ([STATE-AND-RESILIENCE.md § Store Boundaries](../../architecture/STATE-AND-RESILIENCE.md#store-boundaries)).
- **Expand/collapse state is per-instance and never persisted** — always defaults to collapsed on mount, no `localStorage`, no cross-window sync. This is deliberate (see the design spec's "Expand / Collapse" section), not an oversight — do not add persistence for it.
- **Corner position is read once at mount, not reactive within a window's lifetime.** Changing it via the picker updates `localStorage` for future loads only; the current window's panel does not move. Do not build a reactive corner store that re-positions the live DOM on change.
- Avatars are placeholder-only in this plan: a color hashed from the participant identity string, no initials (no display name exists until Stage 3b), no portraits.
- No new npm dependencies. Icon-like glyphs (mute state, expand chevron) use plain Unicode characters, not an icon library — this project has none installed, and emoji specifically are avoided for the icons themselves (cross-platform font-rendering risk across Windows/macOS/Linux, per CLAUDE.md §12) in favor of simple geometric characters (`●`/`○`/`⌄`/`⌃`) that render consistently from system fonts.
- `rustfmt`/`clippy` are not touched by this plan (no Rust files change) — `npm run lint`/`format:check`/`typecheck`/`build`/`test` must stay clean on every task.

---

## Task 1: `avatarColor` — deterministic placeholder color

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/avatarColor.ts`
- Test: `tauri-client/overlay-ui/src/lib/avatarColor.test.ts`

**Interfaces:**
- Produces: `export function avatarColor(identity: string): string` — returns an `hsl(...)` CSS color string. Task 4 (`Avatar`) consumes it.

- [ ] **Step 1: Write the failing test**

```ts
// tauri-client/overlay-ui/src/lib/avatarColor.test.ts
import { describe, expect, it } from 'vitest';

import { avatarColor } from './avatarColor.js';

describe('avatarColor', () => {
  it('is deterministic for the same identity', () => {
    expect(avatarColor('user-123')).toBe(avatarColor('user-123'));
  });

  it('returns a valid hsl() color string', () => {
    expect(avatarColor('user-123')).toMatch(/^hsl\(\d+, 55%, 45%\)$/);
  });

  it('differs across a small fixture set (not a uniqueness guarantee, just a sanity check)', () => {
    const colors = new Set(['alice', 'bob', 'carol', 'dave'].map(avatarColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace tauri-client/overlay-ui -- avatarColor`
Expected: FAIL — cannot find module `./avatarColor.js`.

- [ ] **Step 3: Implement**

```ts
// tauri-client/overlay-ui/src/lib/avatarColor.ts
const AVATAR_HUES = [0, 25, 50, 90, 140, 180, 210, 250, 280, 320] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministic placeholder avatar color from a participant identity. No display name or
 * portrait exists until Stage 3b's DDB extraction lands, so this only needs to make
 * participants visually distinguishable from each other — the same identity always produces
 * the same color, but there's no attempt at personalization.
 */
export function avatarColor(identity: string): string {
  const hue = AVATAR_HUES[hashString(identity) % AVATAR_HUES.length];
  return `hsl(${hue}, 55%, 45%)`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace tauri-client/overlay-ui -- avatarColor`
Expected: PASS — 3 tests.

- [ ] **Step 5: Add the barrel export**

Edit `tauri-client/overlay-ui/src/lib/index.ts` — add `export * from './avatarColor.js';` in alphabetical position (after `./churnDiagnostics.js`, before `./microphoneStore.js`).

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/avatarColor.ts tauri-client/overlay-ui/src/lib/avatarColor.test.ts \
        tauri-client/overlay-ui/src/lib/index.ts
git commit -m "feat(overlay-ui): add avatarColor for deterministic placeholder avatars"
```

---

## Task 2: `expandStore` — per-instance expand/collapse

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/expandStore.ts`
- Test: `tauri-client/overlay-ui/src/lib/expandStore.test.ts`

**Interfaces:**
- Produces: `useExpandStore` (Zustand store, `{ expanded: boolean; toggle: () => void }`). Task 6 (`ExpandToggle`) and Task 10 (`OverlayRoot`) consume it.

- [ ] **Step 1: Write the failing test**

```ts
// tauri-client/overlay-ui/src/lib/expandStore.test.ts
import { describe, expect, it } from 'vitest';

import { useExpandStore } from './expandStore.js';

describe('expandStore', () => {
  it('starts collapsed', () => {
    expect(useExpandStore.getState().expanded).toBe(false);
  });

  it('toggle flips the value', () => {
    useExpandStore.getState().toggle();
    expect(useExpandStore.getState().expanded).toBe(true);

    useExpandStore.getState().toggle();
    expect(useExpandStore.getState().expanded).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace tauri-client/overlay-ui -- expandStore`
Expected: FAIL — cannot find module `./expandStore.js`.

- [ ] **Step 3: Implement**

```ts
// tauri-client/overlay-ui/src/lib/expandStore.ts
import { create } from 'zustand';

interface ExpandStore {
  expanded: boolean;
  toggle: () => void;
}

/**
 * UI-only state, per-instance by construction (each window/page runs its own separately
 * injected overlay, via `initialization_script`), matching `overlayVisibilityStore`'s
 * reasoning — a local view preference, not a cache of any backend truth. Deliberately not
 * persisted: always resets to collapsed on a fresh mount/refresh/navigation, so critical info
 * is never hidden behind a state nobody remembers setting. See the compact-view redesign
 * spec's "Expand / Collapse" section.
 */
export const useExpandStore = create<ExpandStore>((set) => ({
  expanded: false,
  toggle: () => set((state) => ({ expanded: !state.expanded })),
}));
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace tauri-client/overlay-ui -- expandStore`
Expected: PASS — 2 tests.

- [ ] **Step 5: Add the barrel export**

Edit `tauri-client/overlay-ui/src/lib/index.ts` — add `export * from './expandStore.js';` alphabetically (after `./churnDiagnostics.js`, and after the `avatarColor` line Task 1 just added — i.e. `avatarColor`, `churnDiagnostics`, `expandStore`, `microphoneStore`, ...).

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/expandStore.ts tauri-client/overlay-ui/src/lib/expandStore.test.ts \
        tauri-client/overlay-ui/src/lib/index.ts
git commit -m "feat(overlay-ui): add expandStore for per-instance expand/collapse"
```

---

## Task 3: `corner` — pick-a-corner positioning, persisted

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/corner.ts`
- Test: `tauri-client/overlay-ui/src/lib/corner.test.ts`

**Interfaces:**
- Produces: `export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'`, `CORNER_STORAGE_KEY`, `DEFAULT_CORNER`, `getCorner(): Corner`, `setCorner(corner: Corner): void`, `cornerStyle(corner: Corner): string`. Task 9 (`OverlayCornerMenu`) consumes `getCorner`/`setCorner`/`Corner`; Task 11 (`main.tsx`) consumes `getCorner`/`cornerStyle`.

- [ ] **Step 1: Write the failing test**

```ts
// tauri-client/overlay-ui/src/lib/corner.test.ts
import { beforeEach, describe, expect, it } from 'vitest';

import { CORNER_STORAGE_KEY, DEFAULT_CORNER, cornerStyle, getCorner, setCorner } from './corner.js';

describe('corner', () => {
  beforeEach(() => {
    localStorage.removeItem(CORNER_STORAGE_KEY);
  });

  it('defaults to top-left when nothing is stored', () => {
    expect(getCorner()).toBe(DEFAULT_CORNER);
    expect(DEFAULT_CORNER).toBe('top-left');
  });

  it('setCorner persists, getCorner reads it back', () => {
    setCorner('bottom-right');
    expect(getCorner()).toBe('bottom-right');
  });

  it('ignores an invalid stored value and falls back to the default', () => {
    localStorage.setItem(CORNER_STORAGE_KEY, 'not-a-corner');
    expect(getCorner()).toBe(DEFAULT_CORNER);
  });

  it('cornerStyle anchors to the correct edges', () => {
    expect(cornerStyle('top-left')).toBe('top: 0 !important; left: 0 !important');
    expect(cornerStyle('top-right')).toBe('top: 0 !important; right: 0 !important');
    expect(cornerStyle('bottom-left')).toBe('bottom: 0 !important; left: 0 !important');
    expect(cornerStyle('bottom-right')).toBe('bottom: 0 !important; right: 0 !important');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace tauri-client/overlay-ui -- corner`
Expected: FAIL — cannot find module `./corner.js`.

- [ ] **Step 3: Implement**

```ts
// tauri-client/overlay-ui/src/lib/corner.ts
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const CORNER_STORAGE_KEY = 'vtt-overlay-corner';
export const DEFAULT_CORNER: Corner = 'top-left';

const VALID_CORNERS: readonly Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function isCorner(value: string): value is Corner {
  return (VALID_CORNERS as readonly string[]).includes(value);
}

/**
 * Read once at mount (`main.tsx`), before React renders — corner position is deliberately not
 * reactive within a window's lifetime. See the compact-view redesign spec's "Corner
 * Positioning" section: changing it updates `localStorage` for *future* loads only; a window
 * already open does not jump to the new corner.
 */
export function getCorner(): Corner {
  try {
    const stored = localStorage.getItem(CORNER_STORAGE_KEY);
    if (stored !== null && isCorner(stored)) return stored;
  } catch {
    // localStorage unavailable (e.g. disabled by the user) — fall through to the default.
  }
  return DEFAULT_CORNER;
}

export function setCorner(corner: Corner): void {
  try {
    localStorage.setItem(CORNER_STORAGE_KEY, corner);
  } catch {
    // localStorage unavailable — nothing to persist to. The picker's own UI still reflects the
    // in-memory selection until the page reloads.
  }
}

/** CSS fragment anchoring `position: fixed` content to the given corner. */
export function cornerStyle(corner: Corner): string {
  const vertical = corner.startsWith('top') ? 'top: 0 !important' : 'bottom: 0 !important';
  const horizontal = corner.endsWith('left') ? 'left: 0 !important' : 'right: 0 !important';
  return `${vertical}; ${horizontal}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace tauri-client/overlay-ui -- corner`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the barrel export**

Edit `tauri-client/overlay-ui/src/lib/index.ts` — add `export * from './corner.js';` alphabetically (after `./churnDiagnostics.js`, before `./expandStore.js`).

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/corner.ts tauri-client/overlay-ui/src/lib/corner.test.ts \
        tauri-client/overlay-ui/src/lib/index.ts
git commit -m "feat(overlay-ui): add corner get/set/style for pick-a-corner positioning"
```

---

## Task 4: `Avatar` — leaf-isolated placeholder avatar with speaking ring

**Files:**
- Create: `tauri-client/overlay-ui/src/components/Avatar.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`
- Modify: `tauri-client/overlay-ui/src/styles/theme.css`

**Interfaces:**
- Consumes: `useIsSpeaking` (existing), `avatarColor` (Task 1).
- Produces: `export const Avatar: React.FC<{ participantId: string }>`. Task 7 (`CompactPanel`) and Task 8 (`ExpandedPanel`) consume it.

Absorbs `SpeakingDot`'s leaf-isolated role — the speaking ring lives on the avatar itself now, not a separate dot next to a name. `SpeakingDot`/`ParticipantRow` are removed in Task 12 once nothing references them.

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/Avatar.tsx
import { memo } from 'react';

import { useIsSpeaking } from '../hooks/useIsSpeaking.js';
import { avatarColor } from '../lib/avatarColor.js';

/**
 * Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — takes only `participantId`,
 * never a composed participant object, so one participant's speaking state flipping only
 * re-renders their own avatar. Placeholder content only: a color hashed from the identity
 * string, since there's no display name or portrait until Stage 3b's DDB extraction lands.
 */
export const Avatar = memo(function Avatar({ participantId }: { participantId: string }) {
  const speaking = useIsSpeaking(participantId);
  return (
    <span
      className={speaking ? 'vtt-avatar vtt-avatar-speaking' : 'vtt-avatar'}
      style={{ backgroundColor: avatarColor(participantId) }}
      title={participantId}
    />
  );
});
```

- [ ] **Step 2: Add the barrel export**

Edit `tauri-client/overlay-ui/src/components/index.ts` — add `export * from './Avatar.js';` in alphabetical position (before `./ConnectionStatus.js`).

- [ ] **Step 3: Add avatar styling**

Edit `tauri-client/overlay-ui/src/styles/theme.css`, appended:

```css
.vtt-avatar {
  display: inline-block;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px transparent;
}

.vtt-avatar-speaking {
  box-shadow: 0 0 0 2px #7ee787;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tauri-client/overlay-ui/src/components/Avatar.tsx tauri-client/overlay-ui/src/components/index.ts \
        tauri-client/overlay-ui/src/styles/theme.css
git commit -m "feat(overlay-ui): add Avatar, absorbing SpeakingDot's leaf-isolated role"
```

---

## Task 5: `MuteIcon` — icon-only mute control with a third "not connected" state

**Files:**
- Create: `tauri-client/overlay-ui/src/components/MuteIcon.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`

**Interfaces:**
- Consumes: `useConnected` (existing), `useMicrophoneMuted` (existing), `setMicrophoneMuted` (existing, `lib/tauriBridge.ts`), Radix `IconButton`/`Tooltip`.
- Produces: `export const MuteIcon: React.FC`. Task 7/8 consume it. Replaces `MuteButton` (removed in Task 12).

Three visual states — live (connected, unmuted), muted (connected, muted), and not-connected — distinguished by color and opacity rather than swapping icon glyphs, so "not connected" reads as visually distinct from "muted" rather than looking like the same broken control. This directly addresses the gap ROADMAP.md's Stage 3a entry flagged: clicking mute/PTT while disconnected was a silent no-op with no way to tell it apart from a bug. The click handler itself is unchanged — still calls `setMicrophoneMuted`, which safely no-ops on the Rust side when there's no client; this task only makes that state visible, it doesn't change the no-op behavior itself (that's `hotkeys.rs`, untouched by this TS-only plan).

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/MuteIcon.tsx
import { IconButton, Tooltip } from '@radix-ui/themes';
import { memo, useCallback } from 'react';

import { useConnected } from '../hooks/useConnected.js';
import { useMicrophoneMuted } from '../hooks/useMicrophoneMuted.js';
import { setMicrophoneMuted } from '../lib/tauriBridge.js';

/**
 * Replaces Stage 3a's `MuteButton` — icon-only (the compact view's first element) with a
 * tooltip carrying the text detail instead of an always-visible label. Adds a third visual
 * state, "not connected", distinct from "muted" — see ROADMAP.md's Stage 3a entry on the
 * confusion this closes.
 */
export const MuteIcon = memo(function MuteIcon() {
  const connected = useConnected();
  const muted = useMicrophoneMuted();

  const handleClick = useCallback(() => {
    void setMicrophoneMuted(!muted).catch((err: unknown) => {
      console.error('[overlay-ui] failed to set microphone mute state', err);
    });
  }, [muted]);

  const label = !connected
    ? 'Not connected — mic controls have no effect yet'
    : muted
      ? 'Mic muted — hold Left Ctrl to talk'
      : 'Mic live';

  return (
    <Tooltip content={label}>
      <IconButton
        type="button"
        size="1"
        variant="soft"
        color={muted || !connected ? 'gray' : 'green'}
        className={connected ? 'vtt-mute-icon' : 'vtt-mute-icon vtt-mute-icon-disconnected'}
        onClick={handleClick}
      >
        <span aria-hidden="true">{muted || !connected ? '○' : '●'}</span>
      </IconButton>
    </Tooltip>
  );
});
```

- [ ] **Step 2: Add the barrel export**

Edit `tauri-client/overlay-ui/src/components/index.ts` — add `export * from './MuteIcon.js';` alphabetically (before `./OverlayRoot.js`, after `./MicrophoneStatus.js` for now — Task 12 removes the `MicrophoneStatus`/`MuteButton` lines).

- [ ] **Step 3: Add the "not connected" visual treatment**

Edit `tauri-client/overlay-ui/src/styles/theme.css`, appended:

```css
.vtt-mute-icon-disconnected {
  opacity: 0.4;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tauri-client/overlay-ui/src/components/MuteIcon.tsx tauri-client/overlay-ui/src/components/index.ts \
        tauri-client/overlay-ui/src/styles/theme.css
git commit -m "feat(overlay-ui): add MuteIcon with a distinct not-connected state"
```

---

## Task 6: `ExpandToggle` — the compact/expanded switch, with fade

**Files:**
- Create: `tauri-client/overlay-ui/src/components/ExpandToggle.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`

**Interfaces:**
- Consumes: `useExpandStore` (Task 2), Radix `IconButton`/`Tooltip`.
- Produces: `export const ExpandToggle: React.FC`. Task 7/8 consume it.

One component handles both directions — it reads `expanded` and shows the chevron (and label) appropriate to what clicking it would do next, rather than being two separate expand/collapse components.

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/ExpandToggle.tsx
import { IconButton, Tooltip } from '@radix-ui/themes';
import { memo } from 'react';

import { useExpandStore } from '../lib/expandStore.js';

/**
 * The compact view's dedicated expand affordance (and the expanded view's collapse affordance
 * — same control, same store, opposite label/glyph depending on current state). Deliberately
 * not click-anywhere-on-the-panel: this is used often enough to deserve its own target, per
 * the compact-view redesign spec's "Expand / Collapse" section.
 */
export const ExpandToggle = memo(function ExpandToggle() {
  const expanded = useExpandStore((state) => state.expanded);
  const toggle = useExpandStore((state) => state.toggle);

  return (
    <Tooltip content={expanded ? 'Collapse' : 'Expand'}>
      <IconButton type="button" size="1" variant="ghost" onClick={toggle}>
        <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
      </IconButton>
    </Tooltip>
  );
});
```

- [ ] **Step 2: Add the barrel export**

Edit `tauri-client/overlay-ui/src/components/index.ts` — add `export * from './ExpandToggle.js';` alphabetically (after `./ConnectionStatus.js`, before `./MicrophoneStatus.js`).

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tauri-client/overlay-ui/src/components/ExpandToggle.tsx tauri-client/overlay-ui/src/components/index.ts
git commit -m "feat(overlay-ui): add ExpandToggle for the compact/expanded switch"
```

---

## Task 7: `CompactPanel` — the new default view

**Files:**
- Create: `tauri-client/overlay-ui/src/components/CompactPanel.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`
- Modify: `tauri-client/overlay-ui/src/styles/theme.css`

**Interfaces:**
- Consumes: `useParticipantIdentities` (existing), `MuteIcon` (Task 5), `Avatar` (Task 4), `ExpandToggle` (Task 6).
- Produces: `export function CompactPanel()`. Task 10 (`OverlayRoot`) consumes it. Replaces `FullPanel`/`MicPill` (removed in Task 12).

```
[Mute] │ (avatar)(avatar)(avatar)...              [⌄ expand]
```

Includes the local player's own avatar in the row (per the design spec's call — simpler than special-casing self out of `useParticipantIdentities`).

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/CompactPanel.tsx
import { ExpandToggle } from './ExpandToggle.js';
import { Avatar } from './Avatar.js';
import { MuteIcon } from './MuteIcon.js';
import { useParticipantIdentities } from '../hooks/useParticipantIdentities.js';

/**
 * The one default view everywhere — replaces Stage 3a's page-based `FullPanel`/`MicPill`
 * split entirely. See the compact-view redesign spec's "Compact View" section.
 */
export function CompactPanel() {
  const participantIdentities = useParticipantIdentities();

  return (
    <div className="vtt-compact-panel">
      <MuteIcon />
      <span className="vtt-divider" aria-hidden="true" />
      <div className="vtt-avatar-row">
        {participantIdentities.map((identity) => (
          <Avatar key={identity} participantId={identity} />
        ))}
      </div>
      <ExpandToggle />
    </div>
  );
}
```

- [ ] **Step 2: Add the barrel export**

Edit `tauri-client/overlay-ui/src/components/index.ts` — add `export * from './CompactPanel.js';` alphabetically (after `./Avatar.js`, before `./ConnectionStatus.js`).

- [ ] **Step 3: Add layout + fade-in styling**

Edit `tauri-client/overlay-ui/src/styles/theme.css`, appended:

```css
.vtt-compact-panel {
  display: flex;
  align-items: center;
  gap: 6px;
  animation: vtt-fade-in 150ms ease-out;
}

.vtt-divider {
  width: 1px;
  align-self: stretch;
  background: rgba(255, 255, 255, 0.15);
}

.vtt-avatar-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

@keyframes vtt-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tauri-client/overlay-ui/src/components/CompactPanel.tsx tauri-client/overlay-ui/src/components/index.ts \
        tauri-client/overlay-ui/src/styles/theme.css
git commit -m "feat(overlay-ui): add CompactPanel, the one default view"
```

---

## Task 8: `ExpandedPanel` — the opt-in vertical view

**Files:**
- Create: `tauri-client/overlay-ui/src/components/ExpandedPanel.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`
- Modify: `tauri-client/overlay-ui/src/styles/theme.css`

**Interfaces:**
- Consumes: `useParticipantIdentities` (existing), `MuteIcon` (Task 5), `Avatar` (Task 4), `ExpandToggle` (Task 6).
- Produces: `export function ExpandedPanel()`. Task 10 consumes it.

Thinner than the design spec's illustrative mockup (which showed condition badges and group sections) — those need Plan C (conditions) and Stage 4 (groups) respectively, neither of which exist yet. This plan's expanded view is: avatar (with speaking ring) + identity, one row per participant, no sections, no badges, no per-participant mute state (we only know local self-mute — showing others' mute state needs new `TrackMuted`/`TrackUnmuted` wiring in `rust-livekit`, which is voice/audio work, out of this UI-only plan's scope). Confirmed acceptable scope reduction 2026-08-14.

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/ExpandedPanel.tsx
import { ExpandToggle } from './ExpandToggle.js';
import { Avatar } from './Avatar.js';
import { MuteIcon } from './MuteIcon.js';
import { useParticipantIdentities } from '../hooks/useParticipantIdentities.js';

/**
 * Opt-in vertical view — see the compact-view redesign spec's "Expanded (Full) View" section.
 * Flat for now (no group sections, no condition badges, no per-remote mute state): those need
 * Stage 4 (groups) and Plan C (conditions), neither built yet. This plan only replaces Stage
 * 3a's page-based full/pill split with per-instance expand/collapse of the same underlying
 * data — participant identity and speaking state.
 */
export function ExpandedPanel() {
  const participantIdentities = useParticipantIdentities();

  return (
    <div className="vtt-expanded-panel">
      <div className="vtt-expanded-header">
        <MuteIcon />
        <ExpandToggle />
      </div>
      {participantIdentities.length === 0 ? (
        <div className="vtt-participants-empty">No one else here yet</div>
      ) : (
        <ul className="vtt-expanded-list">
          {participantIdentities.map((identity) => (
            <li key={identity} className="vtt-expanded-row">
              <Avatar participantId={identity} />
              <span>{identity}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the barrel export**

Edit `tauri-client/overlay-ui/src/components/index.ts` — add `export * from './ExpandedPanel.js';` alphabetically (after `./ExpandToggle.js`, before `./MicrophoneStatus.js`).

- [ ] **Step 3: Add layout styling**

Edit `tauri-client/overlay-ui/src/styles/theme.css`, appended:

```css
.vtt-expanded-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
  animation: vtt-fade-in 150ms ease-out;
}

.vtt-expanded-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.vtt-expanded-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vtt-expanded-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tauri-client/overlay-ui/src/components/ExpandedPanel.tsx tauri-client/overlay-ui/src/components/index.ts \
        tauri-client/overlay-ui/src/styles/theme.css
git commit -m "feat(overlay-ui): add ExpandedPanel, the opt-in vertical view"
```

---

## Task 9: `OverlayCornerMenu` — right-click corner picker

**Files:**
- Create: `tauri-client/overlay-ui/src/components/OverlayCornerMenu.tsx`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`

**Interfaces:**
- Consumes: `Corner`, `getCorner`, `setCorner` (Task 3), Radix `ContextMenu`.
- Produces: `export function OverlayCornerMenu({ children }: { children: React.ReactNode })`. Task 10 (`OverlayRoot`) wraps both panels in it.

Hidden behind right-click, no visible settings icon, per the design spec — "make it hidden, but simple." Only the corner picker exists in this plan; DM-only items (group management, voice FX) get added to this same menu in later plans, not built here.

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/OverlayCornerMenu.tsx
import { ContextMenu } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';

import { getCorner, setCorner, type Corner } from '../lib/corner.js';

const CORNER_LABELS: Record<Corner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

/**
 * Right-click surface for the whole overlay — currently just the corner picker. DM-only items
 * (group management, voice FX presets) land in this same menu in later plans; built here so
 * they have somewhere to go without restructuring this component again.
 *
 * The picker's own display state tracks the *pending* selection immediately (so clicking an
 * option highlights right away), independent of whether `setCorner`'s `localStorage` write
 * succeeds — per the design spec, the current window never moves anyway, only future loads do.
 */
export function OverlayCornerMenu({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Corner>(() => getCorner());

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.RadioGroup
          value={selected}
          onValueChange={(value) => {
            const corner = value as Corner;
            setSelected(corner);
            setCorner(corner);
          }}
        >
          {(Object.keys(CORNER_LABELS) as Corner[]).map((corner) => (
            <ContextMenu.RadioItem key={corner} value={corner}>
              {CORNER_LABELS[corner]}
            </ContextMenu.RadioItem>
          ))}
        </ContextMenu.RadioGroup>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
```

- [ ] **Step 2: Add the barrel export**

Edit `tauri-client/overlay-ui/src/components/index.ts` — add `export * from './OverlayCornerMenu.js';` alphabetically (after `./MuteIcon.js`, before `./OverlayRoot.js`).

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tauri-client/overlay-ui/src/components/OverlayCornerMenu.tsx tauri-client/overlay-ui/src/components/index.ts
git commit -m "feat(overlay-ui): add OverlayCornerMenu, right-click corner picker"
```

---

## Task 10: `OverlayRoot` — wire it all together

**Files:**
- Modify: `tauri-client/overlay-ui/src/components/OverlayRoot.tsx`

**Interfaces:**
- Consumes: `useExpandStore` (Task 2), `CompactPanel` (Task 7), `ExpandedPanel` (Task 8), `OverlayCornerMenu` (Task 9). Drops `usePageMode` entirely.

- [ ] **Step 1: Implement**

```tsx
// tauri-client/overlay-ui/src/components/OverlayRoot.tsx
import { useOverlayBridge } from '../hooks/useOverlayBridge.js';
import { useOverlayVisible } from '../hooks/useOverlayVisible.js';
import { useExpandStore } from '../lib/expandStore.js';
import { CompactPanel } from './CompactPanel.js';
import { ExpandedPanel } from './ExpandedPanel.js';
import { OverlayCornerMenu } from './OverlayCornerMenu.js';

export function OverlayRoot() {
  // Called before the visibility check on purpose: the bridge owns the Tauri event listeners,
  // including the `overlay:toggle` one that makes the overlay visible again. Unmounting it while
  // hidden would leave nothing listening for the key that brings it back — and would tear down
  // the LiveKit session wiring along with it.
  useOverlayBridge();
  const visible = useOverlayVisible();
  const expanded = useExpandStore((state) => state.expanded);

  if (!visible) return null;

  return (
    <OverlayCornerMenu>
      <div className="vtt-overlay">{expanded ? <ExpandedPanel /> : <CompactPanel />}</div>
    </OverlayCornerMenu>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run test --workspace tauri-client/overlay-ui`
Expected: PASS — full suite (9 tests so far: 3 `avatarColor` + 2 `expandStore` + 4 `corner`, plus the 12 pre-existing = 21 total; exact count depends on which pre-existing tests Task 12 hasn't removed yet at this point — don't worry about the exact number here, just confirm zero failures).

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/components/OverlayRoot.tsx
git commit -m "feat(overlay-ui): wire OverlayRoot to the compact/expanded switch"
```

---

## Task 11: `main.tsx` — corner-aware host positioning

**Files:**
- Modify: `tauri-client/overlay-ui/src/main.tsx`

**Interfaces:**
- Consumes: `getCorner`, `cornerStyle` (Task 3).

Replaces the hardcoded `top: 0 !important; left: 0 !important` from Stage 3a's z-index fix with the corner read from `localStorage` at mount time.

- [ ] **Step 1: Implement**

Edit `tauri-client/overlay-ui/src/main.tsx`:

```tsx
import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { OverlayRoot } from './components/OverlayRoot.js';
import { cornerStyle, getCorner } from './lib/corner.js';
import overlayStyles from './styles/theme.css?inline';
import radixComponents from '@radix-ui/themes/components.css?inline';
import radixTokens from '@radix-ui/themes/tokens.css?inline';

const HOST_ELEMENT_ID = 'vtt-chat-overlay-host';

function mount(): void {
  if (document.getElementById(HOST_ELEMENT_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ELEMENT_ID;
  // Positioning lives here, on the light-DOM host, not on anything inside the Shadow DOM — see
  // the Stage 3a z-index fix this builds on. Corner is read once, here, before React ever
  // renders: it's deliberately not reactive within a window's lifetime (compact-view redesign
  // spec, "Corner Positioning") — `OverlayCornerMenu` only writes future-load state via
  // `setCorner`, it never touches this window's own DOM.
  host.setAttribute(
    'style',
    `all: initial; position: fixed !important; ${cornerStyle(getCorner())}; ` +
      'z-index: 2147483647 !important; pointer-events: none !important;',
  );
  document.body.appendChild(host);

  // Shadow DOM keeps DDB's page CSS from bleeding into the overlay and vice versa (CLAUDE.md §9).
  const shadowRoot = host.attachShadow({ mode: 'open' });

  // Radix's stylesheets have to be injected into the shadow tree directly, same as theme.css —
  // there's no document <head> to hang a <link> off inside a Shadow DOM, and Radix's CSS custom
  // properties/component styles are useless to components rendered outside the tree they're
  // attached to. Only tokens.css + components.css: this stage doesn't use Radix's Flex/Grid/Box
  // (layout.css) or style-prop utility classes (utilities.css).
  const radixStyleTag = document.createElement('style');
  radixStyleTag.textContent = radixTokens + radixComponents;
  shadowRoot.appendChild(radixStyleTag);

  const styleTag = document.createElement('style');
  styleTag.textContent = overlayStyles;
  shadowRoot.appendChild(styleTag);

  const reactRoot = document.createElement('div');
  shadowRoot.appendChild(reactRoot);

  createRoot(reactRoot).render(
    <Theme appearance="dark" accentColor="gray" hasBackground={false}>
      <OverlayRoot />
    </Theme>,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run build --workspace tauri-client/overlay-ui`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/main.tsx
git commit -m "feat(overlay-ui): position the host by the persisted corner, not hardcoded top-left"
```

---

## Task 12: Remove superseded Stage 3a components

**Files:**
- Delete: `tauri-client/overlay-ui/src/components/FullPanel.tsx`
- Delete: `tauri-client/overlay-ui/src/components/MicPill.tsx`
- Delete: `tauri-client/overlay-ui/src/components/ConnectionStatus.tsx`
- Delete: `tauri-client/overlay-ui/src/components/MicrophoneStatus.tsx`
- Delete: `tauri-client/overlay-ui/src/components/MuteButton.tsx`
- Delete: `tauri-client/overlay-ui/src/components/ParticipantList.tsx`
- Delete: `tauri-client/overlay-ui/src/components/ParticipantRow.tsx`
- Delete: `tauri-client/overlay-ui/src/components/SpeakingDot.tsx`
- Delete: `tauri-client/overlay-ui/src/lib/pageMode.ts`
- Delete: `tauri-client/overlay-ui/src/lib/pageMode.test.ts`
- Delete: `tauri-client/overlay-ui/src/hooks/usePageMode.ts`
- Modify: `tauri-client/overlay-ui/src/components/index.ts`
- Modify: `tauri-client/overlay-ui/src/hooks/index.ts`
- Modify: `tauri-client/overlay-ui/src/lib/index.ts`

By this point nothing references any of these — `OverlayRoot` (Task 10) no longer imports `FullPanel`, `MicPill`, or `usePageMode`; `CompactPanel`/`ExpandedPanel` (Tasks 7-8) replaced `ParticipantList`/`ParticipantRow`/`ConnectionStatus`/`MicrophoneStatus`/`MuteButton`; `Avatar` (Task 4) replaced `SpeakingDot`. Confirmed unused, not just unreferenced by the new code — safe to delete outright rather than leave as dead code.

- [ ] **Step 1: Delete the files**

```bash
git rm tauri-client/overlay-ui/src/components/FullPanel.tsx \
       tauri-client/overlay-ui/src/components/MicPill.tsx \
       tauri-client/overlay-ui/src/components/ConnectionStatus.tsx \
       tauri-client/overlay-ui/src/components/MicrophoneStatus.tsx \
       tauri-client/overlay-ui/src/components/MuteButton.tsx \
       tauri-client/overlay-ui/src/components/ParticipantList.tsx \
       tauri-client/overlay-ui/src/components/ParticipantRow.tsx \
       tauri-client/overlay-ui/src/components/SpeakingDot.tsx \
       tauri-client/overlay-ui/src/lib/pageMode.ts \
       tauri-client/overlay-ui/src/lib/pageMode.test.ts \
       tauri-client/overlay-ui/src/hooks/usePageMode.ts
```

- [ ] **Step 2: Update the barrel exports**

Edit `tauri-client/overlay-ui/src/components/index.ts` to the final set, alphabetical:

```ts
export * from './Avatar.js';
export * from './CompactPanel.js';
export * from './ExpandedPanel.js';
export * from './ExpandToggle.js';
export * from './MuteIcon.js';
export * from './OverlayCornerMenu.js';
export * from './OverlayRoot.js';
```

Edit `tauri-client/overlay-ui/src/hooks/index.ts` to the final set, alphabetical:

```ts
export * from './useChurnDiagnostics.js';
export * from './useConnected.js';
export * from './useIsSpeaking.js';
export * from './useMicrophoneMuted.js';
export * from './useOverlayBridge.js';
export * from './useOverlayVisible.js';
export * from './useParticipantIdentities.js';
```

Edit `tauri-client/overlay-ui/src/lib/index.ts` to the final set, alphabetical:

```ts
export * from './avatarColor.js';
export * from './backendClient.js';
export * from './churnDiagnostics.js';
export * from './corner.js';
export * from './expandStore.js';
export * from './microphoneStore.js';
export * from './overlayVisibilityStore.js';
export * from './speakingStore.js';
export * from './store.js';
export * from './tauriBridge.js';
```

- [ ] **Step 3: Verify nothing else references the removed files**

Run: `grep -rn "FullPanel\|MicPill\|ConnectionStatus\|MicrophoneStatus\|MuteButton\|ParticipantList\|ParticipantRow\|SpeakingDot\|pageMode\|usePageMode" tauri-client/overlay-ui/src`
Expected: no matches.

- [ ] **Step 4: Verify the build**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run build --workspace tauri-client/overlay-ui`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A tauri-client/overlay-ui/src
git commit -m "refactor(overlay-ui): remove components superseded by the compact-view redesign"
```

---

## Task 13: Final full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the complete TypeScript gate suite**

Run: `npm run lint`
Expected: PASS (only the pre-existing `vitest.setup.ts` unused-`vi`-import warning, not a new issue).

Run: `npm run format:check`
Expected: PASS (aside from the pre-existing, untracked `.claude/settings.local.json` noise, not a new issue).

Run: `npm run typecheck`
Expected: PASS across every workspace.

Run: `npm run build`
Expected: PASS across every workspace. Note the new `overlay.js` size in your report — expect it to shrink somewhat (fewer components, no more `pageMode`'s SPA-navigation history patching) but this isn't a hard target, just worth recording for the ledger.

Run: `npm test`
Expected: PASS — includes the 3 new test files from Tasks 1-3 (`avatarColor`, `expandStore`, `corner`) plus the pre-existing `microphoneStore`/`speakingStore` tests (`pageMode.test.ts` is gone, removed in Task 12).

- [ ] **Step 2: Commit if the verification step itself required any fixes**

If Step 1 was clean, there's nothing to commit here — this task is a checkpoint, not necessarily a code change. If a fix was needed, commit it with a message describing what the verification caught.
