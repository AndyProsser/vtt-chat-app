# Main window — one compact window instead of nine panels

**Status:** design agreed 2026-11-08; **steps 1–4 built** (see the plan's deferred list: Settings Audio tab, real level meter, drag-to-group, recording history); steps 5–6 (party-inventory model, DM voice effect) are not. Supersedes the "one panel per
feature" shape of Stage 4 (ROADMAP.md). Items marked **(my call)** were decided by Claude, not Andy.

## Why

Stage 4 shipped nine separate panel windows (account, roster, chat, handouts, loot, schedule,
soundboard, voice groups, recording). Opened for the first time they were too many things to find
and manage during play. The app is meant to be always running and glanced at. The old `vtt-chat`
frontend (`/home/andy/Development/vtt-chat/apps/frontend`) had the right content but too much of
it; this keeps its good ideas (speaker avatars, whisper colours, slash commands) in a much smaller
surface.

**Principle: less is more.** Everything a player does _during play_ lives in one window. Anything
done _occasionally_ opens a separate screen from the settings cog or a chat chip.

## Goals

- One main window carrying: speaking indicators, chat, mute and level, record state, DM voice and
  effects, DM group steering.
- Compact enough to sit beside a VTT. Light/dark **follows the OS by default**.
- Chat works with no voice connection (a Connect/Disconnect toggle).
- Everything else (account, settings, handouts, party inventory) is one click away, not a tray hunt.

## Non-goals / anti-goals

- No dice, conditions, environment, initiative or character sheets (CLAUDE.md §13). `/roll`,
  `/condition`, `/env` from the old app are **dropped**.
- No separate window per feature. If a new feature wants a window, it goes behind the cog or a chip.
- No picker that does nothing: the DM **voice** control is hidden until the voice effect exists.
- Not a character-sheet tracker: players update their own sheets; the app only records who took what.
- No per-party text chat, no separate LiveKit rooms per group.

## The main window

```text
┌──────────────────────────────────────────────┐
│ ● REC 01:42:18  [⏸][■]*        [Groups▾]* [🎧 Connected] [⚙] │  top bar (* DM only)
├────┬─────────────────────────────────────────┤
│ DM │  chat (≈75% of the window)               │
│ ── │   avatar + message; whispers coloured    │
│ Ka │   loot / handout cards inline            │
│ Mi │                                          │
│ Jo │  [📜 Handouts] [🎒 Party inventory]       │
├────┴─────────────────────────────────────────┤
│ 🎙 ▮  [ Message… (/w name to whisper) ] [🎭▴]* │  bottom bar
└──────────────────────────────────────────────┘
```

- **Avatar rail (left, small, stacked).** DM always at the top, a divider, then players. The
  current speaker's avatar is ringed/highlighted; muted players carry a badge; offline players are
  faded. Hovering an avatar shows a card: player name, character name, race, class, level — only
  the fields we actually have (characters are optional, CLAUDE.md §11).
- **Top bar.** Record state and timer. **Players see a read-only "● REC" and timer; only the DM
  gets pause/stop/start** (decided). The **Connect/Disconnect** toggle starts and stops the audio
  connection; disconnected means chat, handouts and inventory still work. Settings cog at the right.
- **Bottom bar.** Mute/unmute, a **small vertical level meter** (decided), the message box. The DM
  also gets the voice button here.
- **Chat.** Fills the rest. Avatar beside each message. Whispers (to a player) and DM-private
  messages are **colour-coded** distinctly (and labelled, so colour is never the only signal). Loot
  and handout drops appear as inline cards. Chips under the chat open **Handouts** and **Party
  inventory** (decided: "I really like these buttons").
- **DM drawer above chat** (opens from the bottom bar): the DM **voice** picker (see Step 6) and
  sound effects (play, stop all, table volume) — **square pills**, not rounded (decided).
- **Groups (DM).** The same mute/steer model that already exists server-side
  (`party.*` frames): everyone stays in **one LiveKit room**, nobody disconnects, the server steers
  who hears whom. The DM moves players between groups from the Groups menu or by dragging avatars in
  the rail; the rail shows group membership. (Existing behaviour in TABLE-FEATURES.md; this only
  moves the UI.)

## Look and feel: an RPG app, not a Discord clone (decided)

- **Rounded avatars and softened (rounded) corners everywhere** (decided; the square-corner mockups
  were rejected). Shape is shared by every theme.
- **Themes are design tokens, not separate stylesheets.** A theme is one token set (surfaces, ink,
  gold/accent, speaker glow, whisper and DM-message colours) with a **dark and a light variant**;
  light/dark follows the OS, the theme is the user's choice in Settings. Adding a theme later is
  adding one token block plus a contrast check, no component changes. Everything else — shape,
  spacing, the bundled fantasy heading font, d20/scroll icons in place of emoji, subtle textures —
  is shared, which is what keeps 3–5 themes cheap. **(my call: fonts and textures are not per-theme.)**
- **Launch set (decided: 3–5, Dragonfire default):** **Dragonfire** (charcoal-black + red, matches
  the logo; light variant parchment), **Arcane night** (indigo + gold), **Dungeon stone** (muted
  grey-green), plus two **(my call)**: **Verdant** (forest/druid green) and **Frostbound** (cold
  blue-silver). More can follow.
- **Motion:** only a glow on the speaking ring; no animation while the window is hidden
  (CLAUDE.md principle 5). Whispers and DM messages differ by colour **and** label.
- **Accessibility:** every theme/variant must pass a text-contrast check (WCAG AA) in a unit test over
  the token table; colour is never the only signal.

## The settings cog (one screen with sections)

Audio devices and levels · Profile / account (sign-in, server, characters) · Session / campaign
(DM-only parts hidden for players: members, invites, DM swap) · Schedule / RSVP **(my call: the old
Sessions panel lives here)** · Recording history **(my call)**. A single secondary window, not one
per section.

## Separate screens (secondary windows)

- **Handouts.** Expand to read; the DM creates and shows/hides. Same content as today's panel.
- **Party inventory.** Expand to read history; the DM creates drops (see below).
- Both open from the chat chips; Handouts is also reachable from the cog.

## Party inventory (decided)

A **shared pool**, nothing more. Not a character sheet; players keep their own sheets.

- The DM drops items (and coin) into the pool. Items appear in chat as a card and in the Party
  inventory screen.
- A player **grabs** an item. The item is marked with **who grabbed it** and when; everyone can see
  it (the "grabbed" indicator, in the card and the list). When grabbing, the player chooses **for
  self** or **for party** (the item stays in the pool, marked as party-held **(my call on
  representation: a `claimed_for` of `self` or `party` beside `claimed_by`)**).
- **Coin split:** a coin amount can be **split** equally among party members. **Default recipient
  set is every player in the campaign, including offline ones**; the DM may deselect. Each share is
  recorded as a grab by (or for) that player **(my call)**. Remainders (amount not divisible) stay
  in the pool as a party coin remainder **(my call)**.
- Today's loot model claims an item whole by one player, once (TABLE-FEATURES.md "Loot drops with
  pickers"); this extends it with `claimed_for`, a coin type, and splits. The claim stays a single
  conditional `UPDATE` so simultaneous grabs have exactly one winner.

## Slash commands

Kept small, role-aware, with an autocomplete palette on `/`:

| Command               | Who    | Does                                                   |
| --------------------- | ------ | ------------------------------------------------------ |
| `/w <name> <text>`    | all    | whisper to one player                                  |
| `/dm <text>`          | player | message only the DM                                    |
| `/me <text>`          | all    | emote                                                  |
| `/voice <name>`       | DM     | choose the DM voice (hidden until Step 6 ships)        |
| `/loot …`, `/take …`  | DM / player | add to / grab from the Party inventory (aliases of the UI) |

Dropped from the old app: `/roll`, `/condition`, `/env`, `/ic`, `/ooc`, `/give`, `/drop`,
`/spend`, `/earn`, `/loot-split`, `/loot-random` (the coin/item bookkeeping is the sheet's job; the
pool and its split cover what the table needs).

## Tray, platform fixes

- **Tray icon:** the dragon logo with a small **status badge** in the bottom-right corner (like
  Nextcloud's): green live, amber muted, red recording (hollow red = paused), grey badge plus a
  desaturated logo when disconnected. Badge is a plain dot (tray icons are 22–32 px); the state is
  also in the tooltip. Replaces the current flat coloured disc. (decided)
- **Tray menu** shrinks to: Show window, Mute/unmute, Connect/Disconnect, Quit. The icon keeps its
  live / muted / recording / disconnected states (it is the one thing visible while hidden).
- **Theme** follows the OS preference by default (`prefers-color-scheme`), with no manual toggle
  required; a manual override may exist in Settings, but the default is always the OS.
- **NVIDIA + Wayland crash:** the client died on first webview with `Gdk Error 71 (Protocol
  error)`. Fix in Rust at startup on Linux: set `WEBKIT_DISABLE_DMABUF_RENDERER=1` unless already
  set; document it. (Confirmed working as an environment variable on Andy's machine.)
- **Icons:** app/window/panel icons come from the old frontend's `branding/app-logo.png` and
  `favicon.*` (already done, uncommitted at time of writing).

## Build order (each step shippable)

1. **Shell:** one window, theme tokens + Dragonfire (dark/light), theme-follows-OS, badged tray icon, reduced tray, NVIDIA/Wayland fix, Connect/Disconnect
   (chat-only mode), top bar with record state and timer. Old panels removed from the tray.
2. **Rail:** avatars, speaking highlight, mute badges, DM pinned, hover card.
3. **Chat:** avatars, whisper/DM colouring, slash commands and palette, handout and loot cards.
4. **Cog and secondary windows:** Settings (sections above, incl. theme picker and the other four themes), Handouts, Party inventory screens.
5. **Party inventory model:** `claimed_for`, coin items, split, grabbed indicators (backend + UI).
6. **DM voice effects:** Rust-side real-time voice change on the DM's capture path (new audio work:
   its own design note first, including latency and CPU budget); then the picker appears.
   DM sound effects drawer and Groups menu land with Steps 3–4 since their backends exist.

## What is left to the builder

Exact visual style (Radix tokens, spacing), keyboard navigation of the rail and palette, window
min/default sizes and remembered position, how the DM drag-to-group gesture behaves, empty and
error states, and the Step 6 voice design.

## Not verified yet

The existing panels have never been opened in a working Tauri window (the first attempt hit the
NVIDIA/Wayland crash above). Nothing in this design has been tried on a real desktop.
