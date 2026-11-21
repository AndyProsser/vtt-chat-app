# Changelog

All notable changes to the desktop app and the server, one section per **release**. Dev builds
(`-dev.N`, `-rc.N`) are not listed here; they are collected into the release they lead up to. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [semver](https://semver.org/).

**Every release must have its section here before it is tagged.** The release workflow uses that section as
the GitHub release notes and refuses to build a release without one. How to write it:
[docs/guides/RELEASING.md](docs/guides/RELEASING.md).

## [Unreleased]

### Added

- **A past session opens on its tale, with a title.** In both apps the History screen shows the tale first; the chapter and hero summaries fold under **More detail (6 chapters · 4 heroes)** (nothing is removed), and the line under a session reads "27 min · Tale ready · 6 chapters" instead of a list of kinds. The storyteller now opens each new tale with a short title in its own voice (for example "The Weeping Anchor"), shown as the tale's heading. The History list itself keeps the date as its title until 0.7.0, when the server can send the title with the list.
- **A cap on how many tables record at once.** `vtt-admin settings set recording.max-tables <n>` (default 2; 0 means no limit). A Game Master who starts a recording past the limit is told the server is already recording as many tables as its operator allows. Only a start is refused: a table already recording is never interrupted, and chat, voice and processing are unaffected. (Migration 0044.)
- **The campaign switcher shows each table's next session, with a quick answer.** In both apps, under every table you are in: the next upcoming session (its name and when: "Today, 7:30 pm", "Tomorrow", "Sat 7:30 pm") and three buttons, can make it, running late, can't, to answer without opening the table. It works for a table the app is not in, so you can reply to one you are not currently connected to. Nothing changes on the server: it uses the routes the schedule already had. On the desktop it needed one new, fixed-path command in the app (`table_api`), so a desktop app older than this build does not show it.
- **The phone web app marks a table you run with the crown icon** (as the desktop app does), instead of a "DM" label.
- **OpenAI for the summaries (opt-in), explicitly configured like Claude.** `vtt-admin settings set ai.llm.kind openai` with `OPENAI_API_KEY` in the Compose `.env` and a model you name in `ai.llm.model` (nothing is built in, because OpenAI's names and prices move). Optional `ai.llm.price-in` and `ai.llm.price-out` (US dollars per million tokens) give each job a cost in `vtt-admin jobs list`, which now has a "cloud AI" column for Claude and OpenAI. Same safeguards as Claude: only transcript text leaves the server, the apps and status page show the off-site notice, and with no key, no network or a refusal the job finishes on the local model. `remote` stays for Ollama and any other OpenAI-compatible server. Needs no new migration beyond Claude's.

- **Claude for the summaries (opt-in).** `vtt-admin settings set ai.llm.kind claude` (with `ANTHROPIC_API_KEY` in the Compose `.env`) has Claude write the notes, tales and the Game Master's brief instead of the local model; `ai.llm.model` picks the model (default `claude-sonnet-5-5`, about thirty cents for a five-hour session). Whisper is unchanged, so no audio leaves the server, only transcript text, and the apps and the status page show the off-site notice while it is on. With no key, no network, or a refusal from Claude, the job finishes on the local model. `vtt-admin jobs list` has a new column with each job's tokens and an estimated cost. Needs the update's new database column (applied by the server on start).

- **Campaign memory.** After each session one more step reads the scribe's notes and keeps a short list of the people, creatures, places, groups, quests and items the party has met, each with a one-line gist and what it is also called. The next sessions' tales and the Game Master's brief are shown the entries their notes mention, so the tale can say "once again the party crossed paths with Gary", and the brief can say which quests are still open. It is built only from what was said and typed at the table (never whispers or private audio), and only for the server's own use for now: there is no screen for it in the apps yet. The operator reads and fixes it with `vtt-admin memory show <campaign-id>` and `memory forget <campaign-id> <name>`, and can turn it off with `vtt-admin settings set ai.memory.enabled false` (it costs one more model call per session). It goes into a `.vttcampaign` export (older exports import fine, with an empty memory), a session's entries stay if the session is deleted, and a session processed again does not teach it twice. Needs the update's new database table (applied by the server on start).

### Changed

- **Updated services:** Valkey is pinned to **8.1.12**, a security release (CVE-2026-130822, a crash when `maxmemory-clients` is on, which this stack does not enable; the release also fixes many crashes and leaks), instead of the floating `8` tag. Ollama is **0.40.17**, LiveKit's server is **v1.13.11** (deadlock, goroutine-leak, crash and reconnect fixes since v1.13.5; the native installer too) and cloudflared is **2026.11.1**. The GPU Whisper build uses **whisper.cpp v1.9.5** instead of whatever `master` was when it was built. To get the Valkey fix, update (`vtt-admin update`) or run `docker compose pull`. Valkey 9.1 and Postgres 18 come with 0.7.0.
- **The scribe's notes are laid out under headings, and checked.** Events, Decisions, Combat, Non-player characters, Locations, Loot, Quests, Secrets and reveals, Character moments, and Memorable quotes (word for word, with who said them). The Game Master reads them under those headings in the session notes, and the tale and the Game Master's brief are written from them. A whole session's notes are kept to about 3,000 words. If a model's notes cannot be read (no headings, or nothing under them), the scribe is first asked to lay them out again, then to read that part of the transcript again, and after three readings the job fails and is retried later, rather than carry on with weaker notes. Sessions processed before this keep their old notes until reprocessed (`vtt-admin recording reprocess <id>`).

- **The storyteller's voice is now chosen by the campaign.** The five bards tell a session in their own way: the Tavern Bard (grandiose, as before), the Dry Historian (a measured record), the Tipsy Minstrel (an unreliable, chaotic narrator that may forget, bend or invent, and may let slip a secret from the Game Master's own notes, which choosing it accepts), the Wry Jester (pokes fun at the party's decisions) and the Bored Court Scribe (understates everything). Every other bard stays close to the facts, with a little invention in the telling, and never sees the Game Master's notes. A campaign whose storyteller the operator has switched off is told by the Tavern Bard. The tale's length ceiling follows `ai.tale.length` (400, 800 or 1,200 words; half of that for a part or a character), shorter when little happened, and `ai.tale.content` (`clean`, `default`, `graphic`) now shapes how violence and language are told.
- **The Game Master's brief is now the Chronicler's.** 200 to 300 words under fixed headings (Non-player characters, Open threads, Items, Locations, Hooks, Continuity warnings), written to help run the next session. It reads the start of the Game Master's own notes, to link open threads to what was planned and to flag where the session went against it. Loot is still listed exactly. The label in the apps is still "DM brief".

### Added

- **Misheard names are corrected in transcripts.** After Whisper has written a line, the campaign's own names put it right: the Game Master's approved glossary (with its aliases), characters, players, the Game Master's scene names, and handout and loot titles. A known wrong spelling (an alias) is replaced exactly; a capitalised near-miss of a long name ("Ravenshaid" for "Ravenshade", "Blackstone Kepe") is replaced too. Short names, lower-case words and ordinary words are left alone. It runs on the server's CPU for a few milliseconds a line, and it is on by default. It reaches transcripts of recordings processed after the update; `vtt-admin recording reprocess <id> --retranscribe` redoes an older one.
- **`ai.transcription.glossary`** (`vtt-admin settings set ai.transcription.glossary corrections|prompt|both|off`): `prompt` also hands Whisper the names as its starting prompt, `both` does both, `off` neither. The prompt is **off by default**: an earlier name prompt made accuracy worse, so it is there to try, and is kept only if it measures better on your own table.

### Fixed

- **One table's sessions are now processed in the order they were recorded.** Before, a failed session's job went back to the queue with a delay and the table's _next_ session's job could be taken first, so session 3 could be summarised without what session 2 added to the campaign memory. A session's job now waits while an earlier session of the same table has a job that is queued, running or failed; a failed one holds the rest until `vtt-admin jobs retry` or `jobs release <id>` (the operator's explicit override: the later sessions go ahead without it). `jobs list` shows what a queued job is waiting for. Reprocessing the earliest session and the other kinds of job are never held back. (Migration 0045.)
- **One worker per database is now enforced.** A second worker stands by and takes over if the first stops, instead of working alongside it (several workers are a future stage, [Stage 17](ROADMAP.md); `ALLOW_MULTIPLE_WORKERS=1` skips the check, unsupported).
- **A long campaign name no longer breaks the desktop campaign switcher.** It wraps inside its row and the current-table tick keeps its place; the full name is in the tooltip. The phone picker wraps long names too.
- **`vtt-admin backup` and `vtt-admin restore` work again on a Compose install.** Since the container hardening of 0.5.2 the backup's uploaded-files step failed with `tar: can't open … Permission denied` for every upload and stopped before saving the configuration, so no backup since then was complete (the database dump was fine); a restore would have failed the same way at `chown`. The throwaway root containers that read and write the volumes now add back only the capabilities they need (`DAC_READ_SEARCH` to read; `CHOWN`, `DAC_OVERRIDE` and `FOWNER` to restore). **Take a fresh backup after updating**: an older backup folder has an incomplete or missing `media.tar.gz` and no `config/`.
- **`vtt-admin update` no longer ends with shell errors:** the update replaces the `vtt-admin` script while it is running, and bash then read the new file from the old position (`term_env: command not found`, `syntax error near unexpected token ;;`, then a help screen). The command now stops right after the update and exits with the installer's status. The update itself was never affected; the fix reaches you with the update after next, since the old script is what runs the update.

### Changed

- **`vtt-admin` output is easier to read:** on a terminal it now draws in colour, with ✔/▲/✖ marks, aligned tables with headings (accounts, campaigns, recordings, jobs, sign-ups) and settings grouped by area. **`vtt-admin status` shows more:** besides each service, what the instance is doing (sign-ups waiting, a live recording and its campaign, the AI job queue, the app version offered) and the machine's CPU, memory and disks as usage bars. A nearly full disk or a failed job is a warning; only a service that is down makes it exit 1, as before. Add `--plain` for plain text (piped output is plain on its own); scripts that read the old line formats need updating.
- **`vtt-admin help` is easier to read:** every command is listed in groups (accounts, campaigns, recordings, updates, this machine) and wrapped to the width of your terminal, so long descriptions no longer run off the edge or break mid-word. `vtt-admin <group>` (for example `vtt-admin campaign`) shows just that group, and a mistyped command shows its group's commands. A native install's help also lists the `systemctl`, `journalctl` and backup scripts that do the machine jobs. The terminal width reaches the help after the next server update.

### Fixed

- **Storyteller dropdown:** the chosen bard is now shown by highlighting its row (gold tint and edge, filled badge) instead of a tick that sat on top of its badge.

## [0.6.1] - 2026-11-20

A fuller sound deck, the table's page and Invite on the phone, the first macOS build for Intel Macs, and tidier loot and PDFs. A **PATCH** release: no protocol change, so 0.6.0 apps and servers work together. **Operators:** update the server first (the storyteller picker asks it which storytellers you offer), then `vtt-admin updates sync`. **Players:** update the app.

### Added

- **Operator controls for the AI storyteller** (`vtt-admin settings`), stored now and used by the storyteller prompts in a later 0.6 release: `ai.tale.length` (`short` for a CPU-only server, `default`, `long` for a GPU or cloud model), `ai.tale.content` (`clean`, `default`, `graphic`) and `ai.storyteller.<name> on|off` for the Dry Historian, Tipsy Minstrel, Wry Jester and Bored Court Scribe. The Tavern Bard cannot be turned off and is the fallback: a campaign whose storyteller you turn off is told by it. The Settings → Campaign picker shows only the storytellers your server offers. The installer takes `--content clean|default|graphic` and asks on a fresh install with recording on. No protocol change (one new read-only route, `GET /api/campaigns/:id/storytellers`).
- **Six new sounds for dungeons, picked by Andy** (all public domain): rats, a metal scrape, water drips (three takes), a rockfall (two takes), a distant shriek and a chain gate. The Unease board's first eight buttons are the deck's defaults (chains, footsteps, rats, bats, rockfall, a distant shriek, a water drip, a metal scrape). The Dungeon, Cave and Dungeon halls scenes drop them in at random.
- **The phone web app has the table's page, Invite and Leave.** Tap the table's name for its page: everyone reads the name, the description and who tells the tales; the Game Master edits the name and description; a player can leave (the Game Master cannot, as on the desktop). The Game Master also has **Invite** in the menu: one link for the whole group with **Copy link**, **Copy invite message**, a **QR code** another phone can scan, and a button that stops every link in use. Changing the storyteller and handing over the DM role stay in the desktop app.
- **A macOS app for Intel Macs.** The release builds a second macOS installer on an Intel runner; the download page offers **Apple silicon** and **Intel** side by side (when the server has both), and each Mac is updated with its own build. (`CLIENT_URL_MACOS_INTEL` sets the Intel link by hand.) Not yet built on a real Intel Mac: the first dev build shows whether the Intel build compiles.
- **An old browser is told so, instead of showing a blank page.** If the browser cannot run the web app (it needs ES modules, `structuredClone`, `100dvh` and CSS `color-mix`: Chrome or Edge 111, Firefox 113, Safari 16.2 or newer), the join and phone pages show a notice over the natural 1 picture asking for a newer browser, with an "Open it anyway" link.

### Changed

- **The sound deck shows what is playing.** Each of the Voice, Stingers and Scenes buttons shows a count while something of that kind is sounding (a character voice, the stingers still playing, a running scene), whether or not its panel is open; the sound button in the top bar shows the total while the drawer is closed. A stinger counts until its clip ends (or until you stop it, for a loop).
- **PDFs and pictures open fitted, with a Fit button and drag to move.** A PDF page opens showing the whole page, a **Fit** button brings it back after zooming, and the viewer fills its window (no gap at the bottom); pictures work the same way (they used to fit by width only, so a tall picture needed scrolling).
- **A PDF handout on the phone shows its first page.** The picture is drawn on the phone (the reader loads only when a PDF is opened); tap it, or the button, to open the whole PDF in the phone's own viewer.
- **A wide or tall PDF page now scrolls**, and you can drag it to move around (handouts and GM notes); it stretched the window and cut off before. Zoomed pictures use the same drag.
- **The To confirm list is grouped** into **Mine** (what you took, were given or share) and **Party stash**, each with a count, in both apps, so copying to a character sheet goes in order. Each group has its own **Add all** icon at the right of its heading; the single Add all at the top is gone.
- **In session history the Scribe's notes button stays above the notes** when you open them (it used to jump below).
- **The sound deck holds at most 8 stingers and 8 scenes.** Once it is full the add buttons are greyed with a tip ("The deck holds 8: remove one first"); remove one to pick another. A deck saved with more keeps its first 8.
- **A scene you start from the picker that is not on the deck joins it with a dashed outline** while it plays and leaves when it stops; starting one closes the picker.
- **A new Unease board comes first** (chains, footsteps, creaks, a cave-in, bats, knocking, a thud, a groan) and a new deck starts with it: background noises to keep the table on edge. Most stingers now have an icon that suits them instead of a speaker.
- **The picker's scrollbar no longer covers the favourite buttons.**
- **Starter scenes are alive.** Twelve of them (Dungeon, Cave, Dungeon halls, Castle, Forest, Forest at night, Night, Harbour, Infernal, Tavern, Storm, Mountain) now drop in occasional sounds at random intervals on top of the bed: chains rattling, creaks, footsteps, a distant thud, bats, a splash, a wolf, a bell, thunder. The server's starter catalogue updates when the server does; scenes you made yourself are untouched.
- **The storytellers have new names and a badge each.** The Drunken Bard is **The Tipsy Minstrel** and the Sarcastic Bard is **The Wry Jester** ("bard" belongs to the Tavern Bard), and the picker has more room, with a round emblem beside each (stand-ins until there is portrait art). Your campaign's choice is kept.
- **Smaller loot buttons in both apps** (32 by 24 pixels: short and wide, sitting beside the item's heading), and the **Add all** and **Give** buttons are icons with a tooltip.
- **The desktop join switch says "Allow join"**, with the phone web app's wording.
- **Updated packages:** nodemailer 10.6, pdfjs-dist 6.5, jsdom 31 (TypeScript stays on 6 until its linter supports 7).

### Known limits

- **The tale length, content and storyteller settings are stored and shown, but the storyteller does not use them yet.** They take effect with the storyteller work in a later 0.6 release.
- **The macOS app for Intel Macs is new**; like the Apple silicon one it is not signed, so macOS asks you to allow it the first time ([installing the app](docs/guides/INSTALLING-THE-APP.md)).
- **Not yet tried against the real thing:** GM notes attachments with PDF preview in every setup.
- **Old browsers** (before Chrome or Edge 111, Firefox 113, Safari 16.2) are told to update; the desktop app needs no browser.

## [0.6.0] - 2026-11-20

The **protocol 4** release: loot re-drop and "added to my sheet", a better soundboard mix and per-person volume, GM notes and a glossary, richer character sheets on the rail, a storyteller for each campaign, and installing a server without a domain. A **MINOR** release with a wire change: **a 0.5 app cannot join a 0.6 server and the other way round**, so update the whole stack together. **Operators:** update the server first (`get.sh` or your usual update; the database gets two small migrations on start), then `vtt-admin updates sync` so players are offered 0.6. **Players:** update the app.

### Added

- **Re-drop loot.** The DM can post an item that is still on the table into the chat again; the card **moves** to the bottom (there is never a second card for one item). Only unclaimed loot can be re-dropped.
- **"Added to my sheet".** A player ticks each item they hold, the party stash and their share of split coin once it is on their real game sheet. The tick resets whenever the item moves, and the DM never sees it. It is a small round check box at the right of the item, on the inventory pages only (never on the chat cards); while an item is ticked its take, store and put-back buttons are greyed out until you untick it. Loot buttons are icons with a tooltip in both apps. Players get a **To confirm** filter (their default), and a count on the Loot icon in the desktop app and the Loot tab of the phone web app.
- **Quick mix on the sound panel.** The Stingers and Scenes rows each get a volume slider at the right, so a DM can keep the quiet scene and the louder stingers apart while running the board; moving one changes what is already playing (it used to apply to the next sound only). No change between app and server.
- **Settings → Players, for everyone.** The DM-only Quality tab is now **Players**: every player gets a volume slider per person (saved by account on this machine, so a quiet microphone is fixed once), with a reset button; the DM also keeps the link graphs there. The ceiling is **400%** (it was 200%), with the output soft-limited so a boosted voice does not clip. The hover-card slider is unchanged and shares the same value.
- **A storyteller for each campaign.** The Game Master picks one of five preset bards (the Tavern Bard by default; Dry Historian, Drunken, Sarcastic, Bored Court Scribe) in Settings → Campaign; everyone else can read who it is. The Drunken Bard says plainly what it means and needs a second click: it may let Game Master secrets slip into the tale. It is stored and shown now; the AI work will make it change how the tale is told.
- **Where a session is processed, shown to everyone.** The recording indicator's tooltip and the status page say whether the session is processed on the server's own network (a gaming PC on the operator's network counts as local) or off-site; an amber cloud icon appears beside the REC dot only when it is off-site.
- **GM notes and a glossary (Game Master only).** A notebook button in the top bar opens a window with your **notes** (one Markdown page per campaign, view and edit modes, a list of its headings on the right, picture and PDF attachments you can preview, links that open in your normal browser) and the campaign **glossary** (names, places, items and spells with their other spellings, and room for suggestions to approve). Both are refused to players by the server, and both go into a campaign's export. The operator can cap one attachment with `GM_NOTES_MAX_MB` (default 100).
- **The character sheet on the rail, more of it, and deleting.** Everyone at the table now sees a linked character's armour class, hit points and special senses (Darkvision, Blindsight, Tremorsense, Truesight, with their range) as small icon chips on the rail's hover card, with a **Details** button for a larger popup (classes with subclasses such as "Monk 5 (Way of the Open Hand) / Cleric 4 (Life Domain)", the six abilities, vitals, senses), in both apps. The character screens show the same. A character can now be **deleted** (from this campaign only; the next one takes over if it was the one being played), and adding one from a D&D Beyond link is **one step**: the sheet is read first, so a private or wrong link leaves nothing behind. Characters already linked pick up senses and subclasses at their next sync.
- **Install without a domain, or on another port.** `get.sh --http` serves plain HTTP (for a LAN or VPN, with an IP address or any name as the address; passwords are not encrypted, so only on a network you trust) and `--port 8443` serves on another port (a valid certificate there needs `--cloudflare-dns`). The server's own links and its voice address follow the scheme and port, an update keeps them, and the firewall and the port check use the chosen ports. A free DDNS name already worked as a domain.
- **A notice when the DM gives you something**, stored so a player who was away finds it next time.

### Changed

- **The Storyteller choice is a dropdown** in Settings → Campaign; each bard keeps its one-line description in the open list.
- **Loot buttons are icons with tooltips** in both apps, and loot chat cards no longer carry the "added to my sheet" tick.

### Fixed

- **My sounds upload works again in the desktop app.** The 0.5.4 app refused the upload because the command was missing from its allow-list. (0.5.4 apps keep the fault until they move to 0.6; there is no 0.5.5.)

### Known limits

- **The storyteller is stored and shown, not yet used:** the AI work that changes how a tale is told comes in 0.6.x patches.
- **GM notes and the bard picker are in the desktop app only**; the phone web app does not have them yet.
- **Senses and subclasses** read from D&D Beyond have been tried against recorded sheets only; a character picks them up at the next sync.
- **Plain HTTP installs (`--http`)** send passwords unencrypted: only for a network you trust. A valid certificate on another port needs `--cloudflare-dns`.
- **The macOS app is for Apple silicon only** (no Intel build).

## [0.5.4] - 2026-11-19

Cleaner character screens with D&D Beyond sync that now brings the portrait, your own sounds in the mixer, rules for who may delete a session, and new operator commands: delete a campaign, export and import one. A **PATCH** release: no protocol change, so 0.5.x apps and servers work together.

### Added

- **Export and import one campaign.** `vtt-admin campaign export <id> <file>` saves a campaign to a `.vttcampaign` file (a zip with a manifest; handout files are stored as they are) (members, characters, chat, handouts and their files, loot, schedule, and every session's transcript, notes and summaries) and `campaign import <file>` restores it, on the same server after a delete or on another. Text only: the audio stays with the server backup. An export stops and lists any session that has no transcript yet; `--accept-loss` carries on without them. `--as-new` imports a copy. Members are matched by email; anyone without an account here gets a passwordless one.
- **`DEV_MODE=1` also offers dev builds** to players who turned on "Include dev builds" (the same as `UPDATES_INCLUDE_DEV`).
- **Single sign-on on the web login.** When your server is set up for it (`OIDC_ISSUER` and friends), the browser sign-in now shows **Sign in with single sign-on**. It ends with a one-time code to type under "I have a sign-in code". (The button was missing; the server side already worked.) It sits under the sign-in-code link in the same quiet style.
- **Your own sounds, from the app.** In the sound drawer's cog, the new **My sounds** tab adds a clip from your computer (OGG, WAV, MP3 or FLAC, up to 5 MB), another take of a sound, a new name, or deletes it. An effect appears under Stingers by itself; ambience and music go into scenes. (Scenes could already be edited there.)
- **Characters on the phone web app.** The menu has **My characters**: add a character, edit one, choose who you play, add a picture, and link a D&D Beyond sheet or sync it, all on the existing routes.
- **Operators can delete a campaign, or a single session, for good.** `vtt-admin campaign list` and `campaign delete <id> --yes` remove a campaign with its sessions and audio (the worker deletes the files and the command waits for it), chat, handouts, loot and schedule; without `--yes` it only shows what would go. `vtt-admin recording delete <id>` removes one session the same way. A new daily sweeper also removes handout pictures and PDFs that no handout uses any more (what a deleted campaign leaves behind).
- **Switch character in one tap.** Both apps show your characters as a row of portraits at the top of the character screen; tap one to look at it, press **Activate** (after a confirmation that it changes your name and picture for everyone) to play it, or the plus to add another. Characters still belong to one campaign: to use the same sheet in two campaigns, add it in each.
- **Character numbers as tiles.** A linked character shows armour class, hit points and passive perception, then all six abilities on a single row (modifier large, score small), instead of two lines of text.

### Changed

- **A character screen with fewer words and more icons**, on the phone web app and the desktop app. A linked character has no text boxes at all, only the portrait, the tiles and icon buttons (play, sync, unlink). A hand-made one keeps its form behind the pencil.
- **Adding a character starts from D&D Beyond when the server has the sync on**: paste the sheet's link and the name, race, class, level and picture come from it. A button switches to filling it in by hand, which is the form you get when the sync is off. (A link that fails leaves a plain character called "New character" to fill in; a proper one-step add is planned for 0.6.0.)
- **A linked character's picture comes from D&D Beyond** and follows the sheet; the picture buttons are hidden while it is linked (the server refuses a change too). Unlink to choose your own. A hand-made character picks its picture the way your profile does: click the portrait.
- **A character linked to D&D Beyond keeps what the sheet says.** Name, race, class and level come from the sheet and are read-only in both apps (the server refuses an edit too), instead of being silently put back by the next sync. Your picture stays yours; unlink to edit them yourself.
- **The D&D Beyond box is always there** in the desktop app's character settings. When the server's operator has not turned the sync on it now says so and who to ask, instead of hiding.
- **The Game Master can no longer delete a session's audio.** Raw audio is the server operator's to manage (retention settings and `vtt-admin recording purge`). Any Game Master can still delete a **short test session** (under 30 minutes) from the History panel; it now removes its audio too. A longer session can be deleted only when the app has "Include dev builds" on **and** the operator has set `DEV_MODE=1` on the server; the server refuses otherwise. The "delete the audio only" choice is gone.

### Fixed

- **Loot rows fade out again when your system has animations turned off.** With "reduce motion" on (Windows: Show animations off), a given or taken item vanished at once and the gap closed a second later. The row now still dims out over about half a second; nothing moves.
- **One Back button everywhere in the web app.** Handouts and history already had the quiet filled button; the full-screen pages, My characters, Find another table, Join requests, the sign-in form and the download page had three other looks. They share one now.

- **A linked character's D&D Beyond portrait now imports.** D&D Beyond serves the original upload (often a megabyte or more) whatever size the address asks for, and our 256 KB limit skipped it silently, leaving the letter placeholder. The server now shrinks it to a 256-pixel square (new dependency `sharp`, prebuilt, no extra service) and tries again on the next sync if an import fails.

### Known limits

- A character linked to D&D Beyond shows armour class, hit points, passive perception and the six abilities. Classes with their subclasses, special senses (Darkvision and the like) and a larger detail popup come in 0.6.0, because they change what the server and app say to each other.
- A character's D&D Beyond link is added in a second step: if the link fails, you are left with a plain, editable "New character".
- Single sign-on ends in a code you type under "I have a sign-in code", and has not yet been tried against a real identity provider.
- A character cannot be deleted yet (0.6.0).

## [0.5.3] - 2026-11-18

Loot management and chat history, the phone web app's chat gets loot and handout cards, and session summaries say who got the loot. A **PATCH** release: no protocol change, so 0.5.x apps and servers work with each other. **Update the server first** (see Known limits). Operators: the server's database gets a small update on start. Players: update the app.

### Added

- **Handouts in the phone web chat.** A shared handout appears among the chat lines as a card (title, kind and the start of a note); tapping it opens the whole handout full screen, and Back returns to the chat. The Game Master has Show/Hide, Edit and Delete there as in the Handouts tab; deleting it removes its card from the chat.
- **Edit a handout note in the desktop app.** The Game Master can now change a note's title and text from the Handouts panel (before, only the web app could).
- **Loot cards in the phone web chat.** A loot drop now appears in the web chat among the lines, with who has it and the buttons that fit you (take, store, put back; the Game Master gets a Give list), the same as the desktop app. The cards come from the server's loot list, so they are there after a restart too.
- **Every shared link gets the dragon card.** Pasting the main page, the download page, sign-in or any other address of your server into social media or a chat app now shows the dragon image with a title and a short description (before, only invite links did). Invite links still show the campaign's name, its Game Master and the start of its description. Needs `PUBLIC_URL`, which the standard install sets from your domain.
- **Session summaries say who got the loot.** While a session is recorded, every loot drop, gift, grab, party-stash move, coin split and return is noted with who got what. The Game Master's brief lists all of it under Loot; the players' tale mentions only the notable treasure (magic items, and coin or valuables worth 100 gp or more). Operators: nothing to set; the server's database gets a small update on start.
- **Scroll up for older chat.** The desktop chat loads the last 50 messages; scrolling to the top loads the 50 before them, as far back as the server keeps (the phone web app already did this).
- **Footprint scripts for developers.** `scripts/test/` has scripts for Windows, Linux and macOS that measure an app's real memory and CPU (its whole process tree), each with a self-test, and the README now compares VTT Chat with Discord using them.

### Changed

- **Cleaner buttons on the phone web app.** On a handout, a session and a loot card, the buttons are now icons at the top right of the card (handouts: Show or Hide, Edit, Delete), and "in 11 days" sits on the date line.
- **The Game Master is counted in to a session they schedule** ("Can make it" is already chosen), and "Can't make it" is greyed out for the Game Master in both apps: to call a session off, cancel or reschedule it.
- **Desktop handouts:** the "open large" button sits beside Show/Hide.
- **Loot opens on Available.** The Game Master's filters are Available | Taken | All; a player's are All | Own | Party | Available. Something that was just given, taken or split fades out of the list instead of vanishing.
- **Players see only what is theirs to see in the loot list:** what is still available, the party stash, and their own items, never another player's. Chat still says who took what.
- **Any player can take from the party stash,** or put a stash item back on the table (before, only the player who stored it could).
- **Give is a menu.** The Game Master's Give button opens a list of the players (portrait, character name and player name) instead of unfolding a list in the row; on the phone it is one tap.
- **Loot cards in chat show their buttons without opening,** left of the arrow; the arrow only shows the description.
- **The update notice is one short line.** It says a new version is available and offers the update; the release notes are behind **More info**, where they used to fill the banner (and showed their formatting marks). The same in Settings → App.
- **Transcription uses every CPU core, at low priority.** Whisper's server used at most 4 threads, so on a bigger server the other cores sat idle; on an 8-core test VM transcription is now about a quarter faster. Voice and the app keep priority while it runs. Operators: nothing to do; `WHISPER_THREADS` in `.env` sets a lower number.
- **The bard explains a bent detail.** When the tale bends a detail, or something in the notes does not add up, the bard now gives it a reason that belongs in a world of magic (a dwarf who should have sunk "bobbed up, buoyed, he insisted, by sheer spite") instead of leaving it unexplained.

### Fixed

- **Session summaries on a local model keep the whole session.** On a long session the scribe's notes could ramble, lose track after the first part and make up the rest: the local model ran with its own sampling defaults, which push it away from repeating any word, names included. Notes and Game Master briefs are now written at a low temperature and the tales a little freer, with no such penalty, locally and on a remote LLM alike. On a 12-minute test session the default model now keeps 24–26 of 26 key facts (it was 9–11).
- **Scrolling up in chat no longer says "Couldn't load older messages".** The app refused its own request for older chat; it now asks, and says "Start of the conversation" when there is nothing older (desktop app).
- **Loot fades out of the list** when it is given, taken or split, instead of vanishing and then closing the gap.
- **Chat no longer disappears when the server restarts.** It was always saved, but the desktop app filled its chat from a short-lived buffer instead of the saved history. The loot and handout cards in chat come back too.

### Known limits

- **Update the server before the apps.** This release lets any player take or return a party-stash item. An updated app shows those buttons on every stash item, but a server still on 0.5.2 refuses them (the app says so, and nothing is lost). Older apps keep working with the updated server.
- After a server restart, a player's chat cannot rebuild the card of an item another player now holds (their loot list no longer has it); the Game Master's can.

## [0.5.2] - 2026-11-17

Session summaries become a story, records run much faster on a CPU-only server, the app's own audio engine becomes the default, and the server containers are locked down. A **PATCH** release: no protocol change, so 0.5.x apps and servers work with each other, with one exception: on an updated server a player's app from 0.5.1 or earlier shows an error if they press "Transcript" (the transcript is now for the Game Master only). Operators: update the server; on the default models it then downloads `small.en` (190 MB) and `qwen3.5:4b` (3.3 GB) in the background and needs about 4 GB of memory while it writes summaries. Players: update the app; on Windows, see Known limits.

### Added

- **Model downloads show on the status page and in `vtt-admin status`.** A new `local AI` line says whether the summary model and Whisper are ready, downloading (with a percentage), or why a download failed; the status page shows a "Summary model" row while it downloads, and marks it when a download failed or stalled.

### Changed

- **The app's own audio engine is now the default** (it was the "New audio engine (experimental)" switch). Everyone gets a volume for each person, a microphone volume with a live level, a microphone that is really released when muted, and echo cancellation that also covers character voices and sounds the app plays. It uses a little more CPU than before and no longer uses your device's own hardware echo filtering. If voice sounds wrong on your computer, turn on **Settings → Audio → Compatibility audio** and join voice again to go back to the old path; the app also falls back by itself for a call when it cannot open your sound card. If you had switched the experimental engine on and off again, you stay on compatibility audio until you turn it off.
- **Transcription on a CPU is two to three times faster**, and about three times faster again on old CPUs without AVX. With the `base` and `small` Whisper models (the CPU default), Whisper now works only on the part of each clip that holds sound, where it used to process 30 seconds for every line however short, and the Whisper image for CPUs without AVX uses a faster maths library (measured on a 2010 Xeon with a table-like track: from 19 times the audio's length to 1.7).
- **Summaries are now a story.** A session's summary used to read like minutes. Now a _scribe_ first writes down what happened, big and small (the failed rolls and bad ideas too), and a _bard_ tells it from those notes as a short heroic tale with dry wit: at most 350 words for the session, 200 for each part and for each hero's own tale. The bard may embellish how a thing happened, never what happened or who did it. The tale follows the people who mattered: someone who did little may get a passing mention or none. The Game Master's private summary is a short brief of key points to recall the session and prepare the next one: what mattered, where things stand, open threads, promises, and what to have ready. Summaries already written are not rewritten; `vtt-admin recording reprocess <id>` writes new ones.
- **Players read the tale; the transcript is now for the Game Master.** Players no longer see a session's word-for-word transcript, and their search covers the tales only. The Game Master still reads the tale and the private brief, can also open the **scribe's notes** (the plain list of what happened that the tales were told from, behind a button), and can still read and search the transcript in the desktop app after turning on Settings → App → Include dev builds. The phone app no longer shows a transcript. In a session's history the session's own tale now comes first, then its parts and each hero's tale. Older apps: a player on 0.5.1 or earlier who presses "Transcript" on an updated server sees an error instead.
- **Summaries of a long session take about a quarter of the model time.** The transcript is read once and every summary is written from the notes, where each summary used to read the whole transcript again.
- **New CPU defaults: Whisper `small.en` and the summary model `qwen3.5:4b`** (was `small` and `llama3.2:3b`). `small.en` is as fast and at least as accurate for English; `qwen3.5:4b` took the fullest notes and told the best tale of the models tried. Operators: a server on the defaults downloads both on its next update (190 MB and 3.3 GB) and the model needs about 4 GB of memory while it works; the old ones stay on disk until you remove them (`docker compose exec ollama ollama rm llama3.2:3b`). To keep the old ones, set `WHISPER_MODEL_FILE` and `OLLAMA_MODEL` in `.env`. **`small.en` is English only:** for another language set `WHISPER_MODEL_FILE=ggml-small-q5_1.bin`. The GPU defaults are unchanged. A second model can tell the tales (`OLLAMA_STORY_MODEL`); by default one model does both.
- **Recording and summaries are ready to start in seconds on a new install.** The four containers that ran once and exited (`media-init`, `recordings-init`, `models-init`, `ollama-pull`) are gone. The models now download in the background after everything is up: the Whisper container fetches its own, and the worker asks Ollama for the summary model. A recording made before they arrive waits for them. On update, the old one-shot containers are removed by themselves. If you have scripts that name them (for example `docker compose logs models-init`), use `vtt-admin logs whisper worker`.
- **The worker starts after the app server** (which prepares the database).
- **Updates clean up old server images.** `vtt-admin update` (and re-running the installer) now removes VTT Chat images from versions before the previous one, once the new version is up and healthy; a test server had collected 19 GB of them. The version you came from is kept so going back is quick. Only VTT Chat's own images are touched. Pass `--keep-images` to skip it.

### Fixed

- **Windows: opening Handouts, Loot, History or Settings no longer freezes the app.** The window never appeared, and after that the app stopped answering (chat would not send) until it was restarted. Linux and macOS were not affected.

- **Phone app: the handout list shows a note's words**, where it used to show its Markdown marks (`> *…*`).

### Security

- **Containers run with fewer privileges.** Every server container now drops all Linux capabilities except the few it needs and cannot gain privileges; a bug in one service has less to work with. Nothing to set.
- **Browsers are told to use HTTPS only** (HSTS, 30 days, this hostname only), once the installer has seen your domain answer with a valid certificate. Not on `localhost` or behind a Cloudflare Tunnel. To turn it off, see the operator guide's security checklist.
- **Whisper, Ollama and cloudflared run at fixed, tested versions** instead of whatever was newest on the day of an update. Operators: set `WHISPER_IMAGE`, `OLLAMA_VERSION` or `CLOUDFLARED_VERSION` in `.env` to choose your own.

### Known limits

- **The Windows popup fix has not been run on Windows yet.** It is the fix Tauri documents for this freeze and it builds for Windows, but nobody has opened the popups on Windows since. If Handouts, Loot, History or Settings still freeze the app, restart it and tell us.
- **The new default audio engine has been used by ear on Linux and Windows only.** Bluetooth and USB headsets, latency, CPU use and hour-long sessions are not measured, and the automatic fall-back to compatibility audio has never been triggered for real. If voice sounds wrong, turn on Settings → Audio → Compatibility audio.
- **The summary models still invent small details**, more so on a very short recording. The scribe's notes are the record; the tale and the brief are written from them.
- **The CPU defaults have been run on short test recordings only.** A full-length session through `small.en` and `qwen3.5:4b` on a CPU-only server is untested, as is a transcript long enough to be read in several pieces.
- **A Game Master's search can be crowded by summaries**: when many sessions mention the same words, summary results can push transcript results off the list.

## [0.5.1] - 2026-11-16

Transcription fixed on Docker installs, a much quieter idle server, and the starter sounds on by default. A **PATCH** release: no protocol change, so 0.5.0 apps and servers work with it. Operators: update the server (it needs Docker Engine 25 or newer), then reprocess any recording that ended as "failed".

### Added

- **The status page shows the server's version** (and its protocol), so you can tell at a glance which release a server is running.

### Changed

- **An idle server uses much less CPU.** About half of the 13 to 15% a quiet server used was Docker running the containers' health checks (43 commands a minute); on the test server the containers fell from 27% of a core to 6%. They now run every 2 seconds only while a container starts, and once a minute after that, with cheaper commands. Operators: this needs **Docker Engine 25 or newer** (`docker version`); the installer and `vtt-admin update` check and tell you before changing anything. If the Docker daemon itself still looks busy, look at monitoring agents that list Docker images on a short interval, and at old images left by updates (`docker image prune -a`).
- **The starter sounds are on by default**, rebuilt from listened-to sources (Freesound, Kenney and OpenGameArt; credits in `backend/assets/sounds/SOURCES.md`). 23 quiet scenes: Tavern (with a fireplace), Dungeon, Dungeon halls, Forest, Forest night, Night crickets, Rain, Market, Storm, Campfire, Fireplace, Harbour, Cave (with dripping water), Castle hall, Mountain, Infernal, and battle moods (Battle, Epic battle, Pending doom, Boss: fire dragon, Boss: symphonic metal, War drums, Run away!). About 90 stingers in eleven boards: Combat (including Critical hit and Critical fail), Spells (fireball, ice, lightning, flash bang), Creatures (bats, spiders, insects), Undead and horrors, Doors, traps and loot, Hits and falls, Movement, Mood, Jingles, Taunts and Villain lines. `STARTER_SOUNDS=0` turns them off.
- **Some starter sounds are CC BY 3.0, not CC0**: the Fantasy and Horror sound libraries by Little Robot Sound Factory (www.littlerobotsoundfactory.com), and a few single clips (Big Explosion, the devil voice lines, Ice and Electricity spells, Spider Chattering, Spooky Sound Effects). They are credited in `SOURCES.md`, and the credit must stay with the pack. Share-alike (CC BY-SA) and GPL sounds are not used.
- **A fresh sound deck** starts with the first stinger of each board rather than the first six.

### Fixed

- **Transcription works again on a Docker install.** Since 0.4.3, recordings sent to Whisper over the network (every Docker install, and any remote Whisper) failed with "Invalid request" and ended as "failed": the audio file was left out of the request. Recordings made in that time still have their audio (unless a purge rule removed it); run `vtt-admin recording reprocess <id>` for each after updating.
- **Deleting raw audio works on a Docker install.** The worker could not delete recorded audio (the age rule, the low-disk rule, `vtt-admin recording purge` and the DM's "delete the audio" all failed with "permission denied"), because the files belong to the recorder's user. The worker now runs as that user. Transcripts and summaries were never affected.

## [0.5.0] - 2026-11-16

Email that works, easy group invites, and a faster sound deck. This is a **MINOR** release: the server and the apps must both be on 0.5 (protocol 3).

### Added

- **Sign-in and password-reset emails**, in HTML with the dragon-and-d20 banner. The email has one button that opens the web app. Sign-in links last 15 minutes and reset links 60; each works once. Nothing in the email is a code to copy.
- **Two new web pages** for those links (`/email-signin`, `/reset-password`), and **Email me a sign-in link** and **Forgot password?** on the sign-in form (shown only when the server can send mail).
- **Campaign name and description.** A DM can rename the campaign and write a markdown description (up to 4,000 characters) in Settings, then Campaign. Everyone in the campaign sees it there, and a rename reaches connected players straight away.
- **A better invite page.** It now shows the campaign's name, who runs it, how many players are in, and the description, above the sign-in or create-account form. Invite links also **preview in chat apps** (Discord, WhatsApp, Messenger) with the dragon banner, the campaign name, the DM and the first line of the description.
- **Copy invite message** in Settings, then Campaign: a ready-to-paste line plus the link.
- **An "add to home screen" hint** in the phone web app, shown only in a phone or tablet browser tab and closable for good.
- **Reset invite links.** The DM can stop every invite link still in use. People already in the campaign stay in.
- **Scenes are icon buttons** on the DM's sound deck, with the name on hover, like stingers. The **plus** opens a popup to find a scene, start it, show or hide it on the deck, or make a new one (it appears on the deck straight away). Right-click a scene to hide it.
- **Hold a stinger to keep it playing.** A click still plays it once; holding the button loops it until you let go. Letting go stops only that sound, so a running scene is not touched.
- **A shared catalogue of starter sounds** (groundwork). Sounds, stingers and scenes can now belong to the server rather than a DM: every DM can use them and none can edit or delete them. The first small pack (ten scenes and a few stings, all CC0 and credited in `backend/assets/sounds/SOURCES.md`) is included but **off by default**; the full pack arrives in 0.5.1. Operators can try it with `STARTER_SOUNDS=1`.

### Changed

- **"Allow join" is now Public / Private.** Public tables can be found by other players and take join requests; Private ones are hidden. Invite links work for both.
- **`SMTP_URL` now needs `PUBLIC_URL`** (the address the emailed links open). The server refuses to start with one and not the other.
- **Protocol 3 (wire change).** This adds the campaign description, `PATCH /api/campaigns/:id` for names and descriptions, `DELETE /api/campaigns/:id/invites` and the `campaign.updated` event, so a server on this protocol needs a matching app (MINOR bump when released).
- **Tab titles** are one word then the app name (Login, Join, Download, Account, Chat, Status).
- **The microphone meter** sits to the left of the mute button, twice as wide as before and as tall as the button.

### Fixed

- **The Include dev builds switch** in Settings, then App, did nothing: the app was not allowed to read or save the choice.
- **A `.deb` or `.rpm` install** cannot update itself, so the update button now reads **Download update** and opens the server's download page, instead of failing.
- **The "Try again" button** on the expired connect link is now full width, like Open VTT Chat.

### Known limits

- **Update the apps first.** A 0.4.x app is refused by a 0.5 server (protocol 3) until it is updated; on a `.deb` or `.rpm` that means installing the new package from the server's download page.
- Nobody has listened to the starter pack yet, so its clip choice and levels may change in 0.5.1.
- The description is visible to anyone who has an invite link, so keep secrets out of it.
- A link preview already cached by a chat app does not change until the app fetches it again.
- Emailed links have only been tested against a fake mail server and in a browser against a local server, not yet against the real relay.

## [0.4.5] - 2026-11-15

Mostly the desktop app's look and feel, tidied after using 0.4.3 on a real server, plus the phone's on-screen keyboard.
(`v0.4.4` was tagged on the way, but its release build stopped because the version files and this section were not ready,
so no 0.4.4 app was ever published. Its server images exist; everything in it is here. The GitHub page for `v0.4.4`
showed the 0.4.0 notes, which are kept in full under 0.4.0 below.)

### Added

- **Slim, themed scrollbars** in every desktop window, in the app's colours (the system's wide grey ones are gone).
- **Tab arrows in Settings.** When the tabs do not all fit the panel, a `<` or `>` appears at the end that has more.

### Changed

- **A tidier top bar.** **Session history** is back on the bar (last, just before the cog). The menu button is a **Settings cog**
  again and drops the Settings panel down; a dot shows when join requests are waiting. The DM's connection quality is a
  **Quality** tab in Settings. **Quit** is gone from the window: the app is meant to run all the time, so quit from the tray icon.
- **A balanced bottom bar.** Your status pill (ONLINE green, AWAY amber, OFFLINE grey) sits above the mute button and level
  meter, under the avatar rail; the message box fills the rest with an even gap and is two lines tall. The recording timer is a
  red dot and the time, with no "REC" word.
- **One delete button per recorded session** in the history (DM only, top right of the card). It opens a small panel saying what
  each choice removes: **the audio only** (frees disk space; the text stays) or **the whole session**. Both ask once more.
- **Roomier windows.** Handouts, Session history and Party inventory have padding around their content (dashed outlines are no
  longer cut off, and the scrollbar sits beside the content); Handouts and Party inventory open larger; the Settings window opens
  taller. Windows are never taller than 90% of the screen.
- **Settings drop-down** is wider, stops short of the message box, and has tighter tabs.

### Fixed

- **Settings looked misaligned and had a dashed outline.** The Settings cards shared a name with the chat's loot and handout
  cards, so they picked up its dashed border and centred rows; the rows now line up (label left, control right). The extra gap
  above a tab's first title is gone.
- **Dropdowns, switches and sliders follow the theme** (violet surfaces and accent, light and dark) instead of Radix's grey.
- **Phone: the on-screen keyboard.** While you type in a note, a scheduled session or the chat, the tab bar steps aside, so the
  keyboard leaves more of the form visible (a desktop browser keeps its tabs). The text fields also tell the phone they are not
  sign-in fields, which should stop the "Passwords / verification code" bar above the keyboard.

### Changed (operators)

- The server's own version (`/api/version`, also when run natively) now matches the app and the release: every package is stamped
  with the release version, and the release build refuses a tag that disagrees with any of them.

### Known limits

- The phone keyboard fix was checked in an emulated touch browser, not on an iPhone: if the Passwords bar still appears, say so.
- On Linux the tray prints a harmless `libayatana-appindicator is deprecated` warning in a terminal; it goes away when Tauri's
  tray library moves to the newer one.

## [0.4.3] - 2026-11-14

Found by running 0.4.2 on a real server with a real recording.

### Added

- **Party inventory in the web chat.** A new **Loot** tab shows what the DM has dropped and who has it, live. Players can take an item, store it for the party or put it back; the DM can give an item to a player. The same rules as the desktop app's party inventory (now shared code).
- **A tidier top bar in the desktop app.** Session history, the DM's connection quality, Settings and a new **Quit** moved behind a menu (burger) button, and the recording timer is just a red dot and the time (no "REC" word; the dot is hollow when paused), leaving room for the tools. Your status is now a colour-coded **pill above the microphone button** (ONLINE green, AWAY amber, OFFLINE grey); click it to change it. The separate connection-quality button on the rail is gone (it is in the menu), and a long campaign name is cut short with an ellipsis instead of wrapping.
- **Operators: `--records-compat`** runs the local AI on a CPU without AVX, with the Whisper built for it (very slow; for trying things out).

- **Operators: the installer adds you to the `docker` group** (so `docker` and `vtt-admin` work without `sudo` after your next login), sets `.env` readable by that group, and installs Docker from Docker's own apt repository (the current deb822 format), so Docker updates with `sudo apt-get update && sudo apt-get upgrade`. Nothing upgrades Docker by itself: a Docker restart would drop a live session.

- **Operators: the installer installs and configures the firewall** (`ufw`) unless you pass `--skip-firewall`: SSH first (the port `sshd` is actually on), then the website and voice ports, and LiveKit's internal port for Docker's networks. It is switched on if it was off (Ubuntu ships it installed but off). Ports that Docker publishes (80 and 443) bypass ufw by Docker's design.

### Fixed

- **Session summaries in the web chat's History now show as formatted text** (headings, bold, lists) instead of raw Markdown symbols.
- **Slow servers no longer fail transcription and summaries with "fetch failed".** Requests to Whisper and the LLM gave up after five minutes without an answer, which a CPU-only server easily exceeds (the job failed and retried); they now wait up to an hour.
- **Short or test recordings get a short summary** instead of a full template of empty sections ("no key decisions were made").
- `vtt-admin` uses `sudo` when the settings file is not readable by your user (it said "permission denied"), and `--cloudflare-dns` also switches an existing install to the DNS-challenge certificate.

## [0.4.2] - 2026-11-14

Found by installing 0.4.1 on a real home server: an old CPU, a line that blocks ports 80 and 443, and a minimal Ubuntu.

### Added

- **Operators: certificates through Cloudflare's DNS challenge** (`--cloudflare-dns`, a Cloudflare API token): real HTTPS, even inside your network or behind a Cloudflare Tunnel, with no inbound 80/443. Adds a `vtt-chat-caddy` image (Caddy with the Cloudflare DNS module).
- **Operators: a Whisper for CPUs without AVX** (`compose.compat.yml`, image `vtt-chat-whisper-compat`), so the container no longer dies with an illegal instruction on an old server. It is very slow (about 5.5 times the audio's length on a 2010 Xeon); the gaming PC is still the way to transcribe.
- **Operators: a Cloudflare Tunnel option for the website** (`--behind-tunnel`, an optional `cloudflared` service), for connections that block inbound 80/443: Caddy serves plain HTTP and the tunnel brings the traffic in; voice still goes direct.
- **Operators: recording without local AI** (`--records-remote`, Compose profile `records-remote`): Egress and the worker run on the server while Whisper and the LLM run on another machine. The installer chooses it automatically on a CPU without AVX, which the local AI needs.
- **The installer** works on a minimal Ubuntu (it installs `curl`-adjacent tools such as `tar`, `openssl`, `gnupg` and `nano` when missing), runs apt quietly with a log in `/var/log/vtt-install.log`, stops early and names what holds a needed port, falls back to the distribution's Docker on a release newer than Docker's own repository, and has `--no-admin`.

### Known limits

- The Whisper for CPUs without AVX is very slow (about 5.5 times the audio's length on a 2010 Xeon); use a GPU or modern PC for transcription.
- Cloudflare DNS-challenge certificates and the tunnel options are tested up to the configuration and the image builds, not yet against a live Cloudflare account.

## [0.4.1] - 2026-11-14

The first patch of 0.4. **0.4.0 was tagged but never built:** its server image failed to build (the web chat's new private-talk strip used an icon library the web package does not declare, which only the container build noticed), so no 0.4.0 images or installers were published. 0.4.1 is the same release with that fixed; everything below under 0.4.0 applies to it.

### Fixed

- The server image builds again. CI now builds the backend and worker images on every push so this cannot reach a tag again.

## [0.4.0] - 2026-11-14 (never published; see 0.4.1)

### Added

- **The DM can talk to one player privately.** Double-click a player's portrait in the desktop app (again to end it, or press End on the banner): only the DM and that player hear each other, the rest of the table cannot hear either of them, and the DM cannot hear the table, so there are no distractions. Chat still works. Everyone sees a banner saying what is happening (in the desktop app and the web chat), the two avatars show a lock, and the talk ends by itself if either person goes offline or drops out of voice. It is **never recorded**: the two people's audio is not captured while it lasts, and the timeline only notes that it happened. Adds a DM-only `party.aside` frame and an `aside` field on `party.state` (additive), and migration 0033.
- **Everyone sees when people are moved in or out of a group.** A line in the chat ("Mira joined Cellar", "The table is together again") in both apps.
- **Operators: the website can sit behind Cloudflare while voice goes straight to your server.** Voice media never used port 443; it is told its address by LiveKit after connecting, and that address is now set with `VOICE_ADDRESS` (an IP, a DNS name or `auto`; `vtt-admin voice-address`). The installer detects a Cloudflare-proxied domain, finds this machine's real address, and has Caddy trust Cloudflare for visitors' addresses (`TRUSTED_PROXIES`, `CLIENT_IP_HEADERS`). New `vtt-admin config show|set` for the `.env` settings.
- **Operators: a one-command server install.** On a blank Ubuntu or Debian server, `curl -fsSL https://raw.githubusercontent.com/AndyProsser/vtt-chat-app/main/infra/get.sh | sudo bash` asks for your domain and email, installs Docker, downloads the server, starts it, makes you the first Admin and prints a sign-in code and the next steps; `vtt-admin` then works from any directory, and running it again updates. It warns if your DNS record is missing, points elsewhere, or is a Cloudflare proxied record (voice needs DNS only). `vtt-admin` gains machine commands: `logs`, `restart`, `ps`, `backup`, `restore` and `update` (which stays on your current minor line), and asks for `sudo` when you are not in the docker group.
- **A scene change starts a new chapter, and the summaries know what the table heard and did.** While a session is recorded, the DM's scene changes (name and ambience) are noted in its timeline by default, and the operator can add character voices, party splits and individual sound effects by name with `RECORD_CUES` (names only, never audio). A scene that has a minute of talk after it opens its own chapter titled with the scene (shorter ones fold into the chapter before), the summaries are given these moments as cues rather than facts, and History shows a "Scene: name" line in the transcript and the scene name on its chapter summary. Adds a `POST …/recordings/voice-effect` route (the DM's app reports the voice) and a `markers` / `chapters` field on the records API (additive). Chapter and cue behaviour is covered by unit tests only so far.
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
- Recording, transcripts and summaries are proven end to end with synthetic speech and have not yet been run on a real session with human voices; a very long (multi-hour) session is untested. If the server restarts during a recording, that recording is marked failed (its audio is kept) and the DM starts a new one.
- Voice groups and the DM's private talk are verified on the server and with synthetic audio; nobody has listened to them with real players yet. Voice over the internet (UDP through a firewall) has not been exercised on a public server.
- The Windows and macOS builds and the Linux `.rpm` are built by the release workflow but untested by a person. The one-command server install (`infra/get.sh`) has been run on a workstation, not yet on a blank server.
- There are no voice whispers: players whisper by text, and the DM speaks to one player with a private talk.

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
