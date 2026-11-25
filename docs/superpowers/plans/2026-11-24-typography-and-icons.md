# Typography and Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app and the phone web app share one set of fonts, typography tokens and icon meanings; every one of the 18 chat languages has its own font; Game Icons is added only if an audit proves lucide falls short.

**Architecture:** A new React workspace package `ui-kit/` (built with `tsc -b` to `dist/`, exactly like `shared/`) holds the font imports, CSS tokens, the per-language font table, the semantic icon map and the reading-preference store. Both clients depend on it and delete their duplicated copies. The font a language uses is chosen client-side from the language's `key`; the wire (`ChatLanguage.style`) is untouched and becomes the fallback.

**Tech Stack:** TypeScript, React 19, Zustand 5, `lucide-react` ^1.70, Fontsource (`@fontsource/*` ^5.3.0, `@fontsource-variable/inter` ^5.3.0), Vite 8, Vitest 5, Radix Themes (desktop settings).

**Spec:** [docs/architecture/ICONOLOGY.md](../../architecture/ICONOLOGY.md) (decisions of 2026-11-24 are in its "Decisions" and "Assumptions" tables)

## Global Constraints

- **No wire change.** `shared/` `PROTOCOL_VERSION`, `ChatLanguage`, `CHAT_LANGUAGES` and their `style` values are not modified. The only edit to `shared/` is removing `LANGUAGE_STYLE_CSS` (Task 3).
- **No remote origins.** Every font is bundled from a Fontsource package; no CDN, no `@import url(...)`. The Tauri CSP is not loosened.
- **Lazy by construction.** Fonts are `@font-face` imports only (latin subset, one weight per language; Cormorant Garamond two). Nothing may preload a language font.
- **`backend/` never imports `ui-kit/`.** `ui-kit/` may depend on `shared/`; `shared/` depends on nothing.
- **Light and dark** must both read well in every font; follow the OS preference as today.
- Every font is SIL OFL 1.1 via Fontsource. Game Icons (if added) is **CC BY 3.0** and needs a credits file.
- LF line endings; `rustfmt`/`clippy` untouched (no Rust here); ESLint + Prettier clean; per-module folders `components/ hooks/ consts/ types/ styles/ lib/`.
- Add user-visible changes under `## [Unreleased]` in `CHANGELOG.md` in the same change. **Do not tag or release.** Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Release split (Andy, 2026-11-24, ROADMAP Stage 14):** Tasks 1 to 7 and 10 (and 12 for them) ship in **0.6.3**; Tasks 8, 9 and 11 ship in **0.6.4**. All of it is protocol 4, no wire change. Stage 13 closed on 2026-11-24, so this is free to start. Do not start it on `main` before Andy says so; work on a branch.

## Review Focus

1. **A language key this client has no font for** (a newer server adds `kobold`): the line renders in that language's wire `style` fallback, never unstyled-and-broken, never throws.
2. **Force readable on while language fonts are on:** Inter wins, the "in X" caption and language metadata stay.
3. **Storage blocked or corrupt** (`localStorage` throws, or holds `{"languageFonts":"yes"}`): defaults apply, no crash, no partial state.
4. **A font file that fails to load** (offline webview, blocked file): the fallback stack shows and the text is still readable at chat size.
5. **A new language added to `CHAT_LANGUAGES` without a font entry:** a test fails (drift guard), not a silent unstyled line.

---

## File Structure

| Path                                                                                | Responsibility                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ui-kit/package.json`, `tsconfig.json`                                              | Workspace package `@vtt-chat-app/ui-kit`, built like `shared/` (`tsc -b`, `main`/`types` at `dist/`), `exports` for `.` and `./tokens.css`                   |
| `ui-kit/src/styles/tokens.css`                                                      | `--vtt-font-body`, `--vtt-font-head`, `--vtt-font-narrative`                                                                                                 |
| `ui-kit/src/fonts/core.ts`                                                          | Imports Inter, Cinzel, Cormorant Garamond                                                                                                                    |
| `ui-kit/src/fonts/languages.ts`                                                     | Imports the language font files (replaces both `languageFonts.ts`)                                                                                           |
| `ui-kit/src/consts/languageFonts.ts`                                                | `LANGUAGE_FONTS: Record<string, LanguageFont>` (key → family, weight, style, size, tracking, fallback stack) and `STYLE_FALLBACK_CSS` (moved from `shared/`) |
| `ui-kit/src/lib/languageTextStyle.ts`                                               | `languageTextStyle(...)`: the one function both clients call                                                                                                 |
| `ui-kit/src/lib/readingPrefs.ts`, `hooks/useReadingPrefs.ts`                        | The three reading switches, persisted, cross-window                                                                                                          |
| `ui-kit/src/lib/langSpan.ts`, `components/LangSpan.tsx`                             | `lang:` link and fenced-block rendering for handouts and tales (Task 11)                                                                                     |
| `ui-kit/src/consts/icons.ts`                                                        | `ICON` (semantic name → `LucideIcon`) and `SENSE_ICON`                                                                                                       |
| `ui-kit/src/components/GameIcon.tsx`, `consts/gameIcons.generated.ts`, `CREDITS.md` | **Only if Task 9 is approved**                                                                                                                               |
| `scripts/icons/audit.ts`, `scripts/icons/import.ts`                                 | Icon audit sheet (Task 8); Game Icons importer (Task 9, gated)                                                                                               |

## Task 1: Scaffold `ui-kit/` as a workspace package

**Files:**

- Create: `ui-kit/package.json`, `ui-kit/tsconfig.json`, `ui-kit/src/index.ts`, `ui-kit/src/index.test.ts`
- Modify: root `package.json` (`workspaces`: add `"ui-kit"` after `"shared"`), `tauri-client/panels-ui/package.json` and `web/package.json` (dependency `"@vtt-chat-app/ui-kit": "*"`), both clients' `tsconfig.json` (`references` → `../../ui-kit` / `../ui-kit`), `.github` CI only if it lists workspaces explicitly (check; add if so)

**Interfaces:**

- Produces: package `@vtt-chat-app/ui-kit`, entry `src/index.ts` (empty re-exports for now), `exports["./tokens.css"] → ./src/styles/tokens.css`.

- [ ] **Step 1: Write the failing test** in `ui-kit/src/index.test.ts`: `import * as kit from './index.js'; it('exports a module', () => expect(kit).toBeTypeOf('object'))`.
- [ ] **Step 2: Run** `npm test -w @vtt-chat-app/ui-kit`. Expected: FAIL (workspace not found).
- [ ] **Step 3: Create the package.** Copy `shared/package.json` and `shared/tsconfig.json` as the template (same scripts `build`/`typecheck`/`test`, `type: module`, version equal to the others, currently `0.6.2`; check `scripts/set-version.sh` / `tauri-client/scripts/set-version.sh` and `release-version.sh` cover the new `package.json`, extend them if they enumerate packages). Dependencies: `react`, `zustand`, `lucide-react`, `@vtt-chat-app/shared`; `jsdom` for tests if a component test needs it. `tsconfig` extends the base, `jsx: react-jsx`, `moduleResolution: Bundler`, `rootDir: src`, `outDir: dist`, references `../shared`.
- [ ] **Step 4: Wire the clients.** Add the dependency and `references`. Run `npm install`.
- [ ] **Step 5: Run** `npm run build -w @vtt-chat-app/shared -w @vtt-chat-app/ui-kit && npm run typecheck && npm test -w @vtt-chat-app/ui-kit`. Expected: PASS. Then `npm run build` at the root; expected: all workspaces build in order (ui-kit after shared, before web and panels-ui).
- [ ] **Step 6: Commit** `feat(ui-kit): scaffold the shared UI package`.

## Task 2: Typography tokens and the three core fonts

**Files:**

- Create: `ui-kit/src/styles/tokens.css`, `ui-kit/src/fonts/core.ts`, `ui-kit/src/styles/tokens.test.ts`
- Modify: `ui-kit/package.json` (deps `@fontsource-variable/inter`, `@fontsource/cinzel`, `@fontsource/cormorant-garamond`), `ui-kit/src/index.ts` (export `./fonts/core.js` side-effect via a named `loadCoreFonts` is **not** used: clients import the file directly), `tauri-client/panels-ui/src/main.tsx` (replace the Cinzel import with `@vtt-chat-app/ui-kit/fonts/core` and `…/tokens.css`), `web/src/main.tsx` and `web/src/phone.tsx` (same), `tauri-client/panels-ui/src/styles/tokens.css` (delete `--vtt-font-head`), the two stylesheets' `Georgia, 'Times New Roman', serif` rules at `main.css:301` and `phone.css:389` (use `var(--vtt-font-narrative)`), body rule in each client (`font-family: var(--vtt-font-body)`).

**Interfaces:**

- Produces: CSS custom properties `--vtt-font-body: 'Inter Variable', system-ui, sans-serif`, `--vtt-font-head: 'Cinzel', Georgia, serif`, `--vtt-font-narrative: 'Cormorant Garamond', Georgia, serif`. Add `exports` entries `./fonts/core` and `./fonts/languages` (side-effect import files) in `ui-kit/package.json`.

- [ ] **Step 1: Write the failing test** `tokens.test.ts`: reads `tokens.css` and asserts it declares all three properties, and that `--vtt-font-head` starts with `'Cinzel'`.
- [ ] **Step 2: Run** `npm test -w @vtt-chat-app/ui-kit`. Expected: FAIL (file missing).
- [ ] **Step 3: Create** `tokens.css` and `fonts/core.ts` (Inter variable latin, Cinzel 600, Cormorant Garamond latin 500 and 500-italic).
- [ ] **Step 4: Adopt in both clients** as listed. Handout and read-aloud text uses `--vtt-font-narrative`; DM narration stays Inter weight 500 (already the body font).
- [ ] **Step 5: Run** `npm test -w @vtt-chat-app/ui-kit && npm run build`. Expected: PASS; both builds contain an Inter woff2.
- [ ] **Step 6: Visual check** in both apps (`npm run app`, and the web build served by the dev backend): body is Inter, headings Cinzel on the web app too, in light and dark. Note any layout shift from the new body font.
- [ ] **Step 7: Commit** `feat(ui): Inter body and Cinzel headings in both clients`.

## Task 3: The per-language font table and `languageTextStyle`

**Files:**

- Create: `ui-kit/src/consts/languageFonts.ts`, `ui-kit/src/types/languageFont.ts`, `ui-kit/src/lib/languageTextStyle.ts`, `ui-kit/src/lib/languageTextStyle.test.ts`
- Modify: `shared/src/consts/chat.ts` (remove `LANGUAGE_STYLE_CSS` and its doc comment; keep `CHAT_LANGUAGES`), `shared/src/index.ts` if it re-exports by name, `docs/architecture/CHAT-COMMANDS.md` (point "Fonts" at ICONOLOGY and delete the stale seven-font prose once Task 5 lands)

**Interfaces:**

- Consumes: `CHAT_LANGUAGES`, `ChatLanguageStyle` from `@vtt-chat-app/shared`.
- Produces:
  - `interface LanguageFont { family: string; weight: number; italic?: boolean; size?: string; tracking?: string; fallback: string }`
  - `LANGUAGE_FONTS: Readonly<Record<string, LanguageFont>>`, one entry per key in the table in ICONOLOGY.md ("Language fonts"). `common` has no entry (it is plain). `thieves-cant` is `family: 'Inter Variable'`, `italic: true`, `tracking: '.04em'`.
  - `STYLE_FALLBACK_CSS: Record<ChatLanguageStyle, Record<string, string>>`, the old `LANGUAGE_STYLE_CSS` values moved verbatim (the fallback for a key with no entry).
  - `languageTextStyle(key: string | undefined, prefs?: { languageFonts: boolean; forceReadable: boolean }): CSSProperties | undefined`. `undefined` for no/unknown key; `{}` for `common`; with `forceReadable` or `languageFonts: false` returns `{}` (still defined, so the caption logic is unchanged). `prefs` defaults to `{ languageFonts: true, forceReadable: false }`.

- [ ] **Step 1: Write the failing tests** in `languageTextStyle.test.ts`:
  - `every language in CHAT_LANGUAGES except common has a LANGUAGE_FONTS entry` (the drift guard; Review Focus 5).
  - `elvish uses Cormorant Garamond italic 500`, `dwarvish uses Alegreya SC`, `celestial uses Cinzel Decorative 700`, `giant uses Uncial Antiqua` (the three doc-over-code decisions plus one unchanged).
  - `unknown key returns undefined`, `common returns {}`.
  - `a key with no font entry falls back to STYLE_FALLBACK_CSS[style]` (inject a fake language via a parameterised internal helper `styleFor(lang, fonts)`; Review Focus 1).
  - `forceReadable returns {} even when languageFonts is true` (Review Focus 2).
  - `languageFonts false returns {}`.
- [ ] **Step 2: Run** `npm test -w @vtt-chat-app/ui-kit`. Expected: FAIL.
- [ ] **Step 3: Implement** the table (values from ICONOLOGY.md; sizes and tracking start from the old `LANGUAGE_STYLE_CSS` for the closest old style, then are tuned in Task 6) and `languageTextStyle`. Build the font-family string as `"<family>", <fallback>`.
- [ ] **Step 4: Remove** `LANGUAGE_STYLE_CSS` from `shared/`; run `npm run build -w @vtt-chat-app/shared` and expect the two clients (not yet migrated) to fail typecheck; that is fixed in Task 5. **Do not commit between Step 4 and Task 5's end**: keep Tasks 3 to 5 on one commit sequence that ends green, or leave `LANGUAGE_STYLE_CSS` in `shared/` until Task 5 Step 4 and remove it there.
- [ ] **Step 5: Run** `npm test -w @vtt-chat-app/ui-kit`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(ui-kit): a font for every language, chosen by key`.

## Task 4: Bundle the language fonts

**Files:**

- Create: `ui-kit/src/fonts/languages.ts`, `ui-kit/src/fonts/languages.test.ts`
- Modify: `ui-kit/package.json` (add `@fontsource/` for `alegreya-sc`, `alegreya-sans-sc`, `uncial-antiqua`, `marcellus`, `im-fell-english`, `im-fell-dw-pica`, `quattrocento`, `forum`, `metamorphous`, `black-ops-one`, `julius-sans-one`, `philosopher`, `rosarivo`, `caudex`, all `^5.3.0`, plus `cinzel-decorative`), root lockfile

**Interfaces:**

- Consumes: `LANGUAGE_FONTS` (Task 3).
- Produces: a side-effect module importing one `@fontsource/<family>/latin-<weight>[-italic].css` per language, matching each entry's `weight`/`italic`.

- [ ] **Step 1: Write the failing test** `languages.test.ts`: for every `LANGUAGE_FONTS` entry whose family is a Fontsource package, assert `node_modules/@fontsource/<slug>/latin-<weight>[-italic].css` exists, **and** that `fonts/languages.ts` source text imports that exact file (this keeps the table and the imports from drifting).
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Add dependencies, `npm install`, write `languages.ts`.**
- [ ] **Step 4: Run** the test and `npm run build`. Expected: PASS.
- [ ] **Step 5: Measure.** Record in `docs/BUILD-STATUS.md`: `web/dist` size and the desktop `panels-ui/dist` size before (current: web 5.1 MB) and after, and the size of the largest language font file.
- [ ] **Step 6: Commit** `feat(ui-kit): bundle the 14 language font families`.

## Task 5: Both clients adopt `languageTextStyle`; delete the duplicates

**Files:**

- Modify: `tauri-client/panels-ui/src/lib/chatStyle.ts`, `chatStyle.test.ts`, `web/src/lib/phone/lineStyle.ts`, `lineStyle.test.ts`, `tauri-client/panels-ui/src/main.tsx` and `web/src/phone.tsx` (import `@vtt-chat-app/ui-kit/fonts/languages` in place of `languageFonts.ts`), both clients' `package.json` (remove `@fontsource/alfa-slab-one`, `caveat`, `fredoka`, `pirata-one`, `share-tech-mono`, and the now-unused direct `cinzel*`/`cormorant-garamond` deps), `docs/architecture/CHAT-COMMANDS.md` (rewrite "Fonts" to the new set)
- Delete: `tauri-client/panels-ui/src/lib/languageFonts.ts`, `web/src/lib/languageFonts.ts`
- Remove: `@radix-ui/react-icons` from `panels-ui/package.json` (unused: 0 imports)

**Interfaces:**

- Consumes: `languageTextStyle`, `useReadingPrefs` once Task 10 lands (until then call with defaults).
- Produces: `languageStyle(key)` in each client keeps its signature, so `ChatMessage.tsx` and `ChatTab.tsx` need no change.

- [ ] **Step 1: Update the failing tests.** `chatStyle.test.ts:18` currently expects `"Alfa Slab One"` for Dwarvish; change to `/^"Alegreya SC"/`. Add the same assertion in `lineStyle.test.ts`. Run: FAIL.
- [ ] **Step 2: Implement** both `languageStyle` functions as a one-line call to `languageTextStyle`. Delete `LANGUAGE_STYLES` exports if nothing else imports them (grep first).
- [ ] **Step 3: Remove** the files and dependencies listed; `npm install`; `grep -rn "alfa-slab\|Caveat\|Pirata\|Fredoka\|Share Tech" tauri-client web shared ui-kit` returns nothing outside `node_modules` and `docs/archive`.
- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run build`. Expected: PASS everywhere.
- [ ] **Step 5: Commit** `refactor: both clients style language lines through ui-kit`.

## Task 6: Tune every language by eye

**Files:** Modify `ui-kit/src/consts/languageFonts.ts` (sizes, tracking), `docs/architecture/ICONOLOGY.md` (record final values and any font swapped).

- [ ] **Step 1: Make a specimen.** With `npm run dev:mock` (or a dev table), send one `/say-<key>` line for each of the 18 languages with the same sentence, in the desktop app and the phone app, light and dark.
- [ ] **Step 2: Adjust** `size` and `tracking` until x-heights look even and no face is hard to read at chat size. Black Ops One and Uncial Antiqua are the likely trouble. If a face fails outright, propose a swap to Andy instead of picking one.
- [ ] **Step 3: Andy reviews** the specimen on both apps. Do not close this task without his sign-off.
- [ ] **Step 4: Run** `npm test -w @vtt-chat-app/ui-kit` (tests assert families, not sizes), then **commit** `style(ui-kit): tune language font sizes`.

## Task 7: One icon vocabulary; the web app moves to `lucide-react`

**Files:**

- Create: `ui-kit/src/consts/icons.ts`, `ui-kit/src/consts/icons.test.ts`
- Modify: `web/package.json` (add `lucide-react` at the same version as the desktop app), every web file that uses `<Icon name=…>` (20 uses: `phone/CharacterDetail.tsx`, `NextSessionRow.tsx`, `BardBadge.tsx`, `SheetChips.tsx`, `LootButtons.tsx`, `CharacterStats.tsx`, `IconTool.tsx`, and the rest `grep -rn "<Icon " web/src` finds), `tauri-client/panels-ui/src/components/SheetChips.tsx` (use `SENSE_ICON` from ui-kit)
- Delete: `web/src/components/icons/` (Icon.tsx, paths.ts, index.ts)

**Interfaces:**

- Consumes: `SenseKind` from `@vtt-chat-app/shared`.
- Produces:
  - `SENSE_ICON: Record<SenseKind, LucideIcon>` (darkvision `Moon`, blindsight `Radar`, tremorsense `Waves`, truesight `ScanEye`: the desktop's current values, moved).
  - `ICON: Readonly<{ ac: LucideIcon; hp: LucideIcon; pp: LucideIcon; handouts: LucideIcon; history: LucideIcon; sessions: LucideIcon; copy: LucideIcon; tick: LucideIcon; chat: LucideIcon; dm: LucideIcon; link: LucideIcon; add: LucideIcon }>`, mapping per the comment at the top of the old `paths.ts` (Handouts `FileText`, History `ScrollText`, Sessions `CalendarClock`, Chat `MessageSquare`, AC `Shield`, HP `Heart`, PP `Eye`, DM `Crown`, link `Link2`, add `Plus`, copy `Copy`, tick `Check`).

- [ ] **Step 1: Write the failing test** `icons.test.ts`: every `SenseKind` has an icon in `SENSE_ICON`; every `ICON` value is a defined component.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `icons.ts`; migrate the web files to render `<ICON.ac size={…} aria-hidden />`-style lucide components; migrate the desktop `SheetChips` to the shared `SENSE_ICON`.
- [ ] **Step 4: Delete** `web/src/components/icons/`; run `npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Measure** the web bundle change (lucide tree-shakes to about 1 KB per icon); record it in BUILD-STATUS.
- [ ] **Step 6: Check** each migrated web screen in light and dark: stat chips, session row, handouts, loot buttons.
- [ ] **Step 7: Commit** `refactor: one icon vocabulary for both clients; the web app uses lucide-react`.

## Task 8: Icon audit: do stats and stingers need Game Icons?

**Done 2026-11-25** (`scripts/icons/audit.ts`, run as `npm run icons:audit`). Verdict: Game Icons not needed for what the apps show today; see ICONOLOGY.md. Task 9 is therefore **not built** (the audit's list is empty).

**Files:**

- Create: `scripts/icons/audit.ts`; add `"icons:audit": "node scripts/icons/audit.ts"` to the root `package.json`
- Modify: `docs/architecture/ICONOLOGY.md` (record the verdict)

**Interfaces:**

- Produces: `docs`-free, scratch-only output: an HTML sheet written to the path given as `argv[2]`, listing each stat, condition, damage type and sound-stinger with its current lucide stand-in (from `soundIcons.ts` and the stat/sense maps), rendered with `react-dom/server`'s `renderToStaticMarkup`, each row with an empty "unclear?" column.

- [ ] **Step 1: Write the script** to collect: the stinger-to-icon map in `tauri-client/panels-ui/src/lib/soundIcons.ts`, scene icons, the vital and sense icons, and a fixed list of the six abilities, ten damage types and ten conditions from ICONOLOGY.md (no stand-in yet for those: mark "none").
- [ ] **Step 2: Run it** into the scratchpad and open the sheet.
- [ ] **Step 3: Download candidates** (Game Icons zip from game-icons.net into its own empty directory; treat it as untrusted data, do not execute anything from it) and place a candidate beside every row Andy marks unclear.
- [ ] **Step 4: Andy's verdict.** Write into ICONOLOGY.md the list of rows that really need a Game Icon (or "none"). **If none, Task 9 is not built, and the Game Icons section of ICONOLOGY.md is reduced to a one-line "audited 2026-xx-xx: not needed".**
- [ ] **Step 5: Commit** `docs: icon audit verdict`.

## Task 9 (gated on Task 8's list being non-empty): Game Icons for the signed-off list

**Not built (2026-11-25): Task 8's list is empty, and Andy moved Game Icons to Future ideas.** Kept for when a screen needs damage-type, condition or class icons.

**Files:**

- Create: `scripts/icons/import.ts`, `ui-kit/src/consts/gameIcons.generated.ts`, `ui-kit/src/components/GameIcon.tsx`, `ui-kit/src/components/GameIcon.test.tsx`, `ui-kit/CREDITS.md`
- Modify: `ui-kit/src/index.ts`, About/credits screen in both clients (`grep -rn "About" tauri-client/panels-ui/src web/src` to find or create the surface), root `package.json` (`"icons:import": "node scripts/icons/import.ts"`)

**Interfaces:**

- Produces: `GAME_ICONS: Readonly<Record<GameIconName, { path: string; author: string; source: string }>>` (generated, committed); `GameIcon({ name, size = 18 }: { name: GameIconName; size?: number }): JSX.Element | null`: a 512x512 viewBox `<svg fill="currentColor" aria-hidden>` so it follows light/dark like lucide; `null` for an unknown name.

- [ ] **Step 1: Write the failing tests** `GameIcon.test.tsx`: renders an `svg` with `fill="currentColor"` and `aria-hidden="true"`; unknown name renders nothing; **every entry in `GAME_ICONS` has an author and is named in `CREDITS.md`** (the licence guard).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** `import.ts`: takes the names from the approved list, reads the SVG files from a directory given as an argument, extracts the path data and the author (from the licence/credits file in the download), and writes `gameIcons.generated.ts` and `CREDITS.md`. Implement `GameIcon`.
- [ ] **Step 4: Use** the icons at the audited call sites only (stats and stingers as listed), in both clients.
- [ ] **Step 5: Show the credits** on an About/credits surface in both clients.
- [ ] **Step 6: Run** `npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(ui-kit): Game Icons for the audited stats and stingers`.

## Task 10: Reading preferences: three switches, both clients

**Files:**

- Create: `ui-kit/src/lib/readingPrefs.ts`, `ui-kit/src/lib/readingPrefs.test.ts`, `ui-kit/src/hooks/useReadingPrefs.ts`, `web/src/components/account/ReadingCard.tsx`
- Modify: `ui-kit/src/lib/languageTextStyle.ts` callers (pass the live prefs), `tauri-client/panels-ui/src/components/settings/AppearanceSection.tsx` (three `SettingRow`s with Radix `Switch`), `web/src/components/account/AccountPage.tsx`, `CHANGELOG.md` (`## [Unreleased]` → Added: language fonts, reading switches; Changed: Inter/Cinzel, web icons), `docs/guides` user-facing page if one lists Appearance settings

**Interfaces:**

- Produces: `interface ReadingPrefs { languageFonts: boolean; documentFonts: boolean; forceReadable: boolean }`; `DEFAULT_READING_PREFS = { languageFonts: true, documentFonts: true, forceReadable: false }`; `parseReadingPrefs(raw: string | null): ReadingPrefs` (merges onto defaults; ignores wrong types; never throws); `useReadingPrefs(): ReadingPrefs & { set(patch: Partial<ReadingPrefs>): void }` backed by a Zustand store persisted under `localStorage` key `vtt.reading`, following `themeStore.ts` (try/catch around every storage access, and a `storage` event listener so a change in the Settings window reaches the main window). `forceReadable` sets `document.documentElement.dataset.readable = 'on'`; the stylesheet rule `[data-readable='on'] { --vtt-font-narrative: var(--vtt-font-body); }` makes handouts follow, and `documentFonts: false` does the same.

- [ ] **Step 1: Write the failing tests** `readingPrefs.test.ts`: `parseReadingPrefs(null)` is the defaults; `parseReadingPrefs('{"languageFonts":"yes"}')` is the defaults (Review Focus 3); `parseReadingPrefs('{"forceReadable":true}')` keeps the other two at default; invalid JSON is the defaults; `set` persists to storage; a throwing `localStorage` leaves the store working in memory.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the store, hook and `data-readable` application; pass `useReadingPrefs()` into `languageTextStyle` at both clients' call sites (Task 5 left them on defaults).
- [ ] **Step 4: Add the UI.** Desktop: three rows in Appearance ("Language-specific fonts", "Decorative document fonts", "Force readable mode"). Web: a `ReadingCard` on the account page. The account page is the agreed place (Andy, 2026-11-24): the phone app menu already links to it.
- [ ] **Step 5: Run** `npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 6: Check by hand** in both apps: toggle each switch with a `/say-elvish` line on screen; force readable turns it to Inter at once in an already-open second window; the "in Elvish" caption stays.
- [ ] **Step 7: Commit** `feat: reading switches for language and document fonts`.

## Task 11: Language spans in handouts and tales

**Done 2026-11-25.** Differences from the plan below: the Markdown components live in `ui-kit` as `makeLangComponents` (one place for both apps) rather than `LangSpan` being wired by hand in each; the storyteller rule is in `buildStoryPrompt` for every storyteller; the search-snippet limit is recorded in the design doc.

**Files:**

- Create: `ui-kit/src/lib/langSpan.ts`, `ui-kit/src/lib/langSpan.test.ts`, `ui-kit/src/components/LangSpan.tsx`
- Modify: `tauri-client/panels-ui/src/components/MarkdownView.tsx`, `web/src/components/phone/MarkdownView.tsx`, `ai/src/lib/prompts.ts` (the storyteller prompt), `docs/architecture/RPG-MARKDOWN-EXTENSION.md` (status to built)

**Interfaces:**

- Consumes: `languageTextStyle` and `useReadingPrefs` (Tasks 3 and 10); `CHAT_LANGUAGES` and the alias table from `@vtt-chat-app/shared`.
- Produces:
  - `parseLangHref(href: string | undefined): string | undefined`: the language key for `lang:<name>` (accepting aliases such as `dwarven`, case-insensitive), `undefined` for any other href or an unknown or `common` name.
  - `langUrlTransform(url: string): string`: passes `lang:` URLs through and defers to react-markdown's `defaultUrlTransform` for everything else.
  - `<LangSpan lang={key}>{children}</LangSpan>` (inline) and `<LangBlock lang={key}>{children}</LangBlock>`: apply `languageTextStyle(key, prefs)` and a `title` of the language name.

- [ ] **Step 1: Write the failing tests** in `langSpan.test.ts`: `parseLangHref('lang:dwarvish')` is `'dwarvish'`; `'lang:Dwarven'` is `'dwarvish'`; `'lang:klingon'`, `'lang:common'`, `'https://x.example'` and `undefined` are `undefined`; `langUrlTransform('lang:elvish')` is unchanged and `langUrlTransform('javascript:alert(1)')` is still blanked (the safe default is preserved).
- [ ] **Step 2: Run** `npm test -w @vtt-chat-app/ui-kit`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and components.
- [ ] **Step 4: Wire both `MarkdownView`s:** pass `urlTransform={langUrlTransform}`; in `components.a`, return `<LangSpan>` when `parseLangHref(href)` is a key, else the existing inert `<span>`; in `components.code`/`pre`, render `<LangBlock>` for a fenced block whose info string (`className: language-<name>`) parses to a key, else unchanged. Add tests in each client's `MarkdownView` test (create if missing) that a `lang:` link renders a styled span, an ordinary link stays inert text with no `href`, a `javascript:` link stays inert, and a fenced `dwarvish` block renders styled while a fenced `ts` block is untouched.
- [ ] **Step 5: Degrade check:** assert that the same Markdown rendered by a plain `react-markdown` (no overrides) still contains the words, so the text is never lost.
- [ ] **Step 6: Storyteller prompt:** add one sentence to the prompt in `ai/src/lib/prompts.ts` (_foreign speech of a named language may be written `[text](lang:<language>)`; use it sparingly, only when the notes or chat name the language_), with a prompt test that the sentence is present and that the summary-search text extraction keeps the link text.
- [ ] **Step 7: Run** `npm run typecheck && npm test && npm run build`. Expected: PASS. Check by hand in both apps: a handout with an inline and a block span, light and dark, force readable on and off.
- [ ] **Step 8: Commit** `feat: language spans in handouts and tales`.

## Task 12: Documentation and close-out

**Stage 14 close (Andy, 2026-11-24):** after the 0.6.4 work, take new documentation screenshots of every changed screen (`scripts/screenshots/`) **and run the full session 4 test** to prove the system is stable and usable, before the stage is called closed. The 0.6.3 half of this task (done 2026-11-24) is the CHANGELOG entries and the status words; the final BUILD-STATUS numbers, the screenshots and the session 4 result are recorded when Stage 14 closes.

**Files:** Modify `docs/architecture/ICONOLOGY.md` (status → built; final font values), `docs/BUILD-STATUS.md` (built vs verified; measured sizes), `ROADMAP.md` (Stage 15 row 🟢), `.claude/CLAUDE.md` §3 (drop "Planned"), `docs/architecture/OVERVIEW.md` (drop "planned"), `docs/CONVENTIONS.md`, `docs/architecture/CHAT-COMMANDS.md`, `CHANGELOG.md`, `docs/tracker/README.md` (move this plan and the spec row in when the stage closes)

- [ ] **Step 1: Update each doc** in the same change as the code it describes (CLAUDE.md §17): status words, the measured size figures from Tasks 4 and 7, the audit verdict, any font swapped in Task 6.
- [ ] **Step 2: Run** `npx prettier --check` on the changed Markdown and `npm run lint && npm run typecheck && npm test && npm run build`. Expected: clean.
- [ ] **Step 3: Commit** `docs: typography and icons built`.

---

## Self-review

- **Spec coverage:** shared package (T1); Inter/Cinzel/narrative tokens (T2); a font per language and the drift guard (T3, T4); both clients adopt and delete duplicates (T5); tuning (T6); web off hand-copied paths and shared semantic icons (T7); Game Icons demand-driven with audit gate and CC BY credits (T8, T9); the three accessibility switches including force readable (T10); language spans in handouts and tales (T11); docs and the five removed fonts and unused radix-icons dep (T5, T12). Polyglot and `/npc` are deliberately absent (`/npc` is a wire change and belongs to Stage 15).
- **Order and green builds:** T3's removal of `LANGUAGE_STYLE_CSS` from `shared/` is deferred to T5 Step 4 if needed, so no commit leaves the clients broken.
- **Types:** `languageTextStyle(key, prefs)` and `ReadingPrefs` are defined in T3 and T10 with the same field names (`languageFonts`, `forceReadable`); `documentFonts` is consumed only by the CSS rule in T10.

## Open questions for Andy (affect Task 10, not the rest)

1. _Resolved 2026-11-24:_ the assumptions in ICONOLOGY.md hold (doc wins for Celestial, Giant and Thieves' Cant; Inter body in both clients); the work is in Stage 14, 0.6.3 and 0.6.4.
2. _Resolved 2026-11-24 (Andy: "place it where it makes sense"):_ the reading switches are ordinary settings. Desktop: the Appearance section. Phone app: a Reading card on the account page, which the phone app's menu already links to, beside Theme-style device preferences.
