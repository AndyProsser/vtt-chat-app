# Loot Management and Chat History (0.5.x part) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat (and its loot and handout cards) survives a server restart and loads older history on scroll; Give is a one-step picker; loot filters and visibility follow Andy's rules; any player can take from the party stash. No wire-contract change, so it ships as a 0.5.x patch.

**Architecture:** The server's snapshot reads recent chat from Postgres instead of the replay buffer, keeping the same frame shape. The desktop pages older chat through the existing `GET /api/campaigns/:id/chat?before=` call and rebuilds loot/handout cards from the existing loot and handout REST lists, anchored by time. Loot filters move to new values in `shared/` (used by both apps); player visibility is enforced in `LootService.list`; party-take reuses the existing `claim` and `return` routes with relaxed server rules.

**Tech Stack:** TypeScript, Express, Postgres (`pg`), Vitest, React 19 + Radix Themes, Zustand, Tauri (panels-ui).

**Spec:** [ROADMAP.md](../../../ROADMAP.md), Stage 10, "Loot management and chat history", parts 1 to 3 and "Loot decisions (Andy, 2026-11-17)". Parts 4 and 5 (re-drop, confirmed flag, Not confirmed filter, counter, notifications) are **out of scope**: they are the 0.6.0 / protocol 4 plan.

## Global Constraints

- **No wire change.** No new or changed fields in any `shared/` contract type, WS frame or REST body; `PROTOCOL_VERSION` stays. Old 0.5.x apps must keep working against the new server.
- Snapshot `recentChat` entries keep the `chat.message` frame shape: `{ id, campaignId, from: { userId, name }, text, at, kind, lang? }`.
- Chat loads **50** messages; each scroll-up loads **50** more (`limit=50`).
- DM filters, in order: **Available | Taken | All**, default **Available**.
- Player filters, in order: **All | Own | Party | Available**, default **Available**. (0.6.0 adds Not confirmed first and makes it the default.)
- A player's loot list **never** contains another player's own items (taken or given). Party-stash and available items are visible to every member.
- The DM gives to **named players only**, never to the party stash; the DM can remove any item (unchanged).
- Any player may **take** a party-stash item for themselves, or **return** it to the table.
- Chat cards are a record of the table: other players' "Taken by …" chat cards stay visible in chat. The visibility rule is for the loot panel.
- UI: Radix Themes, light/dark follows the OS; no animation runs while idle; respect `prefers-reduced-motion`.
- Per-module folders (`components/`, `hooks/`, `lib/`, `consts/`, `types/`); LF; ESLint + Prettier clean.
- Docs updated in the same change as the code (CLAUDE.md §17); user-visible changes go under `## [Unreleased]` in CHANGELOG.md.

## Review Focus

1. **Two messages with the same millisecond at a page boundary.** `listChat` uses `at < before`, so paging must request `before = oldest.at + 1` and rely on id de-duplication, or a line is silently skipped. Test in Task 4.
2. **Reconnect while scrolled back.** A snapshot replaces the shared chat with the newest 50; older pages already loaded are dropped and the "load older" control comes back. Must not throw or duplicate lines. Test in Task 4.
3. **Scroll position when older lines arrive.** Prepending must keep the line the user was reading in place, not jump to the bottom (today's effect scrolls to the end on every length change). Test in Task 4.
4. **Two players take the same party item at once.** Exactly one wins; the other gets `409 conflict`. Test in Task 2.
5. **A split pile in a player's list.** Visible only to a player who holds a share; the splitter who holds no share does not see it. Test in Task 2.

---

### Task 1: Snapshot chat from Postgres

**Files:**

- Modify: `backend/src/lib/realtime/hub.ts` (`snapshot()`, ~line 1041)
- Test: `backend/src/lib/realtime/realtime.test.ts`

**Interfaces:**

- Consumes: `store.listChat(campaignId, viewerId, { limit })` (existing, returns `ChatMessage[]` oldest first).
- Produces: snapshot `recentChat` read from the store, same entry shape as before (`seq` dropped; the clients ignore it).

- [ ] **Step 1: Write the failing test** `it('snapshot recent chat survives a restart (read from the store, not the replay buffer)')`: send two chat lines, build a fresh hub on the **same store** with a **new empty replay buffer**, connect, and assert `snapshot.recentChat.map(l => l.text)` equals the two texts in order, and each entry has `from.userId`, `from.name`, `kind`.
- [ ] **Step 2: Run** `npm test -w @vtt-chat-app/backend -- realtime` and confirm it fails (recentChat empty).
- [ ] **Step 3: Implement** in `snapshot()`: `const lines = await store.listChat(campaignId, viewerId, { limit: SNAPSHOT_CHAT_LINES })`, keep `recipientId === null`, map to the frame shape above (`lang` only when set). Add `SNAPSHOT_CHAT_LINES = 50` to `backend/src/consts/index.ts`. Remove the now-unused `CHAT_KINDS` if nothing else reads it.
- [ ] **Step 4: Run** `npm test -w @vtt-chat-app/backend` and confirm all pass (whisper tests must still pass: whispers stay out of `recentChat`).
- [ ] **Step 5: Commit** `fix(chat): the snapshot's recent chat comes from the database, so it survives a server restart`

### Task 2: Player loot visibility and party take/return

**Files:**

- Modify: `backend/src/lib/table/lootService.ts` (`list`, `claim`, `change`)
- Modify: `backend/src/lib/table/tableStore.ts`, `memoryTableStore.ts`, `postgresTableStore.ts`
- Test: `backend/src/lib/http/lootRoutes.test.ts`, `backend/src/lib/store/store.contract.test.ts` (or the table store's contract test, wherever `claimLoot` is covered)

**Interfaces:**

- Produces: `TableStore.takeFromParty(id: string, userId: string, at: number): Promise<LootItem | undefined>`: atomic `UPDATE … SET claimed_by = $2, claimed_at = $3, claimed_for = 'self' WHERE id = $1 AND claimed_for = 'party' RETURNING *` (undefined when it was not in the stash).
- Produces: `TableStore.returnFromParty(id: string): Promise<LootItem | undefined>`: atomic unclaim `WHERE id = $1 AND claimed_for = 'party'`.
- Produces: `visibleLoot(items: LootItem[], viewerId: string, dm: boolean): LootItem[]` exported from `backend/src/lib/table/lootVisibility.ts`.

- [ ] **Step 1: Write failing tests** in `lootRoutes.test.ts`:
  - `player list hides another player's own items`: p1 takes A, DM gives B to p1; p2's `GET loot` contains neither; p1's contains both; DM's contains both.
  - `party and available items are visible to every player`: p1 stores C; p2 sees C and an unclaimed D.
  - `split pile is visible only to share holders`: split among [p1]; p1 sees it, p2 (who split it) does not.
  - `any player can take from the party stash`: p1 stores C; p2 `POST claim {for:'self'}` → 200, `claimedBy = p2`, `claimedFor = 'self'`.
  - `any player can return a party item`: p1 stores C; p2 `POST return` → 200, unclaimed.
  - `racing party takes: one wins`: p2 and p3 claim C concurrently; one 200, one 409.
  - `DM still cannot claim, and cannot give to the party`: unchanged 403s.
- [ ] **Step 2: Run** `npm test -w @vtt-chat-app/backend -- loot` and confirm the new tests fail.
- [ ] **Step 3: Implement** `takeFromParty` and `returnFromParty` in both table stores (memory: same checks in one synchronous step); `visibleLoot` (DM: all; player: unclaimed, `claimedFor === 'party'`, own `self`/`assigned`, or a split share); `LootService.list` applies it; `claim` with `forWhom = 'self'` on an item whose `claimedFor === 'party'` calls `takeFromParty`; `giveBack` on a party item by any player calls `returnFromParty`. Own items keep today's "only the holder" rule. The existing `loot.claimed` / `loot.returned` broadcasts are reused unchanged.
- [ ] **Step 4: Run** `npm test -w @vtt-chat-app/backend` and confirm all pass, including `accessMatrix.test.ts`.
- [ ] **Step 5: Commit** `feat(loot): players see only available, party and their own loot; any player can take or return a party item`

### Task 3: Shared filters and actions

**Files:**

- Modify: `shared/src/lib/lootView.ts`
- Test: `shared/src/lib/lootView.test.ts`

**Interfaces:**

- Produces: `type LootFilter = 'available' | 'taken' | 'all' | 'own' | 'party'`.
- Produces: `lootFiltersFor(dm: boolean): LootFilter[]`: DM `['available', 'taken', 'all']`; player `['all', 'own', 'party', 'available']`.
- Produces: `defaultLootFilter(dm: boolean): LootFilter` → `'available'` for both.
- Produces: `filterLootItems(items, filter, selfId)`: `available` = unclaimed; `taken` = claimed; `own` = (claimedBy self and claimedFor `self`/`assigned`) or a split share; `party` = `claimedFor === 'party'`; `all` = everything given (the server already filtered a player's list).
- Produces: `lootActions(item, selfId, dm)`: a player on a party item (anyone's) gets `['take', 'return']`; everything else unchanged.

- [ ] **Step 1: Update tests**: the filter-order assertions above (exact arrays), `defaultLootFilter(true) === 'available'` and `(false)`, each filter's membership on a fixture with unclaimed / own-self / own-assigned / party-by-other / split-with-share items, and `lootActions({claimedBy:'p2', claimedFor:'party'}, 'p1', false)` equals `['take','return']`.
- [ ] **Step 2: Run** `npm test -w @vtt-chat-app/shared` and confirm failures.
- [ ] **Step 3: Implement** the above. `lootRequest('take', partyItem)` stays `claim {for:'self'}` and `'return'` stays `return`, so no new request shape.
- [ ] **Step 4: Run** `npm test -w @vtt-chat-app/shared && npm run typecheck --workspaces --if-present`; fix the compile errors this causes in `web/` and `panels-ui/` by mapping old values only as far as needed to compile (Tasks 7 and 8 do the UI).
- [ ] **Step 5: Commit** `feat(loot): Available | Taken | All for the DM, All | Own | Party | Available for players`

### Task 4: Desktop chat paging

**Files:**

- Modify: `tauri-client/panels-ui/src/consts/index.ts` (`CHAT_LIMIT` 300 → 1000, add `CHAT_PAGE = 50`)
- Modify: `tauri-client/panels-ui/src/lib/tableModel.ts`, `lib/tableStore.ts`
- Create: `tauri-client/panels-ui/src/lib/chatHistory.ts`, `hooks/useOlderChat.ts`
- Modify: `tauri-client/panels-ui/src/components/ChatView.tsx`
- Test: `tauri-client/panels-ui/src/lib/tableModel.test.ts`, `lib/chatHistory.test.ts`

**Interfaces:**

- Produces: `lineFromHistory(row: { id; senderId; senderName; recipientId; text; at; kind; lang }, members?): ChatLine` in `tableModel.ts` (whispers get `to` from `recipientId`, name from members or `''`).
- Produces: `prependChat(existing: ChatLine[], older: ChatLine[]): ChatLine[]`: merge by id, sort by `at`, keep the **newest** `CHAT_LIMIT`.
- Produces: store fields `historyDone: boolean` (no older pages) and action `addOlder(lines: ChatLine[], done: boolean)`; a snapshot resets `historyDone` to `false`.
- Produces: `fetchOlder(oldestAt: number): Promise<{ lines: ChatLine[]; done: boolean }>` in `chatHistory.ts`: `campaignApi('GET', 'chat?limit=50&before=' + (oldestAt + 1))`; `done` when fewer than 50 rows come back or `chat.length` has reached `CHAT_LIMIT`.
- Produces: `useOlderChat(scroller: RefObject<HTMLElement>)`: an `IntersectionObserver` on a top sentinel that calls `fetchOlder` once at a time; after `addOlder`, restores `scrollTop` by the height that was added.

- [ ] **Step 1: Write failing tests**: `prependChat` keeps both same-millisecond lines and drops the duplicate the `+1` cursor returns; `addOlder(lines, true)` sets `historyDone`; a `snapshot` after `addOlder` leaves only the snapshot lines plus whispers and `historyDone === false`; `fetchOlder` with a mocked `campaignApi` asks for `before = oldestAt + 1` and `limit=50` and reports `done` on a 12-row page.
- [ ] **Step 2: Run** `npm test -w @vtt-chat-app/panels-ui` and confirm failures.
- [ ] **Step 3: Implement** the interfaces. In `ChatView`: put the sentinel first in `.vtt-chat`; show "Loading older messages…" while a fetch runs and "Start of the conversation" when `historyDone`; scroll to the end only when a **newer** entry arrives (track the last entry id), not when older ones are prepended.
- [ ] **Step 4: Run** the panels-ui tests and lint; confirm pass.
- [ ] **Step 5: Commit** `feat(chat): scroll up to load older chat, 50 at a time`

### Task 5: Rebuild chat cards from the server

**Files:**

- Create: `tauri-client/panels-ui/src/lib/historyCards.ts`, `hooks/useRestoredCards.ts`
- Modify: `tauri-client/panels-ui/src/lib/tableStore.ts` (action `restoreCards`), `components/ChatView.tsx`
- Test: `tauri-client/panels-ui/src/lib/historyCards.test.ts`

**Interfaces:**

- Consumes: `GET loot` (`{ loot: LootItem[] }`, uses `droppedAt`) and `GET handouts` (`{ handouts }`, uses `createdAt`), both existing.
- Produces: `historyCards(loot, handouts, chat: ChatLine[], complete: boolean): TableCard[]`: one card per item whose time is ≥ the oldest loaded line's `at` (all of them when `complete`), `after` = id of the last line with `at ≤` its time (`null` if none). Loot cards carry `claimedBy`, `claimedFor`, `split`, `quantity`, `coin`, `itemType`, `rarity`, `description`, as `newCard` builds them today.
- Produces: store action `restoreCards(cards: TableCard[])`: adds cards whose id is missing; leaves existing cards (live state) untouched.
- Produces: `useRestoredCards()`: fetches both lists after each hydrate and after each `addOlder`, then calls `restoreCards`.

- [ ] **Step 1: Write failing tests** for `historyCards`: anchoring between two lines; an item older than the window is left out unless `complete`; a claimed item keeps its claim; `restoreCards` never overwrites an existing card.
- [ ] **Step 2: Run** the panels-ui tests; confirm failures.
- [ ] **Step 3: Implement**, reusing `newCard`'s field mapping (export a `lootCard(item, after)` / `handoutCard(h, after)` pair from `tableModel.ts` rather than duplicating it). Removed loot is not in the list and so is not restored; that is expected.
- [ ] **Step 4: Run** the panels-ui tests; confirm pass.
- [ ] **Step 5: Commit** `fix(chat): loot and handout cards come back after a server restart`

### Task 6: Give picker, and loot buttons on the collapsed chat card

**Files:**

- Create: `tauri-client/panels-ui/src/components/GivePicker.tsx`
- Modify: `tauri-client/panels-ui/src/components/LootActions.tsx`, `ChatCard.tsx`, `styles/` (the loot card rules)
- Test: `tauri-client/panels-ui/src/lib/lootActions.test.ts` (labels), plus a manual check

**Interfaces:**

- Produces: `GivePicker({ players: Member[]; onPick: (userId: string) => void; disabled?: boolean })`: a Radix `DropdownMenu` whose trigger is the existing Give `ToolButton` (icon + "Give"); each item shows the avatar (`memberAvatar(m)`, else `initials`), the character name, and the player's display name beside it in muted text (display name alone when there is no character). Keyboard: Radix default.
- Produces: `givePickerLabel(m: Member): { primary: string; secondary?: string }` in `lib/lootActions.ts` (unit tested).

- [ ] **Step 1: Write a failing test** for `givePickerLabel`: with a character → `{ primary: 'Shadow', secondary: 'Andy' }`; without → `{ primary: 'Andy' }`.
- [ ] **Step 2: Run** the test; confirm it fails.
- [ ] **Step 3: Implement** `GivePicker`; in `LootActions` replace the inline `PlayerList` with it (`give` renders `GivePicker`, the other actions stay `ToolButton`s). In `LootCard`, the head becomes a row: the toggle button (icon + label) | `LootActions` | the chevron; the chevron shows only when there is a description, and the expanded part shows only the description. No `<button>` inside a `<button>`.
- [ ] **Step 4: Run** tests and lint; run the app (`run` skill or the screenshot stack) and check: Give opens a menu over the panel (not inline), picking a player gives the item, and the collapsed chat card shows the buttons left of the arrow, in light and dark.
- [ ] **Step 5: Commit** `feat(loot): Give is a player menu; the chat card shows its buttons without opening`

### Task 7: Desktop loot panel filters and fade-out

**Files:**

- Modify: `tauri-client/panels-ui/src/components/LootPanel.tsx`, `lib/lootFilter.ts`, `styles/`
- Create: `tauri-client/panels-ui/src/hooks/useLeaving.ts`
- Test: `tauri-client/panels-ui/src/lib/lootFilter.test.ts`, `hooks/useLeaving.test.ts`

**Interfaces:**

- Consumes: Task 3's `lootFiltersFor`, `defaultLootFilter`, `filterLootItems`.
- Produces: `useLeaving<T extends { id: string }>(shown: T[], ms = 1200): { items: (T & { leaving?: true })[] }`: an item that drops out of `shown` stays in the list marked `leaving` for `ms`, then goes; one timer per departure, none while nothing changes.

- [ ] **Step 1: Write failing tests** for `useLeaving` (fake timers): an item removed from `shown` is still returned with `leaving: true`, and is gone after `ms`; re-adding it before then clears `leaving`.
- [ ] **Step 2: Run**; confirm failure.
- [ ] **Step 3: Implement**: filter state starts at `defaultLootFilter(dm)`; filter buttons in `lootFiltersFor(dm)` order with labels Available / Taken / All / Own / Party; `shown` goes through `useLeaving`; a leaving row gets `vtt-loot-leaving` (opacity 0 over the duration, `pointer-events: none`; under `prefers-reduced-motion` it is removed without a transition). The empty text for Available is "Nothing left to take."
- [ ] **Step 4: Run** tests and lint; in the app, give an item from Available and watch it fade out.
- [ ] **Step 5: Commit** `feat(loot): the panel opens on Available, and given or split items fade out`

### Task 8: Web app loot tab

**Files:**

- Modify: `web/src/components/phone/InventoryTab.tsx`
- Create: `web/src/components/phone/GiveSelect.tsx`
- Test: `web/src/lib/phone/*.test.ts` where the tab's helpers live (add `giveLabel` beside them)

**Interfaces:**

- Consumes: Task 3's filters; `lootRequest('give', item, userId)` (existing).
- Produces: `GiveSelect({ players; onPick })`: a Radix `Select` whose trigger reads "Give to…" (one tap opens it; no separate Give button first); items show avatar, character name and player name, as the desktop picker.

- [ ] **Step 1: Write a failing test** for the shared label helper used by `GiveSelect` (same cases as Task 6; reuse one helper from `shared/` if both apps can import it, otherwise one per app).
- [ ] **Step 2: Run**; confirm failure.
- [ ] **Step 3: Implement**: filters from `lootFiltersFor(dm)` with `defaultLootFilter(dm)`; labels Available / Taken / All / Own / Party; `give` renders `GiveSelect` in place of the button-then-select pair.
- [ ] **Step 4: Run** `npm test -w @vtt-chat-app/web` and lint; check on the phone layout in a browser, light and dark.
- [ ] **Step 5: Commit** `feat(web): loot filters match the desktop, and Give is one tap`

### Task 9: Docs and release notes

**Files:**

- Modify: `docs/architecture/LOOT.md`, `docs/architecture/TABLE-FEATURES.md`, `docs/architecture/STATE-AND-RESILIENCE.md` (snapshot chat source), `docs/BUILD-STATUS.md`, `CHANGELOG.md` (`## [Unreleased]`), `ROADMAP.md` (parts 1 to 3 built, unverified)

- [ ] **Step 1:** Update each doc to match: who sees which loot, party take/return by any player, filters and defaults, chat source and paging (with the Mermaid flow in TABLE-FEATURES if one exists there), card rebuild, and the limits (removed loot is not restored; reconnect drops older pages).
- [ ] **Step 2:** CHANGELOG `## [Unreleased]`: **Fixed** chat and its cards survive a server restart; **Added** scroll up for older chat; **Changed** loot filters and defaults, players see only available, party and their own items, any player can take from the party stash, Give is a menu, chat-card buttons show without opening.
- [ ] **Step 3:** Run `npx prettier --check` on the changed docs and `npm test --workspaces --if-present`; all pass.
- [ ] **Step 4: Commit** `docs: loot visibility, filters and chat history`
