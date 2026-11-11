# Changelog

All notable changes to the desktop app and the server, one section per **release**. Dev builds
(`-dev.N`, `-rc.N`) are not listed here; they are collected into the release they lead up to. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [semver](https://semver.org/).

**Every release must have its section here before it is tagged.** The release workflow uses that section as
the GitHub release notes and refuses to build a release without one. How to write it:
[docs/guides/RELEASING.md](docs/guides/RELEASING.md).

## [Unreleased]

### Added

- **Server images are published** to GHCR on every release (`vtt-chat-backend`, `vtt-chat-worker`), so a server pulls a release instead of building it. `setup.sh` pins the stack to its release line (MAJOR.MINOR), so `docker compose pull` takes bug-fix patches and never a new minor. `docker compose up --build` still builds from source.
- **The server keeps the app update feed current by itself.** It watches the GitHub releases and offers players the newest patch of its own MAJOR.MINOR, with nothing to approve. `UPDATES_SOURCE=github` (the Compose default) sends players to GitHub; `mirror` makes the server download, verify (against the app's update key) and serve the installers itself, keeping only the newest patch plus one previous. `vtt-admin updates sync` runs it now and `updates status` shows the source and what the mirror holds. `vtt-admin updates publish` still works for air-gapped servers.
- **Protocol check between app and server.** The app now sends the protocol version it speaks on every request, and `GET /api/version` reports the server's version and protocol. A server and app on different protocols no longer half-work: the app is told clearly to update. Normal patch releases never change the protocol.

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
