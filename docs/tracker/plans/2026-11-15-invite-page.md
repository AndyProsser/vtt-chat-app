# Group invite links: details on the page and Open Graph previews — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DM pastes one invite into a group chat; the link unfurls with the campaign's name, DM and blurb; the page it opens shows the campaign's details above the sign-in / create-account form.

**Architecture:** `GET /api/invites/:code` grows from `{campaignName, consentVersion}` to include the DM's display name, the player count and the description. The server answers `GET /join/:code` with `index.html` plus per-invite `<meta og:*>` tags injected (HTML-escaped; generic tags when the code is bad or rate-limited), and serves a fixed `/og-banner.jpg`. The desktop app's invite section gets a **Copy invite message** action.

**Tech Stack:** TypeScript, Express, vitest; React + Radix (web, `JoinPage`); React + Zustand (panels-ui); ImageMagick (existing banner script).

**Spec:** [2026-11-15-email-and-invites-design.md](../specs/2026-11-15-email-and-invites-design.md). **Depends on** [campaign details](2026-11-15-campaign-details.md) (the `description` field).

## Global Constraints

- The invite page shows the **full** description (markdown, `skipHtml`, no images, links as text). The Open Graph tags carry **only**: campaign name, DM display name, first 160 characters of the description reduced to plain text (markdown syntax stripped, whitespace collapsed, ellipsis if cut).
- A bad, expired or revoked code looks identical everywhere (`invite_invalid`; generic OG tags), so the endpoint cannot be used to probe codes. Crawlers must never receive a 429: when the limiter trips, serve the generic page.
- Every value placed into HTML goes through one escaping function; attribute values are double-quoted.
- `og:image` and `og:url` are absolute and built from `PUBLIC_URL`; when it is unset, omit those two tags (the page still works).
- Banner: 1100×576 (about 1.91:1) JPEG, **≤ 120 KB** (WhatsApp ignores images over about 300 KB), served at `/og-banner.jpg` from a fixed-list route like the install files in `webPages`.
- The CSP the page already sends is not loosened.
- Light/dark follows the OS; keep to the existing web styles.
- `CHANGELOG.md` `## [Unreleased]` and docs in the same change. Do not cut a release.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A description or campaign name containing `"`, `<`, `&` or a newline must not break out of a `content="…"` attribute.
- A campaign with no description: the OG blurb falls back to a fixed line ("Join the table on VTT Chat."), and the page shows no empty "About" block.
- A campaign whose DM account has no display name, or no DM at all mid-swap: the page and tags omit the DM line rather than printing "undefined".
- A crawler fetches `/join/<code>` dozens of times from one shared Cloudflare address: it still gets the preview.
- The invite expires after the link was unfurled: the cached preview may linger in the chat, but the page itself says the invite is no longer valid.

---

### Task 1: A richer invite preview

**Files:**

- Modify: `backend/src/lib/campaigns/campaignService.ts:101-111` (`previewInvite`), `backend/src/lib/store/store.ts` only if a count helper is needed (prefer `listMemberships`)
- Test: `backend/src/lib/campaigns/campaignDetails.test.ts` (from plan 2) or a new `invitePreview.test.ts`, `backend/src/lib/http/joinRoutes.test.ts`

**Interfaces:**

- Produces: `InvitePreview = { campaignName: string; consentVersion: string; description: string; dmName: string | null; playerCount: number }`; `previewInvite(code): Promise<InvitePreview>` (`dmName` is the DM's display name; `playerCount` counts non-DM members). The HTTP body of `GET /api/invites/:code` is exactly this object. Export the type from `backend/src/types/index.ts`.

- [ ] **Step 1: Failing tests:** a good code returns all five fields for a campaign with a DM and two players; no description gives `''`; a campaign with no DM gives `dmName: null`; a bad / expired / revoked code still throws `invite_invalid`; the response contains no user ids or emails (assert the key set).
- [ ] **Step 2: Run** `npm test -w backend -- invite` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(backend): the invite preview carries the campaign's details`.

### Task 2: Open Graph rendering

**Files:**

- Create: `backend/src/lib/http/ogTags.ts`
- Test: `backend/src/lib/http/ogTags.test.ts`

**Interfaces:**

- Produces: `plainBlurb(markdown: string, max?: number): string` (default 160; strips `# * _ \` > [](<>)`syntax and`![](…)`, collapses whitespace, cuts on a word boundary with `…`); `escapeAttr(s: string): string`(shared with email's`escapeHtml`if plan 1's`backend/src/lib/mail/escape.ts`exists: import it, do not duplicate);`ogMetaTags(input: { preview: InvitePreview | null; publicUrl: string | undefined; path: string }): string`— a string of`<meta>`and`<title>`lines. With a preview:`og:type`website,`og:site_name`"VTT Chat",`og:title` `Join <name> on VTT Chat`, `og:description` `<DM> is running <name>. <blurb>`(DM clause omitted when`dmName`is null),`og:url`, `og:image`(+ width/height 1100/576, alt "A dragon guarding a glowing d20"),`twitter:card summary_large_image`, `<title>`. With `null`: the same tags with generic title "Join a table on VTT Chat" and the fallback blurb. `og:url`/`og:image`omitted without`publicUrl`.
- Constant: `OG_FALLBACK_BLURB = 'Join the table on VTT Chat.'` in `backend/src/consts/`.

- [ ] **Step 1: Failing tests:** `plainBlurb('# Hi **there**\n\n[a link](http://x) and ![img](http://y)')` → `'Hi there a link and'`; a 300-character input ends with `…` and is ≤ 161 characters; a name `Evil "><script>` yields no raw `<script>` or unescaped `"` in the output; `dmName: null` omits the DM clause; no `publicUrl` omits `og:image` and `og:url`; `null` preview yields the generic title.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(backend): Open Graph tags for invite links`.

### Task 3: Serve the tagged page and the banner

**Files:**

- Modify: `backend/src/lib/http/joinRoutes.ts` (`webPages(webDir)` → `webPages(webDir, options?)`; the `/join/:code` handler; `installFiles`), `backend/src/lib/app.ts` (pass `campaigns`, `publicUrl`, a new limiter), `scripts/build-email-banner.sh` (also write `web/public/og-banner.jpg`), `web/public/og-banner.jpg` (generated, committed)
- Test: `backend/src/lib/http/joinRoutes.test.ts`

**Interfaces:**

- Consumes: `ogMetaTags`, `CampaignService.previewInvite`.
- Produces: `webPages(webDir: string, options?: { campaigns: CampaignService; publicUrl: string | undefined; ogLimiter: RateLimiter }): Router | undefined`. `GET /join/:code`: read `index.html` (cache the string at start-up, re-read when the file's mtime changes), insert `ogMetaTags(...)` immediately before `</head>`, send with `Cache-Control: no-store` and the existing CSP. A bad code, a throw from `previewInvite`, or `ogLimiter` refusing (60/min per IP) → `ogMetaTags({ preview: null, ... })` with status 200. Other page paths keep `sendFile(index)`. `/og-banner.jpg` is added to `installFiles` as `image/jpeg`.

- [ ] **Step 1: Failing tests:** `GET /join/<good code>` → 200, body contains `og:title` with the campaign name and the original `<div id="root">`; `GET /join/nope` → 200 with the generic title and nothing campaign-specific; 70 rapid requests all return 200; `GET /og-banner.jpg` → 200 `image/jpeg`; the response still carries the CSP header; without `options` the route behaves as before.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; extend the script to emit the OG banner (crop `1100x576+0+20`, quality stepped down to ≤ 120 KB), run it, and view the result once.
- [ ] **Step 4: Run** `npm test -w backend` → PASS.
- [ ] **Step 5: Commit** `feat(backend): link previews for /join/<code>`.

### Task 4: The invite page shows the details

**Files:**

- Modify: `web/src/types/index.ts` (the `Invite` type), `web/src/hooks/useInvite.ts`, `web/src/components/JoinPage.tsx:51-66`
- Create: `web/src/components/CampaignCard.tsx`
- Test: `web/src/hooks/useInvite.test.ts` if present, else extend `web/e2e/ui-smoke.mjs`

**Interfaces:**

- Consumes: `GET /api/invites/:code` → `InvitePreview`; the lazy markdown view (`web/src/components/phone/LazyMarkdown.tsx` / `MarkdownView.tsx`, or a shared copy; do not pull `react-markdown` into the first bundle).
- Produces: `CampaignCard({ invite }: { invite: InvitePreview })` — campaign name as the heading, "Run by <DM>" and "<n> players" lines (each omitted when unknown or zero), the description under an **About this campaign** heading (omitted when empty). Replaces the single "You've been invited to …" sentence; the account form (sign in or create) stays directly beneath.

- [ ] **Step 1: Failing check:** in `ui-smoke.mjs` (the mock server it uses), an invite with a description renders the heading, the DM line and the description text; an invite with none renders no "About" block. (Use a vitest component test instead if the web package has a DOM test setup.)
- [ ] **Step 2: Run** the smoke script (see `DEVELOPING.md`) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the smoke script, `npm test -w web`, lint, build; check the page at phone width and in dark mode.
- [ ] **Step 5: Commit** `feat(web): the invite page tells people what they are joining`.

### Task 5: Copy invite message in the app

**Files:**

- Modify: `tauri-client/panels-ui/src/lib/invites.ts`, `tauri-client/panels-ui/src/components/settings/CampaignSection.tsx:48-75`
- Test: `tauri-client/panels-ui/src/lib/invites.test.ts`

**Interfaces:**

- Produces: `inviteMessage(input: { campaignName: string; dmName: string | undefined; link: string }): string` → two lines: `You're invited to join <campaignName> on VTT Chat` (with ` — run by <dmName>` when known) and the link on its own line, so every chat app auto-links it. The DM's name comes from `members` in the table store (the DM's `displayName`).
- In the UI: after **Make an invite link**, show the link row as today plus a primary **Copy invite message** button that copies `inviteMessage(...)` and confirms with "Copied" for two seconds; keep the plain "Copy the link" button. Add one line of help: "Paste it into your group chat. Everyone with the link can join until it expires (7 days)": the number comes from the invite's `expiresAt` returned by the API (it is currently discarded: keep it in state).

- [ ] **Step 1: Failing tests:** `inviteMessage` with and without a DM name; the link is on its own final line; a name with a trailing space is trimmed.
- [ ] **Step 2: Run** `npm test -w tauri-client/panels-ui -- invites` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, lint, build; run the app as a DM and paste the message into a text editor.
- [ ] **Step 5: Commit** `feat(client): copy a ready-to-paste invite message`.

### Task 6: Documentation

**Files:**

- Modify: `docs/architecture/JOIN-FLOW.md` (the "What the page may learn and do" section now says "the campaign name … nothing else": update it to the new fields and add the privacy reasoning and the Open Graph behaviour, with a Mermaid diagram of crawler → `/join/:code` → tags), `docs/guides/OPERATOR-GUIDE.md` (`PUBLIC_URL` also drives link previews; behind Cloudflare a shared-IP crawler is fine), `CHANGELOG.md` `## [Unreleased]`, `docs/BUILD-STATUS.md`.

- [ ] **Step 1:** Make the edits; the CHANGELOG says what a player sees (the campaign's details on the invite page, a preview in chat apps) and the Known-limits line: a preview already cached by a chat app does not update until it re-fetches.
- [ ] **Step 2:** `npx prettier --check` the changed Markdown; commit `docs: invite page details and link previews`.

### Task 7: Prove the preview with a real chat app (needs Andy, after deploy)

- [ ] **Step 1:** With `PUBLIC_URL` set on the VM (plan 1, Task 8), create an invite in the app, paste the message into a private Discord channel and a WhatsApp chat of Andy's choosing; expected: a card with the dragon banner, "Join <name> on VTT Chat" and the blurb.
- [ ] **Step 2:** Open the link on a phone off the LAN, create an account, join; expected: the campaign details above the form, then the usual Get-the-app step. Record the result in `docs/BUILD-STATUS.md`.
