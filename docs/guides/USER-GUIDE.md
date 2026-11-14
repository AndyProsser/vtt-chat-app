# User guide

For players and Dungeon Masters (DMs) of a table that runs on VTT Chat App. **Draft (2026-11-10).** Some
steps have only been tried by the author; where a screen may look different from what is written, trust the
screen and tell us.

- [1. Get the app and join a table](#1-get-the-app-and-join-a-table)
- [2. Your first minutes](#2-your-first-minutes)
- [3. Status: Online, Away, Offline](#3-status-online-away-offline)
- [4. Voice](#4-voice)
- [5. Chat and whispers](#5-chat-and-whispers)
- [6. Handouts](#6-handouts)
- [7. Loot and the party inventory](#7-loot-and-the-party-inventory)
- [8. Recording and summaries](#8-recording-and-summaries)
- [9. Sessions and reminders](#9-sessions-and-reminders)
- [10. Your character and settings](#10-your-character-and-settings)
- [11. For the DM](#11-for-the-dm)
- [12. When something is wrong](#12-when-something-is-wrong)

## 1. Get the app and join a table

Your DM (or whoever runs the server) sends you an **invite**: a link, a short code, or a QR code to scan
with your phone.

1. **Open the invite link** in a browser. It shows the table's name and asks you to **agree to the recording
   notice** (the table may be recorded; see [section 8](#8-recording-and-summaries)), then create your account
   (or sign in, if you already have one).
2. The page then shows a **download for your computer** (Windows, macOS or Linux). Install it and open it (Windows and macOS warn about an unknown publisher the first time; [installing the app](INSTALLING-THE-APP.md) shows how to get past it).
3. In the app, enter your server's address (the page shows it, for example `vtt.example.com`), and sign in with
   the same email and password. The table appears.

**Forgot your password, or no email arrives?** Ask the person who runs the server for a **one-time code**,
and choose "sign in with a code". Some servers offer "Sign in with" a company or group account; use that
button if you see it.

The app lives in your **system tray** (the little icons by your clock). Click its icon to open the window; the
icon shows whether you are connected and whether the table is being recorded. On some Linux desktops the
tray needs an extension (GNOME: "AppIndicator"); without it the app still works, you just open it from your
applications menu. [Fixing a missing tray icon](INSTALLING-THE-APP.md#linux-i-cannot-see-the-tray-icon).

## 2. Your first minutes

The window has, from top to bottom:

- **The bar**: the campaign (click to switch), the **REC** timer when a session is being recorded, then
  small buttons for handouts and the party inventory (and, for the DM, groups and sound effects), then a **menu button** (the burger) holding
  session history, the DM's connection quality, **Settings** and **Quit**. Your **status** is the coloured pill above the microphone button (ONLINE green, AWAY amber, OFFLINE grey): click it to change it.
- **The rail** (the round portraits on the left): everyone at the table. Their portrait glows while they
  speak. Hover over one for a card with their character and, for the DM, how good their connection is.
- **The chat** (middle): messages, whispers, and cards for handouts and loot.
- **The bottom bar**: your **microphone button**, a **level meter**, and the message box.

Nothing joins voice by itself. The app opens **Offline**; choose Online when you want to talk
([section 3](#3-status-online-away-offline)).

**While the window is closed or behind others**, the tray icon gets an **orange dot** when something new
arrived (hover for the count; opening the window clears it). Public chat gives the dot. During a game
(you are in voice and a recording is running), whispers and shared handouts also give the dot and a
desktop notification; outside a game, whispers wait for you in the chat. Session reminders and changes, and
"summary ready", always pop up. Details: [NOTIFICATIONS.md](../architecture/NOTIFICATIONS.md).

## 3. Status: Online, Away, Offline

One switch says whether you are at the table. It is the **dot beside the Settings button**, the **Status**
item in the tray menu, and **Settings → Profile → Status**.

| Status      | You are…                                                            |
| ----------- | ------------------------------------------------------------------- |
| **Online**  | in voice, with your microphone as you left it                       |
| **Away**    | in voice but your microphone is closed (it reopens when you return) |
| **Offline** | out of voice. Chat still works                                      |

- **Away happens by itself** when your screen locks or the screensaver starts, and after 10 minutes with no
  keyboard or mouse (change it in Settings → Profile; "Never" turns it off). When you unlock or use the
  computer, you are back. If you pick Away yourself, it stays until you change it.
- **Unmuting while Away** means you are back: you go Online.
- If you press **unmute while Offline**, the app asks "Connect to Voice Channel?". Say yes to join with your
  microphone on.
- Everyone at the table sees your status on your portrait: green (Online), amber (Away), grey (Offline), or a
  faint ring (**Disconnected**: your app is closed or you are signed out).

## 4. Voice

- **Mute and unmute**: click the microphone button, or press **Ctrl+Shift+M**. While muted, **hold Left
  Ctrl to talk** (push to talk). The tray icon and the button show whether your microphone is live. With the new audio engine (Settings → Audio), muting also lets go of your microphone, so your computer's "microphone in use" light goes out.
- **Meter**: green is normal talking, amber is loud, red is too loud. It shows what the table hears after
  the app has cleaned your sound, so typing and fans you have filtered out do not show.
- **Echo and noise**: if people hear an echo of themselves, wear headphones. In **Settings → Audio**
  you can pick your microphone and speakers, turn on **the new audio engine** (gives you a volume for each
  person, a microphone volume and echo removal for everything the app plays), and choose a **Background
  noise** level: Off, Light, Standard (removes fans and air conditioning), or Strong (also hides typing and
  mouse clicks between words; adds a very small delay). If your voice gets clipped on Strong, use Standard.
- **Automatic volume** keeps quiet and loud talkers at a similar level; switch it off to set your volume
  yourself.
- **Each person's volume**: hover their portrait and use the slider (new audio engine).
- **Each campaign is its own voice room.** If you switch campaigns, you leave one room; choose Online to join
  the next.

## 5. Chat and whispers

Type in the message box and press **Enter** to send. **Ctrl+Enter** (or Cmd+Enter, or Shift+Enter) starts a new line, so a message can run to several lines. On a phone the on-screen Enter key always makes a new line, and the Send button sends. **Type `/` to see the commands**:
a list opens above the box. Up and Down move, Tab or Enter completes, Esc closes (or tap a row). A plain line is
**in character**; the commands are for the exceptions and for style.

| Type                         | What it does                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/say words`                 | What your character says aloud: shown in quotes in a serif face                                                                                                 |
| `/say-elvish words`          | The same, in a language (Elvish, Dwarvish, Draconic and the rest of the D&D set): styled to suit, with a small "in Elvish" caption. The words are never changed |
| `/do action` (or `/me`)      | What your character does: shown as _Thorin raises his axe_                                                                                                      |
| `/ooc words`                 | Out of character: small and muted with an OOC tag. **Never recorded**                                                                                           |
| `/tell name words` (or `/w`) | Whisper to one person at the table. The name completes as you type                                                                                              |
| `/dm words`                  | Whisper to the DM                                                                                                                                               |
| `/late [note]`               | Posts "running late" (OOC) **and** marks you late for the next session                                                                                          |
| `/cant [note]`               | Posts "can't make it" (OOC) **and** marks you as not coming                                                                                                     |
| `/work`                      | Posts "still at work" (OOC) and marks you late                                                                                                                  |
| `/brb`, `/afk`, `/back`      | A ready-made OOC note. No RSVP change                                                                                                                           |
| `/loot`, `/take`             | Open the party inventory (desktop app)                                                                                                                          |
| `/voice name` (DM only)      | Change your character voice (desktop app)                                                                                                                       |

- A line starting with `/` that is not a command is sent as plain text; if it looks like a typo you are warned
  first, and pressing send again posts it as text.
- Out-of-character lines stay visible to the table but are **never recorded, never in a transcript or a
  summary, and never found by search**. Everything else you type in public is part of the story.
- Your own messages are on the right with a warm tint; the DM's public messages have a gold edge and a
  "DM" tag. Whispers are coloured differently and say who they are between.
- **Whispers are private** to the two people. The server stores them for those two only, they are never
  recorded and never appear in a transcript or summary.
- Chat history stays when you reconnect. Missed whispers come back after you reconnect.

## 6. Handouts

The DM shares **handouts**: a **note** (text), a **set of pictures** (one to twelve, for example a map), or
a **PDF**. Each can have a short caption.

- They appear in the chat as a card. A note shows its first three lines; a picture shows a larger picture
  with arrows to flip through a set; a PDF shows a paperclip.
- **Click a card** to open it big, in its own window you can place beside the game. Pictures have **zoom**
  buttons (also Ctrl + the mouse wheel; drag to move around), which is useful for a large map. A PDF is
  read page by page inside the window.
- Only the DM can edit a handout (open it and press the pencil). For a set of pictures the pencil also shows a
  strip to move a picture earlier or later, remove one (never the last), or add another. The handouts button in the bar lists
  everything shared with you.

## 7. Loot and the party inventory

The DM drops items and coin into the **party inventory**, and a card appears in the chat.

- **Click the card** to open it: you see the description and what you can do.
  - A free item: **Take** it for yourself, or **Store** it in the party stash.
  - Something you took or were given: **Store** it for the party, or **Return** it to the table.
  - Something you stored: **Return** it.
  - Coin can be **split** equally among chosen players (in the inventory window).
- The DM can only **give** an item to one named player, never to the party.
- Everyone can always see what is still unclaimed (the inventory window, "Still in the pool").
- The inventory is a shared record of who took what. It does not change your character sheet.

## 8. Recording and summaries

When the DM starts a recording, **every app plays a clear "recording" cue** and the **REC timer** shows in the
bar and on the tray icon. Your voice is only recorded **after your app has played the cue**; if you join late
you hear it first.

- Each person is recorded separately; the server turns it into a **transcript** and **summaries** after the
  session. Lines typed in the **public chat** during a recording are included, marked "(typed)".
- **Never recorded or transcribed:** whispers, sound effects from the DM's soundboard, and anything private.
- **Read them later** with the **session history** button: summaries for the table, a transcript, and search (which also finds lines people typed during the recording).
  The DM may also have a DM-only summary that players cannot see.
- **If the DM drops** (their computer crashes or their network goes), the recording carries on for a short
  grace period (30 seconds by default). After that **any player** can pause, resume or stop it from the top
  bar. If everyone disconnects, it stops by itself.
- While a recording runs the DM cannot switch campaigns or hand over the DM role; stop it first.

## 9. Sessions and reminders

The DM schedules sessions (date, time, length). You see the next one in **Settings → Sessions**, and you can
answer **Can make it / Late / Can't**. The server sends reminders 24 hours and 1 hour before. They also show as a desktop notification, even when the app is hidden. Choose what you want to hear about, and set **quiet hours** (no pop-ups, for example overnight), in **Settings → Notifications**.

### On your phone

Open `https://<your server>/app` in your phone's browser and sign in with your email and password, or with a
one-time code. You get five tabs: **Chat** (the table's chat and your whispers; you can reply or whisper to one
person), **Sessions** (when the next one is, and your answer), **Handouts** (what the DM has shown you), **Loot** (the party's inventory: take what the DM drops, store it for the party, put it back; the DM can give an item to a player) and
**History** (summaries and transcripts of past sessions). There is **no voice** on the phone: use the desktop
app for that. It does not buzz you when closed; the desktop app does that. **Menu → Sign out** when you are on
someone else's phone.

## 10. Your character and settings

Open **Settings** (the cog). It has five tabs:

- **Profile**: your photo and player name. **Click your photo to change it** (a small X on its corner removes it).
  **Click your name**, which has a dotted underline, to rename it: Enter saves, Escape cancels. The sign-out icon is
  at the top right. Below are your **status** and when to go Away, your **theme** (light or dark follows your
  computer), and an **App** section at the bottom with the app and server versions, **updates** (with the
  include-dev-builds switch) and **start with the computer**.
- **Campaign**: leave the campaign; create invites (DM); **hand over the DM role** (DM: you and a player swap
  places in one step); your **character**: name, picture, and an optional **D&D Beyond link**. Paste your
  public character's link and the app keeps your name, race, class, level and portrait up to date (only if the
  server's operator turned this on). **Sync now** forces a refresh.
- **Sessions**: upcoming sessions and your answer. The DM schedules a session with the calendar-plus icon at the
  top right.
- **Audio**: microphone, speakers, engine, noise filter, volume, and, for the DM, **hear sound effects myself**.
- **Notifications**: what you are told about (chat, whispers, handouts and loot, sessions) and **quiet hours**.

**Finding a table.** If you are not in a campaign yet, or want to join another, open Settings, then Campaign, then
**Find another table** (it also shows on the Profile tab when you are in no campaign). Tables that are open to requests
are listed with their DM and player count. Choose **Request to join**, add a short note if you like (up to 280
characters) and send it. The card then reads **Request sent**, and you can **Withdraw** until the DM answers. If the DM
says no, the card reads **Not this time** and shows the date you can ask again, a week later. You get a pop-up when
the DM answers, and if you are already in another campaign a strip appears with a **Switch** button. An invite link
still works as before.

**Letting people ask (DM).** In Settings, then Campaign, the **Join requests** section has an **Allow join** switch.
When it is off your table is hidden from the list and takes no requests. Waiting requests show the person's name, their
note and how long ago they asked; **Approve** adds them as a player and **Decline** sends a no. A number on the Campaign
tab and a dot on the menu button show that someone is waiting. Turn the pop-ups on or off in Settings, then
Notifications.

By default you only get finished releases. To try early versions, turn on **Settings → Profile → App → Include dev
builds**; they may be rough. When a new version is available a banner says so; it installs only when you click
"Restart to update", and never in the middle of a game on its own. If a banner says the app and your server are on
different versions, update the app, or ask your DM to update the server if the app is the newer one.

## 11. For the DM

**Start and end a session**

- **Record**: the record button in the bar starts, pauses, resumes and stops. A recording protects the
  session: you cannot switch campaigns or hand over the role until it stops.
- **Audio is kept until you say otherwise.** The raw recordings are large. Once a session is written up and you
  have read the summary, open it in the session history and choose **"The summary is good: delete the audio"**.
  The transcript and summaries stay; the audio goes and cannot be got back, so it cannot be transcribed again.
  If the server's disk runs low you are warned (a notification, and a note on the session) three days before the
  oldest audio is deleted for you.
- The first time, **invite your players**: Settings → Campaign → invites (a link by email, a code, or a QR).

**Voices and groups**

- **Character voices**: pick one in the effects drawer (the wave button) or type `/voice giant`. Choices:
  normal, giant, imp, robot, demon, dragon, god, drunk, authoritative. They change only your outgoing voice.
  Echo cancellation still works with them (new audio engine); headphones are best.
- **Voice groups**: the groups button splits the table into rooms (a split party). Drag portraits between
  groups, or focus one and press Enter for a menu. You are in every group.
- **Talk to one player privately**: **double-click** their portrait on the rail (double-click again, or press **End** in the banner, to stop). Only you and that player hear each other; the rest of the table cannot hear either of you, and you cannot hear the table, so there are no distractions. Chat still works. Everyone sees a banner saying what is happening, so nobody wonders why you went quiet. It is **not recorded**, and it ends by itself if either of you disconnects.
- **Everyone sees group changes**: when someone is moved into or out of a group, a line appears in the chat.

**The soundboard and scenes** (the effects drawer)

- **Sounds and boards**: your own library of clips (several takes each), as big buttons: one-shot or looping.
- **Scenes**: looping beds (rain) plus random drop-ins (drips), started together. **Stingers** are short effects.
  Players hear them through the call. They are **not** recorded; the recording's timeline just notes what played.
- **Import sounds** with `npm run sounds:import -- --from <folder> --category ambience` (operators and DMs
  who run the repository); ask your operator.

**Handouts and loot**

- **Handouts** button → add a note, pictures or a PDF; **show** it to everyone or hide it. Click a handout
  card in the chat to read or edit it.
- **Party inventory** → drop items from the SRD catalogue, roll treasure, or write your own; **give** to a
  named player, **split** coin, **remove** anything.

**From your phone (the web app)**: you can run the table's notes and schedule from `/app` too. On **Handouts**, tap
**+** (New note) to write a note with a title and Markdown text; the **Preview** switch shows what players will read.
A new note is a draft only you can see, unless you switch on **Show it to the table now**. Open any handout to **Show**
or **Hide** it, and a note to **Edit** it; **Delete** asks you to press again. On **Sessions**, tap the calendar button
(Schedule a session) to set a title, date and time (in your phone's time zone, which the form names), a length and
optional notes; each upcoming session has **Edit** and **Cancel session**. Players are notified as usual. Adding
pictures and PDFs is still done in the desktop app.

**Connection screen**: the activity button shows each player's delay, jitter and loss, to see who is struggling.

## 12. When something is wrong

| Problem                                    | Try                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| I cannot hear anyone / they cannot hear me | Check your status is **Online** and you are not muted; choose the right devices in Settings → Audio             |
| There is an echo                           | Wear headphones; turn on the new audio engine                                                                   |
| Typing or fan noise is heard               | Settings → Audio → Background noise (Standard or Strong)                                                        |
| I cannot connect at all                    | Check the server address; ask your operator whether the server is up (`/status` page)                           |
| Voice works for others but not me          | Your network may block voice; try another network or a phone hotspot                                            |
| I cannot see the tray icon (Linux)         | Install and turn on the AppIndicator extension: [steps](INSTALLING-THE-APP.md#linux-i-cannot-see-the-tray-icon) |
| I forgot my password                       | Ask the server's operator for a one-time code                                                                   |
| The window is blank for a second           | Windows open with a "Loading…" screen and fill in; if it never does, close and reopen it                        |
| A picture or map is too small to read      | Click its card, then use zoom                                                                                   |

If something looks broken, tell your DM or operator what you were doing and what you saw.
