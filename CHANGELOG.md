# Changelog

All notable changes to the desktop app and the server, one section per **release**. Dev builds
(`-dev.N`, `-rc.N`) are not listed here; they are collected into the release they lead up to. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [semver](https://semver.org/).

**Every release must have its section here before it is tagged.** The release workflow uses that section as
the GitHub release notes and refuses to build a release without one. How to write it:
[docs/guides/RELEASING.md](docs/guides/RELEASING.md).

## [Unreleased]

### Added

- **The DM can write notes and manage the schedule from the web chat.** On `/app`, the DM gets a **+** button on Handouts (write a note in Markdown with a Write/Preview switch, save it as a draft or show it to the table, edit it later, show, hide or delete it) and a **Schedule a session** button on Sessions (title, date and time in your own time zone, length and notes; edit or cancel any upcoming session). Players' lists update live, and notes and session notes now show as formatted text in the web app. A shown handout that is edited now tells the desktop app to refresh too (`handout.changed`, additive).
- **Each language in `/say-<language>` has its own typeface**, in both apps: elegant italics for Elvish, a heavy slab for Dwarvish and Giant, a blackletter for Infernal, a rounded face for Halfling and Gnomish, handwriting for Goblin and Orc, and so on. The fonts ship with the app and load only the first time a line in that language is shown (about 150 KB in total, nothing at startup).
- **An Account page in the browser** (`/account`, in the header and the phone menu): change your display name and picture, see which recording notice you accepted and when, set or change your password (the form stays folded away until you press the button), and see every device you are signed in on and sign any of them out (or all the others). Changing the password signs your other devices out. Sign-out buttons need a second press to confirm.
- **Operators: purge raw audio when the next session starts** (off by default): `vtt-admin settings set audio-purge-next-session on` deletes the raw audio of a campaign's earlier, fully processed recordings when a new recording starts there. The text (transcripts and summaries) stays; recordings still being processed, and other campaigns', are never touched.
- **More summaries per recorded session:** a chapter summary for each part either side of a pause, and a summary from each player character's point of view, next to the session and DM-only ones.
- **Typed lines in the History transcript:** what was typed into the public chat during a recording now shows in the transcript among the spoken lines, marked "(typed)" (it was already in summaries and search). Out-of-character lines and whispers stay out.
- **Operators: NVIDIA GPU support for recording** (`infra/compose/compose.gpu.yml`), including GTX 10-series cards. Whisper and the language model leave the GPU a minute or two after the work is done. GPU defaults: Whisper `large-v3-turbo` and `qwen3:8b`.
- **Operators: an end-to-end smoke test** for the recording pipeline (`infra/records-smoke/compose-e2e.ts`).

- **The desktop app announces its protocol on the live connection too**; a server on a different protocol answers "update required" and the app shows the update strip instead of retrying.
- **A page-not-found screen** in the site's own frame for unknown addresses (it was a plain white text page).
- **Ask to join a table.** Someone with no campaign sees the tables that are open to requests (name, DM and player count) and can ask to join with an optional message; people who already have a campaign can ask to join others too. **The DM approves or declines** (not the operator), gets a badge and a notification for new requests, and can switch **Allow join** off in the campaign's settings to hide the table. Allow join is on by default. Operators can hide all listings with `vtt-admin settings set campaign-directory off`. You can have up to 5 requests open, and ask again 7 days after a decline.
- **Who is at the table, in the web chat.** An avatar strip (a rail on wide screens) shows everyone in the campaign with an online, away or offline dot and a DM tag. Hover with a mouse, or click or tap, for their character, race, class and level. The web chat's header now has a burger menu and a "Get the app" button, and the "To:" picker is gone (whisper with `/tell`, `/w` or `/dm`).
- **Chat commands, with autocomplete, in the desktop app and the web app.** Type `/` for the list. A plain line is in character; `/say` (quoted, serif), `/do` or `/me` (a stage direction) and `/ooc` (small, muted, tagged OOC) set how a line looks; `/tell name` or `/w name` whisper to one person (names complete as you type) and `/dm` whispers to the DM. `/say-elvish`, `/say-dwarvish` and the other D&D languages style the line to suit with a small "in Elvish" caption, and never change the words. `/late`, `/cant` and `/work` post an out-of-character note and set your RSVP for the next session; `/brb`, `/afk` and `/back` post a ready-made note. **Out-of-character lines are never recorded**, and stay out of transcripts, summaries and search. Chat lines carry a kind and an optional language (additive wire fields, so no protocol bump in 0.4).
- **The app warns when it and the server are on different versions** (MAJOR.MINOR), and shows both versions in Settings, Account. If the app is older it offers Update now; if it is newer it tells the player to ask their DM to update the server. Patch differences never warn.
- **The web app is the phone app, and the choice after sign-in depends on your device.** Phones and tablets go straight into the web app, already signed in, with no download options. Computers keep the desktop app as the default, with a secondary "Open the web version instead" button that signs you in to the web app without a second login.
- **A public `/full-app` page** explains what the desktop app adds over the web version (voice with echo cancellation and noise filtering, the recording consent cue, the DM soundboard and audio controls, tray quick-mute and hotkeys) and how to get it. The address is copyable, with a share button where the browser supports it, and the phone app's menu links to it.
- **A starter campaign for the first Admin.** If the first account has no campaign and the instance has none at all, one is created with a randomly chosen dry-humour name (for example "Several Goblins Short of a Plan") and the Admin becomes its DM. It happens at sign-in, so an existing first account gets one the next time it signs in, and `vtt-admin user create` does the same for a new first Admin. It can be renamed. How later accounts get into campaigns is unchanged.
- **A download page at `/download`** with a tab per system (Windows, macOS, Linux), each with its own step-by-step instructions and download button. Linux has a switch for `.deb`, `.rpm` and AppImage, each with its own commands. It opens on the visitor's own system and ends with the server address to type into the app. The landing page and the post-sign-in step link to it.
- **A landing page at the server's address**, with the app logo, a short "what is this" and the three ways in (invite code, sign in, request an account), and the same page frame, logo and phone-friendly layout on the join, connect and status pages. The landing page shows the dragon artwork, and a short looping clip on wide screens (never on phones, in data-saver, or with reduced motion).
- **A new Default theme** for the app: violet surfaces to match the web pages, an ember-orange highlight, a teal glow and a pink whisper edge, in light and dark. It is now what new installs start on; the other themes stay as they were, and nobody's chosen theme changes.
- **A faint watermark behind the chat** (tinted by the theme) and a small picture on the empty History, Handouts and Loot lists.
- **Visitors can ask for an account (off by default).** Turn it on with `vtt-admin settings set signup.requests on` and the server's front page shows a small "Request an account" form (name, email, optional message). Nothing is created until you approve: `vtt-admin signup list` shows who asked, `signup approve <id|email>` makes the account and prints a one-time sign-in code to hand over on a side channel, and `signup reject <id|email>` turns a request down. The person enters the code under "I have a sign-in code" and sees the recording notice at that first sign-in. `vtt-admin status` counts the requests waiting. The form is rate-limited, holds at most 200 open requests, and answers the same whether or not the address already has an account. This adds one public endpoint (`POST /api/signup-requests`) and a `signupRequests` flag in `GET /api/auth/providers`; 0.4 is unreleased, so no version bump.
- **Connect the app through the browser.** After joining on the web page, press **Open VTT Chat**, or type the short code it shows into the app. Or start from the app: press Connect, then scan its QR code with your phone (or open its link in any browser), sign in and approve at `/connect`. The button carries a long one-time link; if it will not open the app, "Can't open the app? Show a code" reveals a short code to type under "Have a code instead?" in the app (hidden until needed). Both last 5 minutes. The app never sees your password, and the server can change its sign-in methods without a new app.
- **Server images are published** to GHCR on every release (`vtt-chat-backend`, `vtt-chat-worker`), so a server pulls a release instead of building it. `setup.sh` pins the stack to its release line (MAJOR.MINOR), so `docker compose pull` takes bug-fix patches and never a new minor. `docker compose up --build` still builds from source.
- **The server keeps the app update feed current by itself.** It watches the GitHub releases and offers players the newest patch of its own MAJOR.MINOR, with nothing to approve. `UPDATES_SOURCE=github` (the Compose default) sends players to GitHub; `mirror` makes the server download, verify (against the app's update key) and serve the installers itself, keeping only the newest patch plus one previous. `vtt-admin updates sync` runs it now and `updates status` shows the source and what the mirror holds. `vtt-admin updates publish` still works for air-gapped servers.
- **Download links appear by themselves.** The front page (signed out) and the page after sign-in now show a download button for the visitor's system, with the other platforms as links and the Linux `.deb`/`.rpm` listed, taken from the release the server offers. Nothing to configure; `CLIENT_URL_WINDOWS`/`_MACOS`/`_LINUX` still override it. This adds an optional `linuxDeb`/`linuxRpm` to `GET /api/downloads` (additive).
- **Protocol check between app and server.** The app now sends the protocol version it speaks on every request, and `GET /api/version` reports the server's version and protocol. From this release on, an app on a different protocol from its server is stopped with a clear "update" message instead of half-working. Normal patch releases never change the protocol.

### Changed

- **Enter sends, Ctrl+Enter makes a new line**, in both the desktop app and the web chat (Shift+Enter works too; on a phone Enter stays a new line and Send sends). The desktop app's message box is now a taller, three-line box that holds multi-line messages.
- People using the web chat show as **On the web (chat only)** in the members lists of both apps, instead of "Offline (chat only)".
- A web chat tab whose session has ended (expired, or signed out elsewhere) returns to the sign-in screen with "Your session ended. Sign in again." instead of reconnecting forever.
- Sign out on the web waits for the server before showing signed-out, and says so if the server refuses.
- Web chat: Enter sends on a computer (Shift+Enter for a new line); the members rail follows live presence; the join-request box clears after sending; the sign-in header no longer clips on phones.
- **Settings, reorganised and tidier.** Five tabs: Profile, Campaign, Sessions, Audio and Notifications. Profile now holds your larger photo (click it to change it), your name (click the dotted underline to rename), sign-out as an icon at the top right, the theme, and at the bottom the app and server versions, updates and start-with-the-computer. Notifications have their own tab, General is now Audio, there is more padding, rows sit in tidy cards, and the Sessions tab's schedule button is an icon at the top right with a tooltip.
- Web chat: the card is the same width as the other pages on tablets and desktops, the bottom tabs show the same icons as the desktop app, and copy buttons are an icon with a tooltip.
- **Browser sign-in is now a secure, long-lived cookie.** The site and the web app (`/app`) keep you signed in for weeks: the cookie is HttpOnly (page script cannot read it) and refreshes each time you open the app, and only expires after the operator's offline limit (30 days by default) without you opening it. Pressing **Sign out** ends it. After signing in on a computer, **Open VTT Chat** comes first, then the web version, then a "Don't have the app yet?" download section. The header menu is now **Chat** (opens `/app`), **Download** and **Status**; Chat and Download show only while signed in, and the Home link is gone (the logo goes Home).
- `/app` now shares the Home pages' look and the app's Default colours, and is a centred card on desktop browsers.
- The app's version is now 0.4.0, matching the server.
- **Downloading the app needs a signed-in account.** The download page and `GET /api/downloads` require a session (visiting `/download` signed out shows a sign-in form first), and the home page's signed-in view shows the download steps in the page. Download links are no longer on the public status page, `/api/status` or the invite preview. The app's update feed (`/updates`) is unchanged.
- The app's signed-out screen now matches the web home page (hero artwork, server card). **Connect** opens the server's web app in your browser, and the app signs in by itself when you press **Open VTT Chat**. The code, QR and typed-code options moved under **Other ways to connect**.
- **Open VTT Chat now signs the app in straight away** (when it is signed out), with no extra button, and a link opens the main window instead of a second Settings window.
- **The app trusts the system's certificate store**, so a server on a private CA or an internal certificate (such as the local Caddy one) works once that CA is installed on the machine. `infra/compose/trust-local-ca.sh` does it on Linux for a local try-out. Servers with public certificates are unaffected.
- **The app no longer has a sign-in form.** Password, emailed-code and single sign-on sign-in now happen in the browser. **Wire change: this needs a matching 0.4 server and app (`PROTOCOL_VERSION` 2).** For development only, `VTT_DEV_SIGNIN=1` brings the old forms back in a collapsed Developer sign-in block.
- The app's **Have a code? Type it here** box takes any one-time sign-in code: a link code from the web page, an emailed code, a `vtt-admin user code` code (for a player with no browser at hand), or the code the single sign-on page shows.

### Fixed

- The Linux download format selector no longer overflows its card on phones; the chat box hint is shorter on phones.
- The server no longer offers a new release to the update feed or the download page until its Windows, macOS and Linux installers have all been uploaded (a half-published release used to hide the update from whoever was still missing).
- The web chat no longer scrolls 10-20px past the bottom of the page.
- Home, Download, Status and the web chat share one 640px column.
- Long install commands on the download page scroll inside their block instead of widening the page, and each has a Copy button.
- The server's update sync honours `UPDATES_INCLUDE_DEV=true` as well as `1`.
- The macOS updater archive is named with its architecture, so the server offers an Apple-silicon build only to Apple-silicon Macs (it was listed as Intel).
- **Under Docker Compose the server now sees each player's real address.** Caddy reaches the backend over the Compose network, which the backend did not trust, so every player shared one rate-limit bucket (one busy table could lock everyone out of sign-in for a few minutes). The new `TRUST_PROXY` setting (default `loopback`, `loopback, uniquelocal` in the Compose file) fixes it; the device-approval page shows the right address too.

### Known limits

- Deep links (Open VTT Chat) may not work on the Linux AppImage; type the code instead.
- The protocol check starts with this release. Apps up to 0.3.2 never sent it, so a 0.4 server does not tell them to update: their old sign-in keeps working until the player installs 0.4. A 0.4 app on a 0.3 server says the server is older than the app and should be updated.
- If the recording notice changed since you last accepted it, the web page asks you to accept it before it connects the app. The app itself cannot show the notice.
- The web has no Devices list yet; an operator can sign a player out everywhere with `vtt-admin user revoke-sessions`.

## [0.3.2] - 2026-11-11

Window placement and the app's name and packaging. No change to how the app talks to the server: it works with
any 0.3.x server.

### Changed

- The main window opens **600 px wide** and fills the screen from top to bottom with about 50 px of space above
  and below, centred across the usable area. It works from the space the system says is free (so a taskbar,
  dock or menu bar is left alone, on any side) and scales with the display. The first launch of this version
  forgets any remembered size and position once; after that your own changes are remembered again, unless the
  window would no longer fit on the screen.
  On Linux (Wayland) the desktop does not tell programs where its panels are, so the window leaves **120 px** at
  the bottom for a dock or taskbar. The app sets only the window's width and height, before it appears, and
  leaves the position to the desktop, which centres it on the screen you are using. The window always opens at
  that default, because a remembered size grew on each reopen and a remembered "maximised" state opened the
  narrow window full screen.
  The app keeps a short `window-layout.log` in its data folder (the numbers it saw and chose) to help diagnose
  a window that opens in the wrong place.
- The app is now called **VTT Chat** everywhere the system shows a name: Windows Task Manager, the Linux
  application menu and the macOS Dock. (It was "VTT Chat App".) Installer files are named `VTT.Chat_…` to match.
  Anyone who already installed 0.3.1 on Windows should uninstall "VTT Chat App" first, so the two do not sit
  side by side.
  On Linux the package is now named `vtt-chat` (it was `vtt-chat-app`); remove the old one first with
  `sudo apt remove vtt-chat-app` (or `sudo dnf remove vtt-chat-app`), or the two will fight over the same files.
- The `.deb` and `.rpm` ship AppStream data, so software centres (GNOME Software, KDE Discover) can show the
  name "VTT Chat", its icon and publisher once the app is installed.
- Linux packages now carry a description, publisher, homepage and license, so software centres show them
  instead of "(none)" and "unknown".
- Linux: the app is filed under a menu category and ships icons at several sizes; the macOS build now carries a
  proper `.icns` icon. The KDE tray lists the app as "vtt-chat".

## [0.3.1] - 2026-11-11

The first release. (0.3.0 was built but never published; everything in it is here.)

### Added

- **Voice and chat for a table.** Open-mic group voice from a system-tray app (Rust audio engine: echo
  cancellation, RNNoise background-noise filter with four levels, mains-hum notch filters), DM and player
  whispers, party splits, and a DM soundboard with scenes, loops and a character voice effect.
- **Session records.** Server-side recording per speaker with a spoken consent cue, then transcription,
  summaries (session, chapter, character, DM-only) and search that also finds typed chat, never whispers.
  Typed public chat during a recording goes into its transcript. A grace period keeps a recording going when
  the DM drops out.
- **Table content.** Handouts (notes, up to twelve pictures with flip and zoom, PDFs, captions) that open in a
  viewer from chat; loot cards, a party stash, SRD item search and CR-based loot rolls; session scheduling with
  RSVP and reminders; notifications with per-kind switches and quiet hours.
- **Accounts and campaigns.** Local accounts with a first-account Admin, invites by link, code or QR, per-campaign
  DM and player roles with a one-action DM swap, characters with portraits, and optional D&D Beyond
  character sync that shows ability scores, max HP, AC and passive perception.
- **Phone app** at `/app`: chat and whispers, sessions with RSVP, handouts with a flip-and-zoom viewer, history
  with search, and an install-to-home-screen manifest.
- **Retention and cleanup.** Raw audio can be deleted after a set number of days or on demand. The DM can
  delete a session's audio from the History window once the summary is good, and the server warns the DM
  3 days before it clears the oldest audio itself when free disk space is low (`AUDIO_DISK_PURGE=0` turns that off).
- **Operations.** `vtt-admin` for system tasks (first account, storage, backups, recordings, updates), backup
  and restore scripts, a public status page with disk use, Docker Compose and native installs.
- **Updates and releases.** The app updates from the player's own server, only when they click. Dev builds are
  a separate channel: **Settings → General → Include dev builds** (off by default).
- **Windows installer:** choose to install for **just you** or for **all users**.
- A styled dropdown, date picker, text fields and checkbox everywhere; no operating-system form controls.
- `.AppImage`, `.deb` and `.rpm` for Linux, an installer and an `.msi` for Windows, a `.dmg` for Apple-silicon Macs.

### Changed

- The Settings **Profile** tab leads with your account; status and idle settings follow in a tidier card.
- Dropdown lists open under their control and never run off the window.

### Fixed

- **Security:** a player who leaves a campaign is now cut off from its live chat and removed from its voice room
  at once. Every campaign route is covered by an access test.
- **Recording:** a server restart in the middle of a recording no longer leaves it recording invisibly and loses
  the audio; on start-up the leftover recordings are stopped, kept and processed.
- **Windows:** a black command window no longer opens beside the app.
- **D&D Beyond numbers:** hit points that grow per level and armor class that adds an ability (Draconic
  Resilience, Barbarian and Monk Unarmored Defense) are now counted.
- The History transcript no longer breaks on the speaker's name.

### Known limits

- Windows and macOS builds are not signed with a paid certificate, so first launch shows a warning
  ([how to get past it](docs/guides/INSTALLING-THE-APP.md)). Intel Macs are not built.
- Mage Armor and other spell effects are not counted in the D&D Beyond armor class.

[Unreleased]: https://github.com/AndyProsser/vtt-chat-app/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/AndyProsser/vtt-chat-app/releases/tag/v0.3.1
