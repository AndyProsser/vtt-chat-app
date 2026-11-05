# Conditions (Plan C) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** D&D 5e condition badges on avatars — a color-coded dot + hover tooltip in the compact view, full badges in the expanded view — DM-editable by default with a two-tier permission model, synced across every client via Plan B's WS layer. **Depends on Plan A (`Avatar`, `OverlayCornerMenu`) and Plan B (`wsConnect`/`wsSend`/`onWsMessage`) both being implemented first** — this plan assumes their final state, not the pre-Plan-A/B codebase.

**Assumption flagged for review:** D&D 5e's SRD condition list doesn't include "silenced" or "drunk/confused" — those were named as *examples* of audio-effect conditions during the design conversation, not standard 5e terms. This plan treats them as two app-specific additions layered on top of the 14 standard 5e conditions, specifically for the audio-effect mechanic. If that's not the intent, the condition list (Task 1) is the one place to change.

**Architecture:** No backend or Rust changes — this plan is purely a consumer of Plan B's existing generic pipe. Two new domain stores (`conditionsStore`, `identityStore`) plus one existing gap closed: nothing today tracks "am I the DM" client-side (`useOverlayBridge.ts` extracts `identity.isDm` and discards it after the connect calls) — `identityStore` fixes that, since the permission model needs it. A small dispatcher (`wsDispatch.ts`) parses raw `onWsMessage` JSON against `wsEnvelopeSchema` and routes by `type` to the right store; there's no registry/plugin system, just an if-chain, since three message types don't need one. Setting/clearing a condition sends a `condition:set`/`condition:clear` envelope via `wsSend` — Plan B's server already validates-and-rebroadcasts any envelope shape generically, so no backend work is needed for the sync itself.

**Known limitation, inherited from Plan B and accepted here, not solved:** Plan B's replay buffer is bounded and shared across all message types in a campaign. If it evicts a `condition:set` event before a client reconnects, that client's view of that condition goes stale until someone re-touches it. There's no snapshot/resync mechanism for "current condition state" in this plan — durable state is Stage 5's job (Postgres/Redis), not this plan's.

## Global Constraints

- No backend or Rust changes in this plan. If gaps are found, fix them in Plan A/B's plan documents before their execution (git history holds any such correction, same pattern used when Plan B's send-capability gap was caught) — do not patch around it here.
- Every new store write must no-op-guard where a value could plausibly not change ([STATE-AND-RESILIENCE.md § Write Discipline](../../architecture/STATE-AND-RESILIENCE.md#write-discipline)).
- `useConditions(participantId)` must be a leaf-isolated, single-participant selector — never a composed conditions object passed to a leaf component ([STATE-AND-RESILIENCE.md § Leaf Isolation](../../architecture/STATE-AND-RESILIENCE.md#leaf-isolation-mandatory-for-highfrequencyperparticipant-data)).
- Audio-effect conditions (`hasAudioEffect: true`) are **always** DM-only to set/clear, regardless of the player-editing permission setting — that setting only ever governs the non-audio-effect subset. Do not let the permission toggle widen to cover audio-effect conditions.
- `rustfmt`/`clippy` not touched (no Rust files). `npm run lint`/`format:check`/`typecheck`/`build`/`test` must stay green on every task.

---

## Task 1: `shared/` — condition list + concrete WS message types

**Files:**
- Create: `shared/src/types/conditions.ts`
- Modify: `shared/src/types/index.ts`
- Modify: `shared/src/types/ws.ts`

**Interfaces:**
- Produces: `ConditionId`, `ConditionDefinition`, `CONDITIONS`, `conditionDefinition(id)`; `ConditionSetPayload`, `ConditionClearPayload`, `PlayerConditionEditingPayload`; the concrete envelope aliases `ConditionSetEnvelope = WsEnvelope<'condition:set', ConditionSetPayload>` etc. Task 3/4/6 consume these.

- [ ] **Step 1: Add the condition list**

```ts
// shared/src/types/conditions.ts
/**
 * D&D 5e SRD condition set, plus two app-specific additions (`silenced`, `drunk-confused`) for
 * the audio-effect mechanic — 5e itself has no "silenced" or "drunk" condition. Conditions with
 * `hasAudioEffect: true` are always DM-only to set/clear, never player-editable regardless of
 * the player-editing permission setting: silenced means the DM hears the player but other
 * players don't, drunk/confused means other players hear that participant's voice muddled —
 * letting a player self-apply either would be a way to grief the audio pipeline, not roleplay.
 */
export type ConditionId =
  | 'blinded'
  | 'charmed'
  | 'deafened'
  | 'exhaustion'
  | 'frightened'
  | 'grappled'
  | 'incapacitated'
  | 'invisible'
  | 'paralyzed'
  | 'petrified'
  | 'poisoned'
  | 'prone'
  | 'restrained'
  | 'stunned'
  | 'unconscious'
  | 'silenced'
  | 'drunk-confused';

export interface ConditionDefinition {
  id: ConditionId;
  label: string;
  hasAudioEffect: boolean;
}

export const CONDITIONS: readonly ConditionDefinition[] = [
  { id: 'blinded', label: 'Blinded', hasAudioEffect: false },
  { id: 'charmed', label: 'Charmed', hasAudioEffect: false },
  { id: 'deafened', label: 'Deafened', hasAudioEffect: false },
  { id: 'exhaustion', label: 'Exhaustion', hasAudioEffect: false },
  { id: 'frightened', label: 'Frightened', hasAudioEffect: false },
  { id: 'grappled', label: 'Grappled', hasAudioEffect: false },
  { id: 'incapacitated', label: 'Incapacitated', hasAudioEffect: false },
  { id: 'invisible', label: 'Invisible', hasAudioEffect: false },
  { id: 'paralyzed', label: 'Paralyzed', hasAudioEffect: false },
  { id: 'petrified', label: 'Petrified', hasAudioEffect: false },
  { id: 'poisoned', label: 'Poisoned', hasAudioEffect: false },
  { id: 'prone', label: 'Prone', hasAudioEffect: false },
  { id: 'restrained', label: 'Restrained', hasAudioEffect: false },
  { id: 'stunned', label: 'Stunned', hasAudioEffect: false },
  { id: 'unconscious', label: 'Unconscious', hasAudioEffect: false },
  { id: 'silenced', label: 'Silenced', hasAudioEffect: true },
  { id: 'drunk-confused', label: 'Drunk / Confused', hasAudioEffect: true },
];

export function conditionDefinition(id: ConditionId): ConditionDefinition {
  const definition = CONDITIONS.find((c) => c.id === id);
  if (definition === undefined) throw new Error(`unknown condition id: ${id}`);
  return definition;
}
```

- [ ] **Step 2: Add the WS payload/envelope types**

Edit `shared/src/types/ws.ts`, appended:

```ts
import type { ConditionId } from './conditions.js';

export interface ConditionSetPayload {
  participantId: string;
  conditionId: ConditionId;
}

export interface ConditionClearPayload {
  participantId: string;
  conditionId: ConditionId;
}

export interface PlayerConditionEditingPayload {
  allowed: boolean;
}

/** `type` string constants for the envelopes this plan defines — kept next to the payload
 * types they pair with, not in `consts/`, since they're only ever used as `WsEnvelope<T, P>`'s
 * first type parameter, not as a standalone runtime value beyond that. */
export const CONDITION_SET_TYPE = 'condition:set';
export const CONDITION_CLEAR_TYPE = 'condition:clear';
export const PLAYER_CONDITION_EDITING_TYPE = 'permission:condition-editing';

export type ConditionSetEnvelope = WsEnvelope<typeof CONDITION_SET_TYPE, ConditionSetPayload>;
export type ConditionClearEnvelope = WsEnvelope<typeof CONDITION_CLEAR_TYPE, ConditionClearPayload>;
export type PlayerConditionEditingEnvelope = WsEnvelope<
  typeof PLAYER_CONDITION_EDITING_TYPE,
  PlayerConditionEditingPayload
>;
```

- [ ] **Step 3: Export the new file from the types barrel**

Edit `shared/src/types/index.ts`:

```ts
export * from './ddb.js';
export * from './session.js';
export * from './ipc.js';
export * from './ws.js';
export * from './conditions.js';
```

- [ ] **Step 4: Verify**

Run: `npm run build --workspace shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/types/conditions.ts shared/src/types/ws.ts shared/src/types/index.ts
git commit -m "feat(shared): add condition list and condition/permission WS envelope types"
```

---

## Task 2: `identityStore` — closes the "am I the DM" gap

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/identityStore.ts`
- Create: `tauri-client/overlay-ui/src/lib/identityStore.test.ts`
- Modify: `tauri-client/overlay-ui/src/lib/index.ts`

**Interfaces:**
- Produces: `useIdentityStore` (`{ ddbUserId: string | null; isDm: boolean; applyIdentity: (identity: DdbIdentity) => void }`). Task 8 (`useOverlayBridge` wiring) populates it; Task 5 (`useIsDm`) and Plan A's `OverlayCornerMenu` (Task 6 of this plan) read from it.

Domain state — a cache of what `ddb/`'s extraction already determined, not derived client-side again. No-op-guarded on `ddbUserId` (the identity that matters for equality; `isDm` only ever changes alongside a `ddbUserId` change in practice, since it's the same login).

- [ ] **Step 1: Write the failing test**

```ts
// tauri-client/overlay-ui/src/lib/identityStore.test.ts
import { describe, expect, it } from 'vitest';

import { useIdentityStore } from './identityStore.js';

function identity(overrides: Partial<{ ddbUserId: string; isDm: boolean }> = {}) {
  return {
    ddbUserId: overrides.ddbUserId ?? 'user-1',
    selectedCharacter: { id: 'char-1', name: 'Test', campaignId: 'campaign-1' },
    campaign: { id: 'campaign-1', name: 'Test Campaign', dmUserId: 'user-1' },
    isDm: overrides.isDm ?? false,
  };
}

describe('identityStore', () => {
  it('starts with no identity', () => {
    expect(useIdentityStore.getState().ddbUserId).toBeNull();
    expect(useIdentityStore.getState().isDm).toBe(false);
  });

  it('applyIdentity sets ddbUserId and isDm', () => {
    useIdentityStore.getState().applyIdentity(identity({ ddbUserId: 'user-2', isDm: true }));
    expect(useIdentityStore.getState().ddbUserId).toBe('user-2');
    expect(useIdentityStore.getState().isDm).toBe(true);
  });

  it('no-ops when the same ddbUserId is applied again', () => {
    useIdentityStore.getState().applyIdentity(identity({ ddbUserId: 'user-3', isDm: false }));
    const before = useIdentityStore.getState();

    useIdentityStore.getState().applyIdentity(identity({ ddbUserId: 'user-3', isDm: false }));
    expect(useIdentityStore.getState()).toBe(before);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace tauri-client/overlay-ui -- identityStore`
Expected: FAIL — cannot find module `./identityStore.js`.

- [ ] **Step 3: Implement**

```ts
// tauri-client/overlay-ui/src/lib/identityStore.ts
import type { DdbIdentity } from '@vtt-chat-app/shared';
import { create } from 'zustand';

interface IdentityStore {
  ddbUserId: string | null;
  isDm: boolean;
  applyIdentity: (identity: DdbIdentity) => void;
}

/**
 * Domain state — a cache of what `ddb/`'s extraction already determined during the cobalt-
 * cookie flow. Closes a real gap: before this, `useOverlayBridge.ts` extracted `identity.isDm`
 * and discarded it after the connect calls, so nothing in the UI could ask "am I the DM" — the
 * conditions permission model (Plan C) needs exactly that.
 */
export const useIdentityStore = create<IdentityStore>((set) => ({
  ddbUserId: null,
  isDm: false,
  applyIdentity: (identity) =>
    set((state) =>
      state.ddbUserId === identity.ddbUserId && state.isDm === identity.isDm
        ? state
        : { ddbUserId: identity.ddbUserId, isDm: identity.isDm },
    ),
}));
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace tauri-client/overlay-ui -- identityStore`
Expected: PASS — 3 tests.

- [ ] **Step 5: Add the barrel export**

Edit `tauri-client/overlay-ui/src/lib/index.ts` — add `export * from './identityStore.js';` alphabetically (after `./expandStore.js`, before `./microphoneStore.js` — assuming Plan A's `avatarColor.js`/`corner.js`/`expandStore.js` lines are already present).

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/identityStore.ts tauri-client/overlay-ui/src/lib/identityStore.test.ts \
        tauri-client/overlay-ui/src/lib/index.ts
git commit -m "feat(overlay-ui): add identityStore, closing the am-I-the-DM gap"
```

---

## Task 3: `conditionsStore` + `permissionsStore`

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/conditionsStore.ts`
- Create: `tauri-client/overlay-ui/src/lib/conditionsStore.test.ts`
- Create: `tauri-client/overlay-ui/src/lib/permissionsStore.ts`
- Create: `tauri-client/overlay-ui/src/lib/permissionsStore.test.ts`
- Modify: `tauri-client/overlay-ui/src/lib/index.ts`

**Interfaces:**
- Produces: `useConditionsStore` (`{ conditionsByParticipant: Record<string, ConditionId[]>; applySet: (participantId, conditionId) => void; applyClear: (participantId, conditionId) => void }`) and `usePermissionsStore` (`{ allowPlayerConditionEditing: boolean; applyAllowPlayerConditionEditing: (allowed: boolean) => void }`, default `true` — "start by trusting players a little", per the design conversation). Task 4 (`wsDispatch`) and Task 5 (selector hooks) consume both.

- [ ] **Step 1: Write the failing tests**

```ts
// tauri-client/overlay-ui/src/lib/conditionsStore.test.ts
import { describe, expect, it } from 'vitest';

import { useConditionsStore } from './conditionsStore.js';

describe('conditionsStore', () => {
  it('starts with no conditions on anyone', () => {
    expect(useConditionsStore.getState().conditionsByParticipant).toEqual({});
  });

  it('applySet adds a condition for a participant', () => {
    useConditionsStore.getState().applySet('alice', 'poisoned');
    expect(useConditionsStore.getState().conditionsByParticipant.alice).toEqual(['poisoned']);
  });

  it('applySet is idempotent for the same condition', () => {
    useConditionsStore.getState().applySet('bob', 'prone');
    useConditionsStore.getState().applySet('bob', 'prone');
    expect(useConditionsStore.getState().conditionsByParticipant.bob).toEqual(['prone']);
  });

  it('applySet no-ops when the condition is already set (reference-stable)', () => {
    useConditionsStore.getState().applySet('carol', 'stunned');
    const before = useConditionsStore.getState();

    useConditionsStore.getState().applySet('carol', 'stunned');
    expect(useConditionsStore.getState()).toBe(before);
  });

  it('applyClear removes a condition', () => {
    useConditionsStore.getState().applySet('dave', 'blinded');
    useConditionsStore.getState().applyClear('dave', 'blinded');
    expect(useConditionsStore.getState().conditionsByParticipant.dave).toEqual([]);
  });

  it('applyClear no-ops when the condition was never set', () => {
    useConditionsStore.getState().applySet('erin', 'charmed');
    const before = useConditionsStore.getState();

    useConditionsStore.getState().applyClear('erin', 'frightened');
    expect(useConditionsStore.getState()).toBe(before);
  });

  it('conditions are isolated per participant', () => {
    useConditionsStore.getState().applySet('frank', 'poisoned');
    useConditionsStore.getState().applySet('gina', 'prone');
    expect(useConditionsStore.getState().conditionsByParticipant.frank).toEqual(['poisoned']);
    expect(useConditionsStore.getState().conditionsByParticipant.gina).toEqual(['prone']);
  });
});
```

```ts
// tauri-client/overlay-ui/src/lib/permissionsStore.test.ts
import { describe, expect, it } from 'vitest';

import { usePermissionsStore } from './permissionsStore.js';

describe('permissionsStore', () => {
  it('defaults to allowing players to edit non-locked conditions', () => {
    expect(usePermissionsStore.getState().allowPlayerConditionEditing).toBe(true);
  });

  it('applyAllowPlayerConditionEditing updates the value', () => {
    usePermissionsStore.getState().applyAllowPlayerConditionEditing(false);
    expect(usePermissionsStore.getState().allowPlayerConditionEditing).toBe(false);

    usePermissionsStore.getState().applyAllowPlayerConditionEditing(true);
    expect(usePermissionsStore.getState().allowPlayerConditionEditing).toBe(true);
  });

  it('no-ops when the value is unchanged', () => {
    usePermissionsStore.getState().applyAllowPlayerConditionEditing(true);
    const before = usePermissionsStore.getState();

    usePermissionsStore.getState().applyAllowPlayerConditionEditing(true);
    expect(usePermissionsStore.getState()).toBe(before);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test --workspace tauri-client/overlay-ui -- conditionsStore permissionsStore`
Expected: FAIL — cannot find either module.

- [ ] **Step 3: Implement `conditionsStore`**

```ts
// tauri-client/overlay-ui/src/lib/conditionsStore.ts
import type { ConditionId } from '@vtt-chat-app/shared';
import { create } from 'zustand';

interface ConditionsStore {
  conditionsByParticipant: Record<string, ConditionId[]>;
  applySet: (participantId: string, conditionId: ConditionId) => void;
  applyClear: (participantId: string, conditionId: ConditionId) => void;
}

/**
 * Domain state — a cache of the campaign's condition badges, kept in its own store separate
 * from `speakingStore`/`useLiveKitStore` for the same reason those are already split from each
 * other: conditions change at a different rate than either (occasionally, by DM/player action,
 * not continuously). Populated by `wsDispatch.ts` parsing `condition:set`/`condition:clear`
 * envelopes off Plan B's WS layer.
 */
export const useConditionsStore = create<ConditionsStore>((set) => ({
  conditionsByParticipant: {},

  applySet: (participantId, conditionId) =>
    set((state) => {
      const current = state.conditionsByParticipant[participantId] ?? [];
      if (current.includes(conditionId)) return state;
      return {
        conditionsByParticipant: {
          ...state.conditionsByParticipant,
          [participantId]: [...current, conditionId],
        },
      };
    }),

  applyClear: (participantId, conditionId) =>
    set((state) => {
      const current = state.conditionsByParticipant[participantId] ?? [];
      if (!current.includes(conditionId)) return state;
      return {
        conditionsByParticipant: {
          ...state.conditionsByParticipant,
          [participantId]: current.filter((id) => id !== conditionId),
        },
      };
    }),
}));
```

- [ ] **Step 4: Implement `permissionsStore`**

```ts
// tauri-client/overlay-ui/src/lib/permissionsStore.ts
import { create } from 'zustand';

interface PermissionsStore {
  allowPlayerConditionEditing: boolean;
  applyAllowPlayerConditionEditing: (allowed: boolean) => void;
}

/**
 * Domain state — whether players may self-edit non-audio-effect conditions. Defaults to `true`
 * ("start by trusting players a little", per the design conversation); the DM can lock it via
 * `OverlayCornerMenu`. Audio-effect conditions ignore this setting entirely and stay DM-only
 * always — see `ConditionMenu.tsx` (Task 6) for where that's enforced.
 */
export const usePermissionsStore = create<PermissionsStore>((set) => ({
  allowPlayerConditionEditing: true,
  applyAllowPlayerConditionEditing: (allowed) =>
    set((state) =>
      state.allowPlayerConditionEditing === allowed ? state : { allowPlayerConditionEditing: allowed },
    ),
}));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test --workspace tauri-client/overlay-ui -- conditionsStore permissionsStore`
Expected: PASS — 7 + 3 tests.

- [ ] **Step 6: Add the barrel exports**

Edit `tauri-client/overlay-ui/src/lib/index.ts` — add both, alphabetically (`conditionsStore` after `churnDiagnostics`/`corner`, `permissionsStore` after `overlayVisibilityStore`).

- [ ] **Step 7: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/conditionsStore.ts tauri-client/overlay-ui/src/lib/conditionsStore.test.ts \
        tauri-client/overlay-ui/src/lib/permissionsStore.ts tauri-client/overlay-ui/src/lib/permissionsStore.test.ts \
        tauri-client/overlay-ui/src/lib/index.ts
git commit -m "feat(overlay-ui): add conditionsStore and permissionsStore"
```

---

## Task 4: `wsDispatch` — parse and route incoming WS messages

**Files:**
- Create: `tauri-client/overlay-ui/src/lib/wsDispatch.ts`
- Create: `tauri-client/overlay-ui/src/lib/wsDispatch.test.ts`
- Modify: `tauri-client/overlay-ui/src/lib/index.ts`

**Interfaces:**
- Consumes: `wsEnvelopeSchema` (existing, `@vtt-chat-app/shared`), the `CONDITION_SET_TYPE`/`CONDITION_CLEAR_TYPE`/`PLAYER_CONDITION_EDITING_TYPE` constants and payload types (Task 1).
- Produces: `export function createWsDispatch(handlers: WsDispatchHandlers): (raw: string) => void` where `WsDispatchHandlers = { onConditionSet: (payload: ConditionSetPayload) => void; onConditionClear: (payload: ConditionClearPayload) => void; onPlayerConditionEditing: (payload: PlayerConditionEditingPayload) => void }`. Task 8 (`useOverlayBridge` wiring) consumes it.

A plain if-chain, not a registry/plugin system — three message types don't need one, and YAGNI applies. Malformed or unrecognized envelopes are silently ignored (logged at `console.warn`, not thrown) — a stray or future message type from a later plan (e.g. chat) must not crash this dispatcher.

- [ ] **Step 1: Write the failing test**

```ts
// tauri-client/overlay-ui/src/lib/wsDispatch.test.ts
import { describe, expect, it, vi } from 'vitest';

import { createWsDispatch } from './wsDispatch.js';

describe('createWsDispatch', () => {
  it('routes condition:set to onConditionSet', () => {
    const onConditionSet = vi.fn();
    const dispatch = createWsDispatch({
      onConditionSet,
      onConditionClear: vi.fn(),
      onPlayerConditionEditing: vi.fn(),
    });

    dispatch(
      JSON.stringify({
        id: '1',
        type: 'condition:set',
        payload: { participantId: 'alice', conditionId: 'poisoned' },
      }),
    );

    expect(onConditionSet).toHaveBeenCalledWith({ participantId: 'alice', conditionId: 'poisoned' });
  });

  it('routes condition:clear to onConditionClear', () => {
    const onConditionClear = vi.fn();
    const dispatch = createWsDispatch({
      onConditionSet: vi.fn(),
      onConditionClear,
      onPlayerConditionEditing: vi.fn(),
    });

    dispatch(
      JSON.stringify({
        id: '2',
        type: 'condition:clear',
        payload: { participantId: 'bob', conditionId: 'prone' },
      }),
    );

    expect(onConditionClear).toHaveBeenCalledWith({ participantId: 'bob', conditionId: 'prone' });
  });

  it('routes permission:condition-editing to onPlayerConditionEditing', () => {
    const onPlayerConditionEditing = vi.fn();
    const dispatch = createWsDispatch({
      onConditionSet: vi.fn(),
      onConditionClear: vi.fn(),
      onPlayerConditionEditing,
    });

    dispatch(JSON.stringify({ id: '3', type: 'permission:condition-editing', payload: { allowed: false } }));

    expect(onPlayerConditionEditing).toHaveBeenCalledWith({ allowed: false });
  });

  it('ignores an unrecognized type without throwing', () => {
    const dispatch = createWsDispatch({
      onConditionSet: vi.fn(),
      onConditionClear: vi.fn(),
      onPlayerConditionEditing: vi.fn(),
    });

    expect(() => dispatch(JSON.stringify({ id: '4', type: 'chat:message', payload: {} }))).not.toThrow();
  });

  it('ignores malformed JSON without throwing', () => {
    const dispatch = createWsDispatch({
      onConditionSet: vi.fn(),
      onConditionClear: vi.fn(),
      onPlayerConditionEditing: vi.fn(),
    });

    expect(() => dispatch('not json')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace tauri-client/overlay-ui -- wsDispatch`
Expected: FAIL — cannot find module `./wsDispatch.js`.

- [ ] **Step 3: Implement**

```ts
// tauri-client/overlay-ui/src/lib/wsDispatch.ts
import type { ConditionClearPayload, ConditionSetPayload, PlayerConditionEditingPayload } from '@vtt-chat-app/shared';
import {
  CONDITION_CLEAR_TYPE,
  CONDITION_SET_TYPE,
  PLAYER_CONDITION_EDITING_TYPE,
  wsEnvelopeSchema,
} from '@vtt-chat-app/shared';

export interface WsDispatchHandlers {
  onConditionSet: (payload: ConditionSetPayload) => void;
  onConditionClear: (payload: ConditionClearPayload) => void;
  onPlayerConditionEditing: (payload: PlayerConditionEditingPayload) => void;
}

/**
 * Parses a raw `onWsMessage` payload against Plan B's generic envelope shape, then routes by
 * `type`. Plain if-chain, not a registry — three message types don't need one (YAGNI). Anything
 * malformed or unrecognized (a future plan's message type, a stray message) is logged and
 * dropped, never thrown — this dispatcher must not be able to crash the app.
 */
export function createWsDispatch(handlers: WsDispatchHandlers): (raw: string) => void {
  return (raw: string) => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      console.warn('[overlay-ui] ignoring malformed WS message (invalid JSON)');
      return;
    }

    const envelope = wsEnvelopeSchema.safeParse(parsedJson);
    if (!envelope.success) {
      console.warn('[overlay-ui] ignoring malformed WS message (invalid envelope shape)');
      return;
    }

    switch (envelope.data.type) {
      case CONDITION_SET_TYPE:
        handlers.onConditionSet(envelope.data.payload as ConditionSetPayload);
        break;
      case CONDITION_CLEAR_TYPE:
        handlers.onConditionClear(envelope.data.payload as ConditionClearPayload);
        break;
      case PLAYER_CONDITION_EDITING_TYPE:
        handlers.onPlayerConditionEditing(envelope.data.payload as PlayerConditionEditingPayload);
        break;
      default:
        // Not this plan's concern — a future plan's message type, or a stray message.
        break;
    }
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test --workspace tauri-client/overlay-ui -- wsDispatch`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the barrel export**

Edit `tauri-client/overlay-ui/src/lib/index.ts` — add `export * from './wsDispatch.js';` alphabetically (last, after `./tauriBridge.js`).

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/lib/wsDispatch.ts tauri-client/overlay-ui/src/lib/wsDispatch.test.ts \
        tauri-client/overlay-ui/src/lib/index.ts
git commit -m "feat(overlay-ui): add wsDispatch, routing WS messages by type"
```

---

## Task 5: Selector hooks

**Files:**
- Create: `tauri-client/overlay-ui/src/hooks/useConditions.ts`
- Create: `tauri-client/overlay-ui/src/hooks/useIsDm.ts`
- Create: `tauri-client/overlay-ui/src/hooks/useAllowPlayerConditionEditing.ts`
- Modify: `tauri-client/overlay-ui/src/hooks/index.ts`

**Interfaces:**
- Produces: `useConditions(participantId: string): ConditionId[]`, `useIsDm(): boolean`, `useAllowPlayerConditionEditing(): boolean`. Task 6/7 consume all three.

- [ ] **Step 1: Implement**

```ts
// tauri-client/overlay-ui/src/hooks/useConditions.ts
import { useConditionsStore } from '../lib/conditionsStore.js';
import type { ConditionId } from '@vtt-chat-app/shared';

const EMPTY: ConditionId[] = [];

/** Single-primitive-shaped selector for leaf components — see
 * docs/architecture/STATE-AND-RESILIENCE.md. Returns a stable empty array reference when a
 * participant has no conditions, so a leaf reading "no conditions" doesn't re-render every time
 * the store's top-level object reference changes for an unrelated participant. */
export function useConditions(participantId: string): ConditionId[] {
  return useConditionsStore((state) => state.conditionsByParticipant[participantId] ?? EMPTY);
}
```

```ts
// tauri-client/overlay-ui/src/hooks/useIsDm.ts
import { useIdentityStore } from '../lib/identityStore.js';

/** Single-primitive selector for leaf components — see docs/architecture/STATE-AND-RESILIENCE.md. */
export function useIsDm(): boolean {
  return useIdentityStore((state) => state.isDm);
}
```

```ts
// tauri-client/overlay-ui/src/hooks/useAllowPlayerConditionEditing.ts
import { usePermissionsStore } from '../lib/permissionsStore.js';

/** Single-primitive selector for leaf components — see docs/architecture/STATE-AND-RESILIENCE.md. */
export function useAllowPlayerConditionEditing(): boolean {
  return usePermissionsStore((state) => state.allowPlayerConditionEditing);
}
```

- [ ] **Step 2: Add the barrel exports**

Edit `tauri-client/overlay-ui/src/hooks/index.ts` — add all three, alphabetically (`useAllowPlayerConditionEditing` near the top, `useConditions` after `useChurnDiagnostics`, `useIsDm` after `useIsSpeaking`).

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tauri-client/overlay-ui/src/hooks/useConditions.ts tauri-client/overlay-ui/src/hooks/useIsDm.ts \
        tauri-client/overlay-ui/src/hooks/useAllowPlayerConditionEditing.ts tauri-client/overlay-ui/src/hooks/index.ts
git commit -m "feat(overlay-ui): add useConditions/useIsDm/useAllowPlayerConditionEditing"
```

---

## Task 6: `ConditionDot` + `ConditionMenu`, wired into `Avatar`

**Files:**
- Create: `tauri-client/overlay-ui/src/components/ConditionDot.tsx`
- Create: `tauri-client/overlay-ui/src/components/ConditionMenu.tsx`
- Modify: `tauri-client/overlay-ui/src/components/Avatar.tsx` (from Plan A)
- Modify: `tauri-client/overlay-ui/src/components/index.ts`
- Modify: `tauri-client/overlay-ui/src/lib/tauriBridge.ts` (uses `wsSend`, already added by Plan B — no change needed here beyond importing it)
- Modify: `tauri-client/overlay-ui/src/styles/theme.css`

**Interfaces:**
- Consumes: `useConditions`, `useIsDm`, `useAllowPlayerConditionEditing` (Task 5), `wsSend` (Plan B, `lib/tauriBridge.ts`), `CONDITIONS`/`ConditionId` (Task 1), Radix `ContextMenu`/`Tooltip`.
- Produces: `export const ConditionDot: React.FC<{ participantId: string }>`, `export const ConditionMenu: React.FC<{ participantId: string; children: ReactNode }>`. `Avatar.tsx` wraps itself in `ConditionMenu` and renders `ConditionDot` alongside its existing speaking ring.

Per the compact-view redesign spec: "compact-view avatars show at most a small indicator dot when any condition is active... color-coded and hoverable — hovering reveals the exact condition name(s) as a tooltip... DDB's own Maps VTT already renders condition icons directly on tokens, so this overlay's dot only needs to be enough to catch the eye... a simple scheme (e.g., one color for the DM-locked audio-effect conditions, one for everything else) is enough."

- [ ] **Step 1: Implement `ConditionDot`**

```tsx
// tauri-client/overlay-ui/src/components/ConditionDot.tsx
import { Tooltip } from '@radix-ui/themes';
import { conditionDefinition } from '@vtt-chat-app/shared';
import { memo } from 'react';

import { useConditions } from '../hooks/useConditions.js';

/**
 * Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — takes only `participantId`.
 * Simple two-color scheme, not a full per-condition palette: DDB's own Maps VTT already shows
 * condition detail on tokens, this dot only needs to catch the eye and point at the hover
 * detail. Renders nothing when the participant has no active conditions.
 */
export const ConditionDot = memo(function ConditionDot({ participantId }: { participantId: string }) {
  const conditions = useConditions(participantId);
  if (conditions.length === 0) return null;

  const hasAudioEffect = conditions.some((id) => conditionDefinition(id).hasAudioEffect);
  const label = conditions.map((id) => conditionDefinition(id).label).join(', ');

  return (
    <Tooltip content={label}>
      <span
        className={hasAudioEffect ? 'vtt-condition-dot vtt-condition-dot-audio' : 'vtt-condition-dot'}
        aria-hidden="true"
      />
    </Tooltip>
  );
});
```

- [ ] **Step 2: Implement `ConditionMenu`**

```tsx
// tauri-client/overlay-ui/src/components/ConditionMenu.tsx
import { ContextMenu } from '@radix-ui/themes';
import { CONDITIONS } from '@vtt-chat-app/shared';
import type { ReactNode } from 'react';

import { useAllowPlayerConditionEditing } from '../hooks/useAllowPlayerConditionEditing.js';
import { useConditions } from '../hooks/useConditions.js';
import { useIsDm } from '../hooks/useIsDm.js';
import { wsSend } from '../lib/tauriBridge.js';

/**
 * Right-click, per-avatar condition picker. DM can always toggle every condition; a player can
 * toggle only the non-audio-effect subset, and only when `allowPlayerConditionEditing` is true
 * — audio-effect conditions (silenced, drunk-confused) are never player-editable, regardless of
 * that setting, since they drive real per-listener audio routing.
 */
export function ConditionMenu({ participantId, children }: { participantId: string; children: ReactNode }) {
  const isDm = useIsDm();
  const allowPlayerEditing = useAllowPlayerConditionEditing();
  const activeConditions = useConditions(participantId);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Content>
        {CONDITIONS.map((condition) => {
          const editable = isDm || (allowPlayerEditing && !condition.hasAudioEffect);
          if (!editable) return null;

          const active = activeConditions.includes(condition.id);
          return (
            <ContextMenu.CheckboxItem
              key={condition.id}
              checked={active}
              onCheckedChange={(checked) => {
                const type = checked ? 'condition:set' : 'condition:clear';
                void wsSend(
                  JSON.stringify({
                    id: crypto.randomUUID(),
                    type,
                    payload: { participantId, conditionId: condition.id },
                  }),
                );
              }}
            >
              {condition.label}
            </ContextMenu.CheckboxItem>
          );
        })}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
```

- [ ] **Step 3: Wire both into `Avatar`**

Edit `tauri-client/overlay-ui/src/components/Avatar.tsx` (replacing its current content, from Plan A):

```tsx
// tauri-client/overlay-ui/src/components/Avatar.tsx
import { memo } from 'react';

import { useIsSpeaking } from '../hooks/useIsSpeaking.js';
import { avatarColor } from '../lib/avatarColor.js';
import { ConditionDot } from './ConditionDot.js';
import { ConditionMenu } from './ConditionMenu.js';

/**
 * Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — takes only `participantId`,
 * never a composed participant object. Placeholder content only: a color hashed from the
 * identity string, since there's no display name or portrait until Stage 3b's DDB extraction
 * lands. Wraps itself in `ConditionMenu` (Plan C) so right-clicking an avatar opens its
 * condition picker, and renders `ConditionDot` alongside the existing speaking ring.
 */
export const Avatar = memo(function Avatar({ participantId }: { participantId: string }) {
  const speaking = useIsSpeaking(participantId);
  return (
    <ConditionMenu participantId={participantId}>
      <span className="vtt-avatar-wrapper">
        <span
          className={speaking ? 'vtt-avatar vtt-avatar-speaking' : 'vtt-avatar'}
          style={{ backgroundColor: avatarColor(participantId) }}
          title={participantId}
        />
        <ConditionDot participantId={participantId} />
      </span>
    </ConditionMenu>
  );
});
```

- [ ] **Step 4: Add styling**

Edit `tauri-client/overlay-ui/src/styles/theme.css`, appended:

```css
.vtt-avatar-wrapper {
  position: relative;
  display: inline-flex;
}

.vtt-condition-dot {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e0c068;
  box-shadow: 0 0 0 1px rgba(20, 20, 24, 0.85);
}

.vtt-condition-dot-audio {
  background: #c25e5e;
}
```

- [ ] **Step 5: Add the barrel exports**

Edit `tauri-client/overlay-ui/src/components/index.ts` — add `export * from './ConditionDot.js';` and `export * from './ConditionMenu.js';` alphabetically (before `./ExpandedPanel.js`).

- [ ] **Step 6: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tauri-client/overlay-ui/src/components/ConditionDot.tsx tauri-client/overlay-ui/src/components/ConditionMenu.tsx \
        tauri-client/overlay-ui/src/components/Avatar.tsx tauri-client/overlay-ui/src/components/index.ts \
        tauri-client/overlay-ui/src/styles/theme.css
git commit -m "feat(overlay-ui): add ConditionDot/ConditionMenu, wired into Avatar"
```

---

## Task 7: Full condition badges in `ExpandedPanel`

**Files:**
- Modify: `tauri-client/overlay-ui/src/components/ExpandedPanel.tsx` (from Plan A)
- Modify: `tauri-client/overlay-ui/src/styles/theme.css`

**Interfaces:**
- Consumes: `useConditions` (Task 5), `conditionDefinition` (Task 1).

Per the design spec's expanded-view mockup — full text labels per row, not just a dot, since the expanded view has room for detail the compact view deliberately doesn't.

- [ ] **Step 1: Implement**

Edit `tauri-client/overlay-ui/src/components/ExpandedPanel.tsx` — add a small per-row badge list. Replace the `<li>` row rendering:

```tsx
{participantIdentities.map((identity) => (
  <li key={identity} className="vtt-expanded-row">
    <Avatar participantId={identity} />
    <span>{identity}</span>
    <ConditionBadges participantId={identity} />
  </li>
))}
```

Add the import at the top (alongside the existing `Avatar`/`MuteIcon`/`ExpandToggle` imports):

```tsx
import { ConditionBadges } from './ConditionBadges.js';
```

- [ ] **Step 2: Implement `ConditionBadges`**

```tsx
// tauri-client/overlay-ui/src/components/ConditionBadges.tsx
import { conditionDefinition } from '@vtt-chat-app/shared';
import { memo } from 'react';

import { useConditions } from '../hooks/useConditions.js';

/** Leaf-isolated per docs/architecture/STATE-AND-RESILIENCE.md — full text badges, expanded-
 * view-only (the compact view uses `ConditionDot` instead, deliberately thinner). */
export const ConditionBadges = memo(function ConditionBadges({
  participantId,
}: {
  participantId: string;
}) {
  const conditions = useConditions(participantId);
  if (conditions.length === 0) return null;

  return (
    <span className="vtt-condition-badges">
      {conditions.map((id) => (
        <span key={id} className="vtt-condition-badge">
          {conditionDefinition(id).label}
        </span>
      ))}
    </span>
  );
});
```

- [ ] **Step 3: Add styling**

Edit `tauri-client/overlay-ui/src/styles/theme.css`, appended:

```css
.vtt-condition-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.vtt-condition-badge {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 6px;
  border-radius: 10px;
}
```

- [ ] **Step 4: Add the barrel export**

Edit `tauri-client/overlay-ui/src/components/index.ts` — add `export * from './ConditionBadges.js';` alphabetically (before `./ConditionDot.js`).

- [ ] **Step 5: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tauri-client/overlay-ui/src/components/ExpandedPanel.tsx tauri-client/overlay-ui/src/components/ConditionBadges.tsx \
        tauri-client/overlay-ui/src/components/index.ts tauri-client/overlay-ui/src/styles/theme.css
git commit -m "feat(overlay-ui): show full condition badges in ExpandedPanel"
```

---

## Task 8: DM permission toggle in `OverlayCornerMenu`

**Files:**
- Modify: `tauri-client/overlay-ui/src/components/OverlayCornerMenu.tsx` (from Plan A)

**Interfaces:**
- Consumes: `useIsDm` (Task 5), `useAllowPlayerConditionEditing` (Task 5), `wsSend` (Plan B).

Adds the DM-only item Plan A's version of this component was deliberately structured to accept later ("DM-only items land in this same menu in later plans, built here so they have somewhere to go without restructuring this component again").

- [ ] **Step 1: Implement**

Edit `tauri-client/overlay-ui/src/components/OverlayCornerMenu.tsx` — add the DM-only section after the existing `ContextMenu.RadioGroup` (corner picker), inside `ContextMenu.Content`:

```tsx
{isDm && (
  <>
    <ContextMenu.Separator />
    <ContextMenu.CheckboxItem
      checked={allowPlayerEditing}
      onCheckedChange={(checked) => {
        void wsSend(
          JSON.stringify({
            id: crypto.randomUUID(),
            type: 'permission:condition-editing',
            payload: { allowed: checked },
          }),
        );
      }}
    >
      Players can edit conditions
    </ContextMenu.CheckboxItem>
  </>
)}
```

Add the two new hook calls near the top of the component (alongside the existing `useState` for `selected`), and the two new imports:

```tsx
import { useAllowPlayerConditionEditing } from '../hooks/useAllowPlayerConditionEditing.js';
import { useIsDm } from '../hooks/useIsDm.js';
import { wsSend } from '../lib/tauriBridge.js';
```

```tsx
const isDm = useIsDm();
const allowPlayerEditing = useAllowPlayerConditionEditing();
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/components/OverlayCornerMenu.tsx
git commit -m "feat(overlay-ui): add DM-only player-condition-editing toggle to OverlayCornerMenu"
```

---

## Task 9: Wire identity + WS dispatch into `useOverlayBridge`

**Files:**
- Modify: `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts`

**Interfaces:**
- Consumes: `useIdentityStore` (Task 2), `useConditionsStore`/`usePermissionsStore` (Task 3), `createWsDispatch` (Task 4), `onWsMessage` (Plan B).

Assumes Plan B's Task 13 has already been applied to this file (the `wsConnect(backendWsUrl(session.appSessionToken))` line inside the cobalt-cookie handler) — this task edits on top of that.

- [ ] **Step 1: Implement**

Edit `tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts`:

```ts
import { extractDdbIdentity } from '@vtt-chat-app/ddb';
import { useEffect } from 'react';

import { backendWsUrl, requestSession } from '../lib/backendClient.js';
import { useConditionsStore } from '../lib/conditionsStore.js';
import { useIdentityStore } from '../lib/identityStore.js';
import { useMicrophoneStore } from '../lib/microphoneStore.js';
import { useOverlayVisibilityStore } from '../lib/overlayVisibilityStore.js';
import { usePermissionsStore } from '../lib/permissionsStore.js';
import { useSpeakingStore } from '../lib/speakingStore.js';
import { useLiveKitStore } from '../lib/store.js';
import {
  connectLiveKit,
  onCobaltCookieDetected,
  onLiveKitState,
  onMicrophoneState,
  onOverlayToggle,
  onSpeakersChanged,
  onWsMessage,
  wsConnect,
} from '../lib/tauriBridge.js';
import { createWsDispatch } from '../lib/wsDispatch.js';

/**
 * Wires the whole Stage 1 pipeline: cobalt cookie event -> ddb/ identity extraction -> backend
 * session request -> rust-livekit connect, plus applying `livekit:state` events back into the
 * store. Call once from the overlay root — see docs/architecture/DDB-AUTH.md for the flow.
 *
 * Stage 2 adds the two hotkey-driven events: `livekit:microphone` (push-to-talk / mute toggle)
 * and `overlay:toggle`. Stage 3a adds `livekit:speakers`. Plan B adds the WS layer (`wsConnect`,
 * `onWsMessage`); Plan C adds `identityStore` (closing the "am I the DM" gap) and routes
 * `onWsMessage` through `wsDispatch` into `conditionsStore`/`permissionsStore`.
 */
export function useOverlayBridge(): void {
  const applyState = useLiveKitStore((state) => state.applyState);
  const applyMuted = useMicrophoneStore((state) => state.applyMuted);
  const toggleVisibility = useOverlayVisibilityStore((state) => state.toggle);
  const applySpeakers = useSpeakingStore((state) => state.applySpeakers);
  const applyIdentity = useIdentityStore((state) => state.applyIdentity);
  const applyConditionSet = useConditionsStore((state) => state.applySet);
  const applyConditionClear = useConditionsStore((state) => state.applyClear);
  const applyAllowPlayerConditionEditing = usePermissionsStore(
    (state) => state.applyAllowPlayerConditionEditing,
  );

  useEffect(() => {
    let cancelled = false;

    const unlistenState = onLiveKitState((state) => {
      if (!cancelled) applyState(state);
    });

    const unlistenMicrophone = onMicrophoneState(({ muted }) => {
      if (!cancelled) applyMuted(muted);
    });

    const unlistenOverlayToggle = onOverlayToggle(() => {
      if (!cancelled) toggleVisibility();
    });

    const unlistenSpeakers = onSpeakersChanged(({ speakingIdentities }) => {
      if (!cancelled) applySpeakers(speakingIdentities);
    });

    const dispatch = createWsDispatch({
      onConditionSet: (payload) => {
        if (!cancelled) applyConditionSet(payload.participantId, payload.conditionId);
      },
      onConditionClear: (payload) => {
        if (!cancelled) applyConditionClear(payload.participantId, payload.conditionId);
      },
      onPlayerConditionEditing: (payload) => {
        if (!cancelled) applyAllowPlayerConditionEditing(payload.allowed);
      },
    });
    const unlistenWsMessage = onWsMessage(dispatch);

    const unlistenCookie = onCobaltCookieDetected(({ cookieValue }) => {
      void (async () => {
        try {
          const identity = await extractDdbIdentity(cookieValue);
          applyIdentity(identity);
          const session = await requestSession(identity);
          await connectLiveKit(session.liveKit.url, session.liveKit.token);
          await wsConnect(backendWsUrl(session.appSessionToken));
        } catch (err) {
          console.error('[overlay-ui] failed to establish LiveKit session', err);
        }
      })();
    });

    return () => {
      cancelled = true;
      void unlistenState.then((unlisten) => unlisten());
      void unlistenMicrophone.then((unlisten) => unlisten());
      void unlistenOverlayToggle.then((unlisten) => unlisten());
      void unlistenSpeakers.then((unlisten) => unlisten());
      void unlistenWsMessage.then((unlisten) => unlisten());
      void unlistenCookie.then((unlisten) => unlisten());
    };
  }, [
    applyState,
    applyMuted,
    toggleVisibility,
    applySpeakers,
    applyIdentity,
    applyConditionSet,
    applyConditionClear,
    applyAllowPlayerConditionEditing,
  ]);
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck --workspace tauri-client/overlay-ui`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run test --workspace tauri-client/overlay-ui`
Expected: PASS — full suite (no new tests in this task, thin wiring only, consistent with this codebase's precedent of not unit-testing `useOverlayBridge` itself).

Run: `npm run build --workspace tauri-client/overlay-ui`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tauri-client/overlay-ui/src/hooks/useOverlayBridge.ts
git commit -m "feat(overlay-ui): wire identity capture and WS dispatch into useOverlayBridge"
```

---

## Task 10: Final full verification

**Files:** none (verification only).

- [ ] **Step 1: TypeScript gate suite**

Run: `npm run lint`
Expected: PASS.

Run: `npm run format:check`
Expected: PASS (aside from the pre-existing untracked `.claude/settings.local.json` noise).

Run: `npm run typecheck`
Expected: PASS across every workspace.

Run: `npm run build`
Expected: PASS across every workspace.

Run: `npm test`
Expected: PASS — includes 3 new `identityStore` tests, 7 new `conditionsStore` tests, 3 new `permissionsStore` tests, 5 new `wsDispatch` tests, plus everything from Plan A/B.

- [ ] **Step 2: Manual smoke test (not automatable in this environment)**

Record as a known follow-up: with two real DDB-authenticated sessions in the same campaign (one DM, one player), confirm a DM-set condition appears on the player's screen, that the player can toggle a non-audio-effect condition when editing is allowed and cannot when the DM disables it, and that audio-effect conditions never appear as editable in the player's `ConditionMenu` regardless of the setting.

- [ ] **Step 3: Commit if the verification step itself required any fixes**

If Step 1 was clean, there's nothing to commit here.
