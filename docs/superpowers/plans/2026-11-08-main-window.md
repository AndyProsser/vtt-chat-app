# Main Window Implementation Plan (spec steps 1–4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nine tray panels with one compact RPG-themed main window (rail, chat, DM drawer, top/bottom bars) plus Settings, Handouts and Party-inventory windows, a badged tray icon, five themes and a chat-only Connect/Disconnect mode.

**Architecture:** Rust keeps owning audio, the server link and the tray; the webview stays a cache fed by `sync:event` and `livekit:*` events. The UI is a set of small React components over pure, unit-tested model functions (timeline, commands, rail order, themes). Themes are CSS-variable tables generated from one TS table; light/dark follows the OS.

**Tech Stack:** Tauri 2.12, Rust (cargo workspace in `tauri-client/`), React 19 + Radix Themes + Zustand, TypeScript 7, vitest, `@fontsource/cinzel` (bundled font), Node backend for one small field.

**Spec:** [docs/superpowers/specs/2026-11-08-main-window-design.md](../specs/2026-11-08-main-window-design.md)

**Not in this plan (separate plans, in this order):** spec step 5 (party-inventory `claimed_for`, coin items, split), spec step 6 (DM voice effect in Rust). Also deferred and flagged: the Audio tab of Settings (no device selection exists in `rust-livekit` yet, and the spec forbids controls that do nothing), recording history, drag-avatar-to-group (Groups menu only), remembering the Connect/Disconnect choice across restarts.

## Global Constraints

- Work on branch `feat/main-window`; commit per task; every commit ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push or merge unasked. LF line endings.
- TypeScript only (no plain JS); React + Radix Themes + Zustand; per-module folders `components/ hooks/ consts/ types/ styles/ lib/` — no logic in components beyond wiring; pure logic in `lib/` with a `*.test.ts` beside it.
- Rust owns audio and HTTP; the webview CSP allows no remote origins (fonts and images are bundled or `data:`).
- Light/dark follows the OS by default. Rounded avatars (`border-radius: 50%`) and softened corners on every control; the **DM drawer pills are the exception: square (`border-radius: 2px`)**.
- Nothing runs while the window is closed or hidden: no timers outside open windows; the REC timer ticks only while a recording exists. Glow animation only on the speaking ring.
- Colour is never the only signal (whisper/DM messages are also labelled).
- No dice, conditions, environment, initiative or character-sheet features; no per-party text chat.
- Never print secrets. `docs/archive/` untouched.
- Verification commands: `npm run typecheck -w @vtt-chat-app/panels-ui`, `npm test -w @vtt-chat-app/panels-ui`, `npx eslint tauri-client/panels-ui`, `cd tauri-client && cargo test -p src-tauri -p rust-sync && cargo clippy -p src-tauri`, `npm test -w @vtt-chat-app/backend`. A stale `target/` can cause a bogus rustc ICE; `cargo clean` fixes it.

## Review Focus

1. **Chat-only mode:** after Disconnect, mute toggle (tray, hotkey, button) and the tray state must not panic or error with no voice client — test `Task 5`.
2. **Clock skew / bad `startedAt`:** a recording whose start is in the future or missing shows `00:00:00`, never a negative or `NaN` timer — test `Task 2`.
3. **Unknown/garbled stored theme or throwing `localStorage`:** falls back to Dragonfire — test `Task 3`.
4. **Member with no character:** hover card shows only the account name and role, no "undefined" lines — test `Task 8`.
5. **Typed garbage in chat:** `/w nobody hi`, `/w alice` (no text), `/unknown`, and a lone `/` give a visible error and send nothing; a normal message that merely contains `/` mid-text is sent — test `Task 9`.
6. **A speaking identity not in the roster** (stale or the DM's egress bot) does not crash or add a rail entry — test `Task 8`.
7. **Replaying the hydration tail over live events** never duplicates loot/handout cards — test `Task 13`.

---

### Task 0: Branch and the uncommitted icon work

**Files:** Modify (already changed, uncommitted): `tauri-client/src-tauri/icons/*`, `tauri-client/src-tauri/Cargo.toml`, `tauri-client/src-tauri/src/windows.rs`, `tauri-client/panels-ui/index.html`, `tauri-client/panels-ui/public/favicon.*`.

- [ ] **Step 1:** `git checkout -b feat/main-window`; run `git status` and confirm only the icon files above are modified (`.superpowers/` is ignored).
- [ ] **Step 2:** `cargo build -p src-tauri` and `npm run build -w @vtt-chat-app/panels-ui` succeed.
- [ ] **Step 3: Commit** `feat(client): app and window icons from the original frontend`.

### Task 1: NVIDIA/Wayland startup fix

**Files:** Create `tauri-client/src-tauri/src/platform.rs`; modify `src-tauri/src/lib.rs` (`mod platform;`, call at the top of `run()`), `DEVELOPING.md` (Known issues).

**Interfaces — Produces:** `pub fn webkit_env_fixes(linux: bool, is_set: impl Fn(&str) -> bool) -> Vec<(&'static str, &'static str)>` and `pub fn apply_platform_fixes()`.

- [ ] **Step 1: Failing tests** in `platform.rs`: `no_fixes_off_linux` (`linux=false` → empty); `respects_a_value_the_user_set` (`is_set("WEBKIT_DISABLE_DMABUF_RENDERER")==true` → empty); `sets_the_dmabuf_workaround_on_linux` (→ exactly `[("WEBKIT_DISABLE_DMABUF_RENDERER","1")]`).
- [ ] **Step 2:** `cargo test -p src-tauri platform` → FAIL (unresolved).
- [ ] **Step 3:** Implement both functions; `apply_platform_fixes` passes `cfg!(target_os="linux")` and `std::env::var_os(..).is_some()` and sets each var with `std::env::set_var` (wrap in `unsafe` only if the crate's edition requires it; it runs first in `run()`, before any thread starts). Why-comment: protocol error 71 on NVIDIA under Wayland kills the first webview.
- [ ] **Step 4:** tests PASS; add a "Known issues" entry in `DEVELOPING.md` naming the symptom (`Gdk Error 71`), the variable, and the `GDK_BACKEND=x11` fallback.
- [ ] **Step 5: Commit** `fix(client): disable the WebKit dmabuf renderer on Linux (NVIDIA/Wayland crash)`.

### Task 2: Recording start time end to end (for the timer)

**Files:** Modify `backend/src/lib/recording/recordingState.ts` (+`recordingState.test.ts`), `backend/src/lib/realtime/hub.ts` (frames at ~L195 and ~L798), `backend/src/lib/realtime/wsServer.test.ts`; `tauri-client/rust-sync/src/protocol.rs` (`RecordingInfo`, `ServerEvent::RecordingStatus`, `recording_status` helper, tests); `src-tauri/src/bridge.rs` (+ its test); `panels-ui/src/types/index.ts`, `lib/tableModel.ts` (+test); create `panels-ui/src/lib/elapsed.ts` (+`elapsed.test.ts`); update docs/architecture/SYNC-PROTOCOL.md frame rows.

**Interfaces — Produces:**
- Backend frames: `recording.status` and `recording.state.recording` gain `startedAt: number` (epoch ms, server clock). `RecordingState` takes an injectable `now: () => number = Date.now`; `RecordingChange.startedAt: number`; `current()` returns `startedAt`.
- Rust: `RecordingInfo.started_at: Option<u64>`; `ServerEvent::RecordingStatus { …, started_at: Option<u64> }`; bridge JSON `startedAt` (number or null).
- TS: `RecordingView.startedAt: number | null`; `export function formatElapsed(ms: number): string`; `export function elapsedSince(startedAt: number | null, now: number): number` (never negative).

- [ ] **Step 1: Failing tests:** backend `start() records startedAt from the injected clock` (clock 1000 → `change.startedAt === 1000`, `current().startedAt === 1000`, unchanged after pause/resume); ws test: `recording.state` for a viewer includes `startedAt`; Rust protocol test: a `recording.state`/`recording.status` JSON with `startedAt: 1000` decodes to `Some(1000)` and without it to `None`; bridge test: forwarded `d.startedAt`; TS: `formatElapsed(0)==='00:00:00'`, `formatElapsed(3_723_000)==='01:02:03'`, `formatElapsed(-5)==='00:00:00'`, `elapsedSince(null, 5)===0`, `elapsedSince(2000, 1000)===0`, and `applyEvent` of `recording.state`/`recording.status` STARTED stores `startedAt`.
- [ ] **Step 2:** run the three suites → FAIL.
- [ ] **Step 3:** Implement as per Interfaces. A `PAUSED`/`RESUMED` status carries the same `startedAt`; the model keeps the prior value if an event lacks it. The timer is wall clock since start (paused time included; the bar says PAUSED) — **my call**.
- [ ] **Step 4:** all suites PASS. **Step 5: Commit** `feat(recording): carry the start time to clients for the timer`.

### Task 3: Theme tokens, five themes, OS-following appearance, bundled font

**Files:** Create `panels-ui/src/lib/contrast.ts`, `lib/themes.ts`, `lib/themeStore.ts`, `hooks/useSystemAppearance.ts`, `styles/tokens.css`, tests `lib/contrast.test.ts`, `lib/themes.test.ts`; modify `src/main.tsx`, `styles/theme.css`, `package.json` (`@fontsource/cinzel`).

**Interfaces — Produces:**
```ts
export type ThemeId = 'dragonfire' | 'arcane' | 'dungeon' | 'verdant' | 'frostbound';
export interface Palette { bg; bar; rail; chat; bubble; edge; ink; gold; glow; avatar; whisper; whisperEdge; dmMsg: string } // all '#rrggbb'
export interface Theme { id: ThemeId; name: string; dark: Palette; light: Palette }
export const THEMES: readonly Theme[];            // order: dragonfire, arcane, dungeon, verdant, frostbound
export const DEFAULT_THEME: ThemeId;              // 'dragonfire'
export function resolveTheme(id: string | null | undefined): ThemeId;   // unknown → DEFAULT_THEME
export function themeCss(themes?: readonly Theme[]): string;
export function contrastRatio(a: string, b: string): number;            // WCAG
export const useThemeStore;                       // { themeId, setTheme(id) }
export function useSystemAppearance(): 'light' | 'dark';
```
CSS variables are `--vtt-<kebab key>` (e.g. `--vtt-whisper-edge`). `themeCss` emits per theme the light palette under `:root[data-theme="<id>"]` and the dark palette under `@media (prefers-color-scheme: dark){:root[data-theme="<id>"]{…}}`. Shape tokens (shared by all themes) in `tokens.css`: `--vtt-radius-control: 8px; --vtt-radius-bubble: 12px; --vtt-radius-pill-square: 2px; --vtt-avatar-radius: 50%`, and `--vtt-font-head: 'Cinzel', Georgia, serif`.

- [ ] **Step 1: Failing tests.** `contrast.test.ts`: `contrastRatio('#000000','#ffffff')` ≈ 21 (±0.1); `('#777777','#777777') === 1`. `themes.test.ts`: for every theme and both variants `contrastRatio(ink, bg|bar|bubble|whisper|dmMsg) >= 4.5` and `contrastRatio(gold, bar) >= 3`; `THEMES.map(t=>t.id)` equals the five ids; `resolveTheme('nope')==='dragonfire'`, `resolveTheme(null)==='dragonfire'`, `resolveTheme('arcane')==='arcane'`; `themeCss()` contains, for each id, `:root[data-theme="<id>"]` and a `prefers-color-scheme: dark` block; `useThemeStore.getState().setTheme('arcane')` sets `document.documentElement.dataset.theme === 'arcane'` and survives a throwing `localStorage` (mock `Storage.prototype.setItem` to throw → no exception, attribute still set).
- [ ] **Step 2:** `npm test -w @vtt-chat-app/panels-ui` → FAIL.
- [ ] **Step 3: Implement.** Dragonfire dark = charcoal/ember: bg `#1a1412`, bar `#241a16`, rail `#1e1613`, chat `#171110`, bubble `#2a1f1a`, edge `#4a3326`, ink `#eadfd2`, gold `#d9a441`, glow `#ff7a2f`, avatar `#6b2a1c`, whisper `#2c2038`, whisperEdge `#7b4fd1`, dmMsg `#33261a`; Dragonfire light = parchment: bg `#efe3c8`, bar `#e2d0a8`, rail `#e8d9b5`, chat `#f4ead2`, bubble `#fbf4e2`, edge `#a98a54`, ink `#3a2a18`, gold `#8a5a12`, glow `#c8501a`, avatar `#8a3b22`, whisper `#efe0f5`, whisperEdge `#7b4fd1`, dmMsg `#fbe7bd`. Arcane (indigo+gold) and Dungeon (grey-green) dark values come from the approved mockup (`.superpowers/brainstorm/*/content/theme-and-tray.html`); **Verdant** (forest green) and **Frostbound** (cold blue-silver) are the builder's choice; every light variant is derived to pass the contrast test (adjust values until it does, never loosen the test). Store persists `localStorage['vtt.theme']` in try/catch and reads it with `resolveTheme`. `useSystemAppearance` subscribes to `matchMedia('(prefers-color-scheme: dark)')` and cleans up. `main.tsx`: inject `themeCss()` in a `<style>`, import `@fontsource/cinzel/600.css` and `tokens.css`, set `data-theme` from the store, and pass `appearance={useSystemAppearance()}` to Radix `<Theme>` (the current `appearance="inherit"` does not follow the OS — **this is the likely cause of the "dark/light must match system" report; confirm in Step 5**).
- [ ] **Step 4:** tests PASS; `npm run build -w @vtt-chat-app/panels-ui` shows the font emitted as a local asset (no remote URL in `dist/`).
- [ ] **Step 5:** manual: with the app running, toggle the OS light/dark setting; the window follows with no reload. **Step 6: Commit** `feat(panels): five themes as tokens, OS-following appearance, bundled heading font`.

### Task 4: One main window plus the three secondary windows

**Files:** Modify `src-tauri/src/windows.rs`, `src-tauri/src/tray.rs` (menu + click only), `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/permissions/allow-app-commands.toml`; `panels-ui/src/consts/index.ts`, `components/PanelRoot.tsx`; create `components/MainWindow.tsx` (empty grid shell: `TopBar`/`AvatarRail`/`ChatView`/`BottomBar` slots rendered as titled placeholders), test `components/PanelRoot.test.ts` (pure `panelFromHash`).

**Interfaces — Produces:** Rust `windows::open_main(app: &AppHandle) -> Result<(), String>` (label `main`, URL `index.html#main`, default 460×640 logical, min 380×420, title "VTT Chat"; shows and focuses if it exists); `PANELS` is exactly `settings` (440×580), `handouts` (420×540), `inventory` (400×520) with labels `panel-<name>`. TS `PANEL_NAMES = ['main','settings','handouts','inventory']`; `panelFromHash('')`, `('#chat')` and any unknown → `'main'`. Tray menu ids: `show`, `toggle_mute`, `toggle_voice`, `quit`; left-click on the tray icon calls `open_main`.

- [ ] **Step 1: Failing tests:** Rust `windows`: `secondary_panels_are_exactly_the_closed_set` (names == the three; `panel("chat")` and `panel("../etc")` are `None`; names unique); TS: `panelFromHash` cases above.
- [ ] **Step 2:** run both → FAIL.
- [ ] **Step 3:** Implement. The capability's `windows` becomes `["main","panel-*"]`. Closing a window destroys it (nothing hidden is running); `ExitRequested` still does not quit. The app opens the main window on launch (**my call**). Remove the old tray items (Table, Chat, Handouts, Loot, Sessions, Soundboard, Voice groups, Recording, Account). `PanelRoot` routes `main`→`MainWindow`, `settings`/`handouts`/`inventory`→ the existing `AccountPanel` (temporary, replaced in Task 12) / `HandoutsPanel` / `LootPanel`.
- [ ] **Step 4:** tests PASS; `cargo clippy -p src-tauri` clean apart from `capture_allowed`. Run the app: the main window opens, the tray menu has four items, closing the window leaves the tray.
- [ ] **Step 5: Commit** `feat(client): a single main window; tray reduced to show, mute, voice, quit`.

### Task 5: Connect / Disconnect voice (chat-only mode)

**Files:** Modify `src-tauri/src/commands.rs`, `src-tauri/src/account_commands.rs`, `src-tauri/src/lib.rs` (register), `permissions/allow-app-commands.toml`, `src-tauri/src/tray.rs` (`toggle_voice` handler), `src-tauri/src/hotkeys.rs` (only if mute without a client unwraps); `panels-ui/src/lib/tauriBridge.ts`; create `panels-ui/src/lib/voice.ts` (+`voice.test.ts`), `hooks/useVoice.ts`.

**Interfaces — Produces:** Rust `#[tauri::command] voice_connect(app, accounts: State<AccountState>) -> Result<(), String>` — no-op `Ok` if a client already exists; otherwise `accounts.credentials()` → `AccountClient::voice_token` → `commands::connect_voice`; error text is user-presentable. `voice_disconnect` = the existing `livekit_disconnect` (also announces `inVoice:false`). TS `voiceConnect(): Promise<void>`, `voiceDisconnect(): Promise<void>`, `export function nextVoiceAction(connected: boolean, busy: boolean): 'connect' | 'disconnect' | 'wait'`, `useVoice(): { connected: boolean; busy: boolean; toggle(): Promise<void>; error?: string }`.

- [ ] **Step 1: Failing tests:** `nextVoiceAction(false,false)==='connect'`, `(true,false)==='disconnect'`, `(*,true)==='wait'`. Rust: read `hotkeys::push_mute_to_client` and the mute path; add a test that muting/unmuting with **no** `SharedClient` client set returns without panicking and still updates `MicGate`/tray state (Review Focus 1).
- [ ] **Step 2:** FAIL. **Step 3:** implement; the tray `toggle_voice` item connects or disconnects by whether `SharedClient` holds a client. Disconnect sets the tray to "connected, no voice" semantics already provided by `tray_state` (server link up, mic closed → Muted); do not invent a new tray state.
- [ ] **Step 4:** PASS; manual (backend running, signed in): Disconnect → chat still sends and receives; Connect → voice indicator returns.
- [ ] **Step 5: Commit** `feat(client): connect/disconnect voice independently of chat`.

### Task 6: Tray icon — logo with a status badge

**Files:** Modify `src-tauri/src/tray.rs` (rendering + tests); `src-tauri/Cargo.toml` only if a dependency is truly needed (prefer none).

**Interfaces:** `pub const ICON_SIZE: u32 = 64;` `pub fn render_icon(state: TrayState) -> Vec<u8>` (RGBA, `ICON_SIZE²·4` bytes, unchanged signature); new `fn downscale(rgba: &[u8], from: u32, to: u32) -> Vec<u8>` (box filter); the logo is `include_bytes!("../icons/icon-256.png")` decoded once (`OnceLock`) with `tauri::image::Image::from_bytes` (feature `image-png` already on). Badge: filled disc, diameter ≈ 40% of the icon, bottom-right, with a 2 px dark outline so it reads on light and dark panels. Colours reuse `TrayState::colour()` (live green `#2eb86c`, muted amber `#e0a12b`, recording/paused red `#e53935`, disconnected grey `#8a8f98`). Paused = ring only (hollow centre). Disconnected = logo desaturated (R=G=B on every opaque non-badge pixel) plus the grey badge.

- [ ] **Step 1: Failing tests** (replace the flat-disc ones; keep the `tray_state` and tooltip tests): `badge_centre_pixel_matches_each_state_colour`; `paused_badge_centre_differs_from_recording_badge_centre`; `disconnected_logo_is_grayscale` (sample every opaque pixel outside the badge box); `every_state_icon_differs`; `icon_is_right_size_and_has_transparent_corners` (top-left pixel alpha 0).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; view the four icons: write each `render_icon` to a PNG under the scratchpad in a throwaway test run and Read them (the badge must be readable at 22 px — also downscale to 22 and look).
- [ ] **Step 5: Commit** `feat(client): tray icon is the logo with a status badge`.

### Task 7: Top bar — record state, timer, DM controls, Connect, cog

**Files:** Create `components/TopBar.tsx`, `components/RecordingIndicator.tsx`, `hooks/useNow.ts`, `lib/recordingBar.ts` (+`recordingBar.test.ts`); modify `components/MainWindow.tsx`.

**Interfaces — Produces:** `export function recordingBar(recording: RecordingView | null, dm: boolean, now: number): { visible: boolean; label: string; paused: boolean; actions: RecordingAction[] }` — `visible` false when `recording===null`; `label` is `formatElapsed(elapsedSince(startedAt, now))`; `actions` = `recordingActions(recording)` for the DM (the DM also gets `['start']` when nothing records, with `visible:false`), `[]` for players. `useNow(active: boolean, intervalMs = 1000): number` — a ticking timestamp **only while `active`** (no interval otherwise).

- [ ] **Step 1: Failing tests** for `recordingBar`: player + recording → `{visible:true, actions:[]}`; DM + capturing → actions `['pause','stop']`; DM + paused → `['resume','stop']`; DM + none → `{visible:false, actions:['start']}`; label for `startedAt=now-65_000` is `00:01:05`; `startedAt` in the future → `00:00:00`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; `TopBar` = `RecordingIndicator` (● REC, timer, PAUSED tag; DM buttons call `recordingControl`) · spacer · Connect/Disconnect pill (`useVoice`) · cog (`panelOpen('settings')`). Use theme tokens; the buttons are rounded (`--vtt-radius-control`).
- [ ] **Step 4:** PASS; manual: start a recording as DM via the button; REC and a ticking timer appear, a second player view shows REC read-only. **Step 5: Commit** `feat(panels): top bar with recording timer and voice toggle`.

### Task 8: Avatar rail with speaking glow and hover card

**Files:** Create `components/AvatarRail.tsx`, `components/RailAvatar.tsx`, `components/MemberCard.tsx`, `lib/rail.ts` (+`rail.test.ts`); modify `types/index.ts` (`Member.character` gains optional `race`, `className`, `level`), `lib/tableModel.ts`, `styles/theme.css`; check the backend roster snapshot payload (`backend/src/lib/realtime/hub.ts` snapshot builder) and, if the DDB/character record already stores race/class/level, include them in the member's `character`; otherwise leave the card showing what exists.

**Interfaces — Produces:** `export function railOrder(members: Member[]): Member[]` — the DM first, then players sorted case-insensitively by `character?.name ?? displayName`, offline players last; `export function memberCard(m: Member): { title: string; lines: string[] }` — `title` = character name or display name; `lines` contains only fields that exist (`"Wood elf · Ranger 5"` style joined from whichever of race/className/level are present; the account name when a character exists; `"DM"` for the DM) — never the strings `undefined` or `null`.

- [ ] **Step 1: Failing tests:** `railOrder` puts the DM first with players alphabetical and offline last; `memberCard` for a member without a character → `{title: displayName, lines: []}` (+`["DM"]` for the DM); with only `className:'Ranger'` → `lines` has `"Ranger"`; a speaking identity absent from members is ignored (rail renders only roster members — assert via `railOrder` input, plus a component-free helper `speakingMembers(members, speaking: Set<string>): string[]`).
- [ ] **Step 2:** FAIL. **Step 3:** implement. `RailAvatar` is memoised and selects only its own speaking boolean (`useIsSpeaking(member.userId)` — LiveKit identity is the account id), draws the ring with `--vtt-glow`, a mute badge when `inVoice && muted`, faded when offline, gold ring for the DM, a party-colour pip when the member is in a voice group, initials from the name, and `title`/Radix `HoverCard` showing `MemberCard`. The rail scrolls vertically with long names truncated in the card, never in the rail.
- [ ] **Step 4:** PASS; manual: two sessions, speak in one, the avatar glows in the other. **Step 5: Commit** `feat(panels): avatar rail with speaking glow and character hover card`.

### Task 9: Chat view — avatars, colour-coded whispers, slash commands

**Files:** Create `components/ChatView.tsx`, `components/ChatMessage.tsx`, `components/Composer.tsx`, `components/CommandPalette.tsx`, `lib/commands.ts` (+`commands.test.ts`), `lib/chatKinds.ts` (+test); modify `consts/index.ts` (command table).

**Interfaces — Produces:**
```ts
export type Parsed =
  | { kind: 'say'; text: string }
  | { kind: 'whisper'; toUserId: string; text: string }
  | { kind: 'open'; target: 'inventory' }
  | { kind: 'error'; message: string };
export function parseCommand(input: string, ctx: { role: 'dm'|'player'; selfName: string; members: Member[] }): Parsed;
export function commandPalette(input: string, role: 'dm'|'player'): { name: string; usage: string; help: string }[];
export function lineKind(line: ChatLine, members: Member[]): 'public' | 'whisper' | 'dm-private';
```
Commands: `/w <name> <text>` (name matches character or display name, case-insensitive, unique prefix), `/dm <text>` (players; whispers to the DM), `/me <text>` → `say` with text `* <selfName> <text>` (rendered italic when a line starts with `* `), `/loot` and `/take` → `open inventory`. `/voice` is **not** offered and typed returns `error: 'DM voice effects are not available yet'`. Anything else starting with `/` → error; text where `/` is not the first character is plain `say`. `lineKind`: `to` present and sender is the DM → `dm-private`; `to` present otherwise → `whisper`; else `public`.

- [ ] **Step 1: Failing tests** (Review Focus 5): `/w alice hi` → whisper to Alice's id; `/w nobody hi` → error naming `nobody`; `/w alice` → error (no text); `/unknown x` → error; `/` alone → error; `see /w later` → say; `/me waves` with selfName `Ka` → say `* Ka waves`; `/dm psst` as a player → whisper to the DM, as the DM → error ("you are the DM"); palette for `/w` lists `/w`; palette with input `/` for a player excludes DM-only commands; `lineKind` three cases.
- [ ] **Step 2:** FAIL. **Step 3:** implement. `ChatMessage` shows an avatar (same initials/colour as the rail), name, text; whisper = `--vtt-whisper` background with `--vtt-whisper-edge` border **and** a "whisper → name" label; DM-private = `--vtt-dm-msg` with an amber "DM → you" label. `Composer` sends via `chatSend(text, to)`; shows parse errors inline; ↑/↓/Tab drive the palette; Enter sends; the composer disables nothing when voice is disconnected.
- [ ] **Step 4:** PASS; manual send/receive/whisper between two sessions. **Step 5: Commit** `feat(panels): themed chat with whispers and slash commands`.

### Task 10: Bottom bar — mute and vertical level meter

**Files:** Create `components/BottomBar.tsx`, `components/LevelMeter.tsx`, `lib/level.ts` (+`level.test.ts`); possibly modify `rust-livekit/src/lib.rs` and `src-tauri/src/commands.rs` for a `livekit:mic-level` event.

**Interfaces — Produces:** `export function levelToBars(level: number, bars?: number /* default 8 */): number` — clamps `level` to 0..1, `NaN` → 0, returns the lit-bar count (`levelToBars(0)=0`, `levelToBars(1)=bars`, `levelToBars(0.5)=bars/2`). Event `livekit:mic-level` `{ level: number }` (0..1), emitted at most 10×/s, **only while connected and unmuted**.

- [ ] **Step 1 (spike, time-boxed):** find whether the LiveKit Rust SDK exposes the local participant's audio level (e.g. `Participant::audio_level()` updated with active-speaker info) on this version; record the finding in `docs/architecture/AUDIO-SPIKE-RESULTS.md`. If it does, emit the event from the existing `ActiveSpeakersChanged` path; if not, **fall back** to a two-state meter (lit while the local identity is in the speaking set) and note it in the doc. Do not add a second capture stream.
- [ ] **Step 2: Failing test** for `levelToBars` incl. `NaN`, `-1`, `2`. **Step 3:** implement meter (vertical, small, token colours) and the bar: mute button (existing `setMicrophoneMuted`, reflects `useMicrophoneMuted`), meter, then the `Composer` from Task 9 in the remaining width. Mute stays usable with voice disconnected (it just changes state).
- [ ] **Step 4:** PASS; manual: speaking moves the meter; idle shows 0 and the event does not fire while muted (log count). **Step 5: Commit** `feat(client): bottom bar with mute and a vertical level meter`.

### Task 11: DM drawer — effects and groups (square pills)

**Files:** Create `components/DmDrawer.tsx`, `components/EffectsStrip.tsx`, `components/GroupsMenu.tsx`; move and trim logic from `SoundboardPanel.tsx` and `PartiesPanel.tsx` (keep their pure helpers and tests); delete the two old panel files and their `PanelRoot` entries.

**Interfaces:** DM-only. A bottom-bar button "Effects" toggles the drawer **above the chat**; it contains `EffectsStrip` (board buttons, scene start/stop, **Stop all**, table volume — same `syncCommand`/`campaignApi('GET','soundboard/…')` calls as today) with square pills (`border-radius: var(--vtt-radius-pill-square)`). `GroupsMenu` is a top-bar dropdown (DM only): create/rename/delete group, move a player into a group or back to the main table, reset — same `party.*` commands as today. **No voice picker** (spec step 6).

- [ ] **Step 1:** keep/relocate the existing tests for the moved helpers so they still pass (`npm test`). **Step 2:** implement; non-DMs never render either control (`isDm`). **Step 3:** manual as DM: play a loop, Stop all, create a group, move a player (their avatar shows the group pip), reset. **Step 4: Commit** `feat(panels): DM effects drawer and groups menu in the main window`.

### Task 12: Settings window

**Files:** Create `components/SettingsWindow.tsx`, `components/settings/AccountSection.tsx`, `SessionsSection.tsx`, `AppearanceSection.tsx`; relocate the bodies of `AccountPanel.tsx` and `SchedulePanel.tsx` into the sections; delete the old panel files; update `PanelRoot`.

**Interfaces:** Radix `Tabs`: **Account** (sign-in, server, campaign picker, sign-out — existing behaviour), **Sessions** (schedule, RSVP, DM create/cancel — existing behaviour), **Appearance** (theme picker: the five themes as swatch buttons; selecting calls `useThemeStore.setTheme` and applies immediately, no reload). No Audio tab (see "Not in this plan").

- [ ] **Step 1:** move code, keep behaviour and existing tests green. **Step 2:** manual: sign out/in, pick a campaign, pick each theme in light and dark OS modes and read every colour pair by eye. **Step 3: Commit** `feat(panels): one settings window (account, sessions, appearance)`.

### Task 13: Handouts and Party-inventory windows, chat chips, inline cards

**Files:** Modify `lib/tableModel.ts` (+`tableModel.test.ts`), `types/index.ts`, `lib/tableStore.ts`; create `lib/timeline.ts` (+`timeline.test.ts`), `components/ChatCards.tsx`, `components/ChatChips.tsx`; modify `HandoutsPanel.tsx`/`LootPanel.tsx` (titles: "Handouts", "Party inventory"; behaviour unchanged).

**Interfaces — Produces:**
```ts
export interface TableCard { id: string; kind: 'loot' | 'handout'; title: string; quantity?: number; claimedBy?: string | null; removed?: boolean; after: string | null }
// TableState.cards: TableCard[]   (after = id of the last chat line when the card event arrived)
export type TimelineEntry = { type: 'line'; line: ChatLine } | { type: 'card'; card: TableCard };
export function timeline(chat: ChatLine[], cards: TableCard[]): TimelineEntry[];
export function cardLabel(card: TableCard, members: Member[]): string; // "Potion ×2 · available" | "… · taken by Mi" | "Handout: Map of the crypt"
```
`applyEvent` handles `loot.dropped` (adds card), `loot.claimed` (sets `claimedBy`, keeps position), `loot.removed` (sets `removed`), `handout.shown` (adds card), `handout.removed` (sets `removed`); events carry `itemId`/`handoutId`, `name`/`title`, `quantity`, `claimedBy` (user id) as built in `hub.ts` (`announceLoot`, `announceHandoutShown`). Applying the same event twice never duplicates a card (keyed by id). Removed cards are hidden from the timeline.

- [ ] **Step 1: Failing tests** (Review Focus 7): replaying `[loot.dropped, loot.claimed]` twice yields one card with `claimedBy` set; `timeline` places a card after the chat line it names and keeps relative order; `cardLabel` shows `taken by <character or display name>` and `available`; removed cards absent from `timeline`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; chips row **📜 Handouts** and **🎒 Party inventory** under the chat call `panelOpen('handouts' | 'inventory')` (use the themed d20/scroll icon set where one is bundled, else text-only — no emoji dependence); DM also gets **Drop loot** which opens the inventory window. Cards are clickable (open the matching window).
- [ ] **Step 4:** PASS; manual: DM drops an item → card appears for everyone; a player grabs it → "taken by …" appears live. **Step 5: Commit** `feat(panels): handout and loot cards in chat, chips open the windows`.

### Task 14: Cleanup, docs, full verification

**Files:** delete leftover `RosterPanel.tsx`, `ChatPanel.tsx`, `RecordingPanel.tsx`, `MuteIcon.tsx` if unused; modify `ROADMAP.md` (Stage 4 status), `docs/BUILD-STATUS.md`, `docs/architecture/TABLE-FEATURES.md` (UI section: main window), `docs/architecture/STATE-AND-RESILIENCE.md` only if a boundary changed; update the spec's status line to "built through step 4".

- [ ] **Step 1:** `grep -rn "RosterPanel\|ChatPanel\|RecordingPanel\|SoundboardPanel\|PartiesPanel\|SchedulePanel\|AccountPanel" tauri-client/panels-ui/src` returns nothing outside git history; remove dead exports.
- [ ] **Step 2:** run the full verification list from Global Constraints plus `npx prettier --check` on touched files; all green (the 20 pre-existing prettier failures elsewhere are not this plan's).
- [ ] **Step 3:** docs: record what is built vs verified, the deferred list at the top of this plan, and the unconfirmed assumptions (level meter source, OS-follow appearance on GNOME, tray badge legibility on KDE/Windows). Mermaid diagram of the window/event flow in TABLE-FEATURES.md.
- [ ] **Step 4:** launch with the instructions in this session's earlier run (backend + Postgres/Valkey from `infra/dev/compose.yml`, `cargo run -p src-tauri`), walk the checklist: theme in both OS modes, rail glow, chat/whisper, DM drawer, Connect/Disconnect, REC timer, chips and windows. Report what was and was not observed.
- [ ] **Step 5: Commit** `docs: main window built; roadmap and build status updated`. Do not merge or push; ask.
