# Campaign rename and description — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DM can rename a campaign and give it a markdown description from the desktop app's Campaign settings tab; every member sees the description there.

**Architecture:** One new column (`campaigns.description`), a DM-only `PATCH /api/campaigns/:id`, and the existing campaign list (`GET /api/campaigns`, which already returns whole `Campaign` objects and feeds the app's `status.campaigns`) carries the new field. The panels edit it with the existing `MarkdownEditor` and show it with the existing `MarkdownView`. The invite page ([plan 3](2026-11-15-invite-page.md)) consumes it.

**Tech Stack:** TypeScript, Express, Postgres migration, vitest; Rust (`src-tauri/src/account.rs` struct only); React + Radix + Zustand (panels-ui).

**Spec:** [2026-11-15-email-and-invites-design.md](../specs/2026-11-15-email-and-invites-design.md)

## Global Constraints

- Description: markdown, **max 4,000 characters** after trimming; name rules unchanged (1-120 characters, trimmed).
- Control characters and bidirectional overrides are stripped from both fields (as for device labels and sign-up requests; reuse the existing helper, `grep -rn "bidi\|cleanDeviceLabel" backend/src`).
- Markdown rendering drops raw HTML, shows no images, shows links as text (the existing `MarkdownView` rules).
- DM-only edit, enforced on the server (`requireDm`); players and non-members get the same refusals as the other DM-only routes.
- A wire change: bump nothing here; the release is cut separately (MINOR, see the spec). Add `CHANGELOG.md` `## [Unreleased]` lines.
- Edit surface: the desktop app only. The phone web app is not changed in this plan.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A name of only spaces, or 121 characters, is refused; an emoji-heavy 4,000-character description is accepted (count code points, not bytes).
- An old client sends `PATCH` with only `name`: the description is left alone (partial update).
- Two members' open clients: after a rename the other client shows the new name without a restart.
- A description containing `<script>`, an `![img](http://…)` or a `javascript:` link renders as inert text.
- Empty string clears the description; `null` is rejected.

---

### Task 1: Store the description

**Files:**

- Create: `backend/migrations/0034_campaign_description.sql`
- Modify: `backend/src/types/index.ts:28` (`Campaign.description: string`), `backend/src/lib/store/postgresStore.ts:108,385-387` (row mapper, `putCampaign`), `backend/src/lib/store/memoryStore.ts` (nothing structural if it stores the object; check `listOpenCampaigns`), `backend/src/lib/campaigns/campaignService.ts:46` (`createCampaign` sets `description: ''`), `backend/src/consts/index.ts` (`CAMPAIGN_DESCRIPTION_MAX = 4000`, `CAMPAIGN_NAME_MAX = 120`)
- Test: `backend/src/lib/store/store.contract.test.ts` (runs against both stores)

**Interfaces:**

- Produces: `Campaign.description: string` (never undefined; `''` when none); migration `ALTER TABLE campaigns ADD COLUMN description TEXT NOT NULL DEFAULT ''` plus `CHECK (char_length(description) <= 4000)`.

- [ ] **Step 1: Failing contract test:** `putCampaign` then `getCampaign` round-trips a description; a campaign written without one reads back `''`.
- [ ] **Step 2: Run** `npm test -w backend -- store.contract` → FAIL (type error / missing column).
- [ ] **Step 3: Implement** the migration, type, mappers, and constants; fix every TypeScript error the new required field raises (`grep -rn "putCampaign\|allowJoin: " backend/src ai/src`).
- [ ] **Step 4: Run** `npm test -w backend` and `npm run typecheck` (whatever the root script is called) → PASS.
- [ ] **Step 5: Commit** `feat(backend): campaigns have a description`.

### Task 2: The update rule

**Files:**

- Modify: `backend/src/lib/campaigns/campaignService.ts` (add method; extract the name check out of `createCampaign` into a private `cleanName`)
- Test: `backend/src/lib/campaigns/campaignDetails.test.ts` (new; model on `starterCampaign.test.ts`)

**Interfaces:**

- Produces: `CampaignService.updateCampaign(actor: User, campaignId: string, patch: { name?: string; description?: string }): Promise<Campaign>`. Requires the DM (`requireDm`); trims both; name 1-120 else `DomainError('invalid_input', 'campaign name must be 1–120 characters')`; description ≤ 4,000 code points else `invalid_input`; fields not in the patch are unchanged; returns the stored campaign.

- [ ] **Step 1: Failing tests:** DM renames; DM sets and clears a description; a player gets `forbidden`; a patch with neither field is `invalid_input`; whitespace-only name refused; 4,001-character description refused, 4,000 accepted; `name`-only patch keeps the description; control characters stripped.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `updateCampaign` (read-modify-write inside `store.transaction`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(backend): DM can rename a campaign and edit its description`.

### Task 3: The HTTP route

**Files:**

- Modify: `backend/src/lib/http/campaignRoutes.ts` (new `patchBody` zod schema next to `createBody`; `router.patch('/:id', …)`)
- Test: `backend/src/lib/http/accessMatrix.test.ts` (add rows), `backend/src/lib/http/http.test.ts` or a new `campaignDetailsRoutes.test.ts`

**Interfaces:**

- Produces: `PATCH /api/campaigns/:id` body `{ name?: string (max 200), description?: string (max 20000, the service enforces 4,000 so the message is the friendly one) }` → `200 { campaign }`. After success call `onRosterChanged?.(campaignId)` (Task 4 checks that this reaches other clients; if it does not, add a dedicated announce there).

- [ ] **Step 1: Failing tests:** DM `PATCH` → 200 and the new name appears in `GET /api/campaigns`; player → 403; non-member → the same refusal the matrix gives other member-only routes; unauthenticated → 401; description over the limit → 400 `invalid_input`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the route.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(backend): PATCH /api/campaigns/:id`.

### Task 4: Other clients notice the change

**Files:**

- Inspect: `backend/src/lib/app.ts:155` (`rosterChanged` → `realtime.announceRosterChanged`), `tauri-client/rust-sync/` (what a roster-changed frame makes the client do), `tauri-client/src-tauri/src/account.rs` (the campaign list and where `allow_join`/`name` are parsed)
- Modify: `account.rs` (add `description: String` with `#[serde(default)]` to the campaign struct so it is forwarded to the panels; add the field to `tauri-client/panels-ui/src/types/index.ts` `Campaign`)
- Test: a Rust unit test parsing a campaign JSON without `description` (defaults to `""`) and with one; panels type test if the project has one.

**Interfaces:**

- Produces: `status.campaigns[i].description: string` in panels-ui.

- [ ] **Step 1: Read** what a roster-changed announcement triggers on the client. If it refreshes the campaign list (`account.addCampaign('refresh', '')` is the panels' own refresh), nothing more is needed; if it only refreshes members, extend the client to refresh campaigns on that frame (smallest change in `rust-sync`/`account.rs`), and say which you did in the commit.
- [ ] **Step 2: Failing Rust test** for the serde default; run `cargo test -p <crate>` from `tauri-client/` → FAIL.
- [ ] **Step 3: Implement** the struct field and TS type.
- [ ] **Step 4: Run** `cargo test`, `cargo clippy`, `npm test -w tauri-client/panels-ui` → PASS.
- [ ] **Step 5: Commit** `feat(client): campaign description reaches the panels`.

### Task 5: Edit and show it in Settings → Campaign

**Files:**

- Create: `tauri-client/panels-ui/src/components/settings/CampaignDetails.tsx`, `tauri-client/panels-ui/src/lib/campaignDetails.ts`
- Modify: `tauri-client/panels-ui/src/components/settings/CampaignSection.tsx:41-45` (replace the bold name heading with `<CampaignDetails campaign={campaign} dm={dm} />`), `tauri-client/panels-ui/src/lib/tauriBridge.ts` (see below), styles in `styles/`
- Test: `tauri-client/panels-ui/src/lib/campaignDetails.test.ts`

**Interfaces:**

- Consumes: `campaignApi` (`tauriBridge.ts:183`; it is scoped to the current campaign, so `campaignApi('PATCH', '', body)` must hit `/api/campaigns/:id`; confirm Rust's `campaign_api` accepts an empty path and add that if it does not), `MarkdownEditor`, `MarkdownView`.
- Produces: `validateDetails(name: string, description: string): { ok: true } | { ok: false; message: string }` in `lib/campaignDetails.ts` (name 1-120 trimmed; description ≤ 4,000 code points; messages match the server's); `CampaignDetails` — players: name + rendered description (or "No description yet."); the DM: the same plus an **Edit** button that swaps in a name field, the markdown editor, a live character counter, **Save** / **Cancel**, and a line "Everyone with an invite link can read this." Save calls `campaignApi('PATCH', '', { name, description })`, then `account.addCampaign('refresh', '')`; errors show through `accountErrorMessage`.

- [ ] **Step 1: Failing tests** for `validateDetails`: empty / spaces-only / 121-char name, 4,000 vs 4,001 character description (use a string of 2,000 emoji to prove code points are counted).
- [ ] **Step 2: Run** `npm test -w tauri-client/panels-ui -- campaignDetails` → FAIL.
- [ ] **Step 3: Implement** `lib/campaignDetails.ts` then the component, following the neighbouring `vtt-session` section styles; light/dark via existing tokens; usable by keyboard.
- [ ] **Step 4: Run** the panels tests, lint and `npm run build -w tauri-client/panels-ui`; then run the app (`npm run app`, the `run` skill) as a DM: rename, edit the description, save, reopen Settings; as a player in a second session: confirm it shows and no Edit button exists.
- [ ] **Step 5: Commit** `feat(client): edit a campaign's name and description in Settings`.

### Task 6: Documentation

**Files:**

- Modify: `docs/architecture/TABLE-FEATURES.md` (or the campaign doc that lists campaign fields: `grep -rn "allowJoin\|allow_join" docs`), `docs/architecture/SYNC-PROTOCOL.md` only if the REST list there names campaign routes, `CHANGELOG.md` `## [Unreleased]`, `docs/BUILD-STATUS.md` (built; app flow verified or not, say which).

- [ ] **Step 1:** Make the edits; CHANGELOG under Added: "A DM can rename the campaign and write a markdown description in Settings → Campaign (up to 4,000 characters)".
- [ ] **Step 2:** `npx prettier --check` the changed Markdown; commit `docs: campaign name and description`.
