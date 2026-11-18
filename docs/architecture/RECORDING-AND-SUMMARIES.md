# Recording, Transcription & AI Summaries

Records are a **core** part of the design (decided 2026-11-05), not a plugin. This document is the
design sketch for the whole path: recording → consent cue → transcript → summaries → access.

**Status:** built, and **run end to end on the Docker Compose stack on 2026-11-12** (synthetic voices; see
[Verified on the Compose stack](#verified-on-the-compose-stack-2026-11-12)). The early sections are the design
as sketched; the dated "as built" sections below say what exists. Items marked **(open)** are undecided.

## Why server-side

Recording runs on the server (LiveKit Egress), not on the DM's client, because:

- Whisper.cpp, ffmpeg and the summarising LLM all live on the server anyway — the audio has to get
  there, and recording where it already is avoids an upload step.
- A client recorder dies with the DM's laptop, sleep, or crash. A server recorder doesn't care who
  is online.
- The server sees every participant's track; a client sees only what it is subscribed to.

The cost is that the server needs disk and CPU. That is the same server that already runs the SFU,
so it is a sizing note in [DEPLOYMENT-AND-TRANSPORT.md](DEPLOYMENT-AND-TRANSPORT.md), not a new class of thing.

## Pipeline

```mermaid
flowchart LR
    A["Players' mics"] --> LK["LiveKit SFU"]
    LK --> E["LiveKit Egress\nper-speaker track recording"]
    E --> S[("Object storage\nraw tracks")]
    S --> T["ffmpeg\ntranscode / normalise"]
    T --> W["Whisper.cpp\ntranscribe each track"]
    W --> M["Merge by timestamp\n(speaker = track owner)"]
    M --> DB[("Postgres\ntranscript segments")]
    DB --> L["Ollama\nsummarise"]
    L --> DB2[("Postgres\nsummaries")]
```

1. **Per-speaker tracks, not a mixed file.** Mixing destroys the one thing that makes diarisation
   free: if each track is one person, "who said it" is known without an ML diarisation step. It also
   lets us drop a single participant's audio (e.g. a player who asks not to be recorded, or a
   whisper) without re-processing everyone.
2. **Transcode** to a Whisper-friendly format (16 kHz mono) and keep a compact archival copy. The
   raw tracks are the retention-controlled artifact (see Retention).
3. **Transcribe each track** with Whisper.cpp, then **merge by timestamp** into one transcript with
   speaker = track owner. Overlapping speech is preserved instead of guessed at.
4. **Summarise** with a local LLM (Ollama). Outputs: session summary, chapter summaries,
   character-specific summaries, DM-only summaries (all four built 2026-11-12: a chapter is a stretch between
   pauses or between scenes, see [The table's cues and scene chapters](#the-tables-cues-and-scene-chapters-built-2026-11-13); a character summary is written for each player who spoke or typed, under their transcript name). Long sessions are map-reduce summarised
   (per-chunk, then combined) — local models have small effective context.
5. **Anchors:** summaries reference transcript timestamps. If DM markers stay in scope **(open)**,
   chapter summaries are cut at markers; otherwise at detected topic shifts.

Job orchestration, retries and the queue live in `ai/` (backed by Postgres/Redis). A failed stage
leaves the previous stages' output intact and is retryable from the Admin CLI without re-recording.

## Consent cue

Recording people is a trust matter before it is a technical one. The design is:

- **Start/stop cues.** When recording starts, every client plays "Session recording in progress";
  when it stops, a distinct stop sound.
- **Played locally.** Each client plays the cue itself from the Rust cue player. Consequences, all
  intended: the cue is never in the recording or the transcript; it plays even if the listener is
  muted; and it doesn't depend on the SFU.
- **Late joiners** hear the start cue _before_ their audio is captured — the server holds their
  track out of the recording until the client acknowledges the cue.
- **Rejoin after a network blip does not replay it.** Acknowledgement is tracked per player per
  recording, with a deliberate expiry (so a player who was away for hours hears it again).
- **State is server truth.** `recording: { active, startedAt, id }` lives in room/session metadata;
  clients render and react to it. A client that restarts mid-recording reads the state, not its memory.
- **Always visible.** The tray icon has a distinct recording state, and open panels show an
  indicator. A hidden app must never be ambiguous about whether it is being recorded.
- **Pause/resume (open).** Suggestion: pausing is a stop (cue plays), resuming a start (cue
  plays), so there is never a silent gap or silent re-start.
- Start and stop sounds must be clearly different from soundboard effects.

## The table's cues and scene chapters (built 2026-11-13)

Andy's ask: _a scene change should start a new chapter, and the transitions and soundboard/voice activity should
be in the recording's metadata so the AI can summarise against them_ ("a rich tapestry"). The words are the
record; **these are cues that colour the telling**, never events the model may build on.

**What the timeline now holds** (the same `recording_events` store and clock as typed chat: milliseconds from the
recording's start, written only while audio is being captured, so nothing is noted during a pause):

| Event (`event`) | What is noted                                                                                         | When                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `scene`         | start: scene id, **name**, and the names of the sounds in its layers (the ambience); stop             | **By default** (`RECORD_CUES`, below)                         |
| `voice`         | the DM's character voice (`dragon`, `normal` …) and the DM's name                                     | Only if `RECORD_CUES` lists `voice` (the DM's app reports it) |
| `group`         | the party split or merge: each group's name and its members by name (an unchanged table is not noted) | Only if `RECORD_CUES` lists `groups`                          |
| `sound`         | a one-shot effect or loop played, by **name and category**, and a loop's stop                         | Only if `RECORD_CUES` lists `sounds`                          |

- **`RECORD_CUES`** (operator, in `.env`) chooses which cues are noted: a comma-separated list of `scene`, `voice`,
  `groups` (party splits and merges) and `sounds` (individual effects and loops), or `all` or `none`. **Unset means
  `scene` only**: a scene change is the one cue that starts a chapter, so it is the default; the rest are the operator's
  call. A cue is only ever **metadata (a name or an id), never audio**.
- **`RECORD_SOUNDBOARD=1`** is a separate, unrelated switch: it saves the DM's effects as a private audio file in the
  recording (testing only). It does not name anything in the timeline; `sounds` in `RECORD_CUES` does that.
- **A private talk is never recorded.** When the DM takes a player aside ([TABLE-FEATURES.md](TABLE-FEATURES.md#private-talk-the-dm-speaks-to-one-player-built-2026-11-14)),
  the capture stops both people's files and starts new ones when it ends; the timeline gets an `aside` event (the player's name,
  start and end) and the summaries are told that a private talk happened and was not recorded. It is not governed by `RECORD_CUES`:
  the privacy rule always applies.
- **Never private.** A sound played to chosen people only is not noted; whispers and `ooc` lines never reach the
  timeline; names are display text with control and invisible characters stripped (`cleanCueText`).
- **Known gaps:** a voice already on when a recording starts is noted at the next change, not at the start; a
  split already in place at the start likewise; anything done during a pause is not noted (and a scene started in
  a pause titles nothing).

**Chapters** (`ai/src/lib/chapters.ts`, `planChapters`, used by the worker and the API alike): a chapter starts at
the beginning, at every **resume** (always), and at every **scene start**, but a scene chapter with less than
**60 s of speech** folds into the one before it (the scene still shows as a cue inside it), so a DM flipping
through scenes does not leave dozens of tiny chapters. A scene the DM opens with, at the very start, titles the
first chapter. A chapter's **title is the scene running when it began** (cleared when the scene stops). The records
API returns `chapters: [{ number, startMs, title? }]` on a recording that has more than one, and each chapter
summary carries its `title`; the numbering and subjects (`chapter:2`) are unchanged.

**Prompts** (`ai/src/lib/cues.ts`, `format.ts`, `prompts.ts`): every summary's transcript has the cues woven in by
time as `[0:12:03] (cue) Scene started: "Drowned Crypt" (sounds: Dripping, Eerie hum)`, so map-reduce chunking
carries them for free. A chapter sees its own cues; the session, DM-only and character summaries see all of
them. When there are cues the prompt adds one rule: _cue lines are noted by the app, not speech; use them only to
say where and how things happened; they are not events, so do not invent what a sound meant, who made it, or
anything no one said or typed._ A chapter prompt also names its scene. **Bounded:** repeated effects collapse to
one line with a count ("Sound effect: "Drip" (6 times)"), and at most 40 cue lines go into any one summary
(scenes, group splits and voices are kept ahead of effects, with a "N more minor cues left out" line).

### Loot on the timeline (built 2026-11-17)

Loot is the one cue that is a **fact**, not colour: who got what. While a recording is open (capturing or paused,
like chat), every loot change is noted as a `loot` event (migration `0038_recording_loot.sql`, `capture.onLoot`,
fed by the hub's `onLoot`): **dropped**, **given** (by the DM, `to`), **taken** or **stored** in the party stash
(`by`), **returned**, **split** (`shares`: name and amount) and **removed**, with the item's name, quantity, kind,
type and rarity. It is **always on** and not gated by `RECORD_CUES`: it is the table's record, like typed chat.
Names only, cleaned like other cues.

```mermaid
flowchart LR
  L[Loot change<br/>REST: drop, give, take, split…] --> H[hub.announceLoot]
  H -->|onLoot| C[capture.onLoot<br/>recording open?]
  C --> E[(recording_events: loot)]
  E --> Q[eventCues: loot cue<br/>+ notable flag]
  Q --> N["Scribe: (loot) lines, facts to note"]
  Q --> B[GM brief: the whole record, under Loot]
  Q --> T[Players' tale: notable items only]
```

The worker turns each into a `(loot)` line in the transcript ("The Game Master gave Vorpal Sword (legendary) to
Aria"; "240 gp was split: Aria 120, Bram 120"). The scribe is told they are facts to note. Who reads what
(decided by Andy, 2026-11-17):

- **The Game Master's brief** gets the **complete** loot record, to list under a "Loot" heading.
- **The players' tale** (session, chapter, character) gets **only notable** treasure, and is told to leave all other
  loot out, so the story is not a shopping list. Notable means someone **received** it (given, taken, stored, a
  split share) **and** it is a magic item (uncommon or rarer), or coin or a valuable worth **100 gp or more** (a
  gem's or art object's value is read from its name, "Black pearl (500 gp)").
- Loot cues are never trimmed before other cues when a summary's cue list is cut to 40.

**History:** the transcript endpoint returns `markers` (`[{ atMs, kind: 'scene', text }]`) beside `utterances`,
and both History views draw a "Scene: <name>" divider among the lines. Effects, voices and groups stay out of the
transcript (they shape the summary, they are not lines to read).

**Not verified yet:** the Postgres migration `0032_recording_cues.sql` and the full pipeline with a real model
(unit tests only, no stack run); whether a local 8B model uses the cues well or over-reads them. The smoke test
(`infra/records-smoke/compose-e2e.ts`) now starts a scene mid-recording and checks the marker, the chapter title
and the timeline event, and records whether a summary names the scene as a metric.

## Privacy rules (hard)

- **Whispers and private channels are never recorded, transcribed or summarised into a shared
  artifact.** This is enforced where the audio is routed (a private group's track is excluded from
  Egress), not by filtering transcripts afterwards.
- **Out-of-character chat (`/ooc` and the quick commands) is never recorded.** Typed public chat during a recording goes into the transcript, except lines of kind `ooc`, which the server filters out where chat reaches the recording and search (see [CHAT-COMMANDS.md](CHAT-COMMANDS.md)).
- **DM-only summaries are DM-only** at the API level, not just hidden in the UI.
- **Nothing leaves the server by default.** Transcription and summarisation are local. A cloud
  provider (OpenAI Whisper API, a cloud LLM) is an explicit, operator-enabled adapter, and the UI
  says when session content is configured to leave the server.
- Everyone in the room can see that recording is on, and who can read the result.

## Access & retention

- **Who reads what (decided 2026-11-17).** The tale is the record the table reads; the rest is working material.

  | What                                              | Players | Game Master                | Operator        |
  | ------------------------------------------------- | ------- | -------------------------- | --------------- |
  | The tales (session, each part, each hero)         | yes     | yes                        | in the database |
  | The scribe's notes, the Game Master's brief       | no      | yes                        | in the database |
  | The transcript (spoken and typed lines), searched | no      | desktop app, dev builds on | in the database |

  The API enforces the first two columns: a player asking for the transcript gets `forbidden`, and a player's
  search covers the tales only. "Dev builds on" is the desktop app's own setting (Settings → App → Include dev
  builds), so that last step is a display choice made by the app, not an access rule: the server gives the
  transcript to any Game Master who asks. The reason is that the transcript is a diagnostic view (is Whisper
  hearing the table?), and a Game Master is already trusted with everything said at their table. The phone app
  has no transcript view. The operator needs the transcript only so a recording can be reprocessed, which works
  from the database; there is no CLI command that prints one.

- **Retention is operator-controlled** via the Admin CLI (raw tracks are the big files; transcripts
  and summaries are small). Backup/restore/delete exist for recordings, transcripts and summaries
  separately ([CLAUDE.md §7](../../.claude/CLAUDE.md)).
- The DM can delete a campaign's records; the operator can purge by policy.

## Sizing (measured 2026-11-12; details in the next section)

| Item                      | Measured                                                                                                                          | Note                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Raw audio, Opus per track | **12–29 MB per player-hour** (27 kbit/s for a mostly quiet track, up to 64 kbit/s for the DM, who talks most)                     | 5 players × 4 h ≈ 0.25–0.6 GB per session. Synthetic mic without DTX; a real client that sends DTX may be lower |
| Whisper.cpp, CPU          | `small` q5_1: **RTF 0.30** of the track's length (8-core desktop, 4 threads; 8 threads is no faster); `medium` q5_0: RTF 0.95     | Speech windows only, so silence costs nothing; `medium` was no more accurate on clean speech                    |
| Whisper.cpp, GPU          | GTX 1080: `small` RTF 0.024, `large-v3-turbo` q5_0 RTF 0.037, `medium` q5_0 RTF 0.044; ~0.6 / ~1.0 / ~1.0 GB of VRAM              | `large-v3-turbo` was the most accurate                                                                          |
| LLM, per summary          | GTX 1080: llama3.2:3b ~7 s, llama3.1:8b / qwen3:8b ~14–17 s. CPU: llama3.2:3b ~50 s, qwen3:8b ~150 s (a 3-minute scene's summary) | A recording gets 2 + chapters + one per player summaries; a long session is map-reduced (more calls)            |

Processing runs **after** the session by default; "live" summaries are a later enhancement that
depends on measured CPU headroom.

## Open questions

### Decided (Andy, 2026-11-05)

- **A campaign is one continuous entity.** Recording **start / stop / pause** events define the
  session bookmarks; no separate session object. (This supersedes DM markers as the _primary_
  anchors; DM-placed markers can still exist as extras.)
- **Collect rich metadata with every recording**: speaking indicators, mute/unmute, join/leave,
  active character, and other client events, timestamped. Combined with per-speaker tracks, this
  is used to attribute "who said what" and to resolve overlap/crosstalk.
- **No per-speaker opt-out.** Anyone who doesn't want to be recorded leaves the session. The
  consent cue and visible indicator are the whole consent mechanism.
- **Raw audio is deleted once the summary is processed and the DM confirms it.** Transcripts and
  summaries are kept. The DM manages this; the operator CLI can still purge.
- **Stale audio is purged by configurable rules** when the DM never confirms: on the next
  session starting, after an age limit, or when free storage drops below a threshold.

- **Recording status events:** `STARTED | IN-PROGRESS | PAUSED | RESUMED | STOPPED`. Each
  transition has a consent cue (resume replays it). `IN-PROGRESS` is what a late joiner or a
  rejoining client sees; it is a status on the server-owned recording flag, not a lifecycle
  that clients have to keep in sync.

- **Whisper model default depends on hardware:** chosen at setup (GPU detected or not), overridable
  by an environment variable or the CLI. **CPU-only → `small` q5_1**, **GPU → `large-v3-turbo` q5_0** —
  both confirmed by measurement on 2026-11-12 (see below); the GPU default is `compose.gpu.yml`'s.
- **Transcribe speech windows, not whole tracks — built** (`ai/src/lib/speechWindows.ts`; measured in AUDIO-SPIKE-RESULTS.md Finding 5, where the problem proved hardware-independent). Segment each track with a silence detector (ffmpeg `silencedetect` gave exact windows in the spike), transcribe the windows, and add each window's start offset. whisper.cpp's own `--vad` produced timestamps that drift by tens of seconds, and whole-track transcription both wastes time on silence and hallucinates text on room noise.
- **Standing consent is collected at account creation** ("you consent that you may be recorded…"),
  stored in Postgres against the user profile with a timestamp and the **version of the consent
  text**. A changed text re-prompts on next sign-in. The per-recording **cue** still plays: sign-up
  consent is the standing agreement, the cue is the in-the-moment notice.

### Capture as built (2026-11-07)

`RecordingCapture` (backend) follows the server's recording flag. On **start** it writes a durable `recordings` row and a `started` bookmark. It records a player's track only **after that player's app has acknowledged the start cue** (the reconciler runs on start, on every acknowledgement, and every 5 s, so late and re-published tracks need no webhooks). **Pause stops every file; resume starts new ones**, so one speaker can have several tracks per recording, each with a start offset relative to the recording. On **stop** it registers every finished file as a `recording_tracks` row and queues one `process-recording` job. LiveKit/Egress trouble is logged and retried; it never changes the recording state clients see. Files are named `<recording>/<account-id>@<time>`; the account id is the speaker, the transcript shows the active character or display name.

### The consent loop as built (2026-11-05)

The **server** owns the recording state (an id plus a status) and the per-player acknowledgements; each **client** plays its own local cue.

1. The DM starts, pauses, resumes or stops a recording (`POST /api/campaigns/:id/recording`, DM only).
2. The server announces `recording.status` (`STARTED` / `PAUSED` / `RESUMED` / `STOPPED`) to everyone subscribed to the campaign.
3. Each client plays the matching cue **locally**. For a start, the client first **closes its capture gate**, plays the cue, and only when it has finished sends `recording.ack` and opens the gate.
4. After every snapshot _or replay_, the server sends `recording.state`: the current state (`IN-PROGRESS` or `PAUSED`) and whether **this viewer** has already acknowledged. A late joiner gets `acknowledged: false`, so they hear the start cue before being captured. A quick reconnect gets `acknowledged: true`, so nothing replays. A reconnect after the expiry gets `false` again.
5. The DM is told who has acknowledged (`recording.ack.update`, DM only).

The acknowledgement lives on the **server** (in memory now; Valkey with a TTL is the plan), not in a file on the player's machine: nothing for a player to lose or fake, and it works across their devices. If a cue can't be played (no speakers), the gate opens anyway so the player isn't locked out of voice, but no acknowledgement is sent — the DM can see they haven't heard it.

What is _not_ built: the durable record of each recording (start/stop/pause timestamps as session bookmarks), the link to LiveKit Egress, and everything downstream of it (Stage 5). Today a recording is a flag and an id in memory.

### Still open

1. Default values for the purge rules, and whether the DM is warned before an automatic purge.
2. The acknowledgement expiry (30 minutes is an assumption; it is one constant) and whether it should be configurable per instance.

## While a recording runs (decided 2026-11-10)

A recording means a game is running, so the app protects it:

- **The DM cannot walk away from it.** While their campaign is recording, the DM cannot switch to another
  campaign (the app refuses, and the switcher says why) or hand over the DM role (the server answers
  `409`). Both wait for Stop. Players come and go freely; each campaign is its own voice room, so
  switching leaves one room and, as always, the player chooses Online to join the next.
- **If the DM's app drops, the recording carries on.** Nothing changes for `RECORDING_GRACE_SECONDS`
  (operator setting, 5 to 3600, default **30**). After that, **any player in the campaign** can pause,
  resume or stop it (never start one); the buttons appear in their top bar and the server enforces the
  same rule. The moment the DM reconnects, control is theirs alone again; a recording a player paused
  stays paused until the DM resumes it. "The DM's connection" means their app's link to the server, not
  voice, so going Offline in voice does not count as being away.
- **If everyone drops, it stops by itself.** When nobody is connected to the campaign for the grace
  period, the server stops the recording and processes it as normal. Anyone who returns inside the period
  keeps it going.
- **Chat in the transcript.** Lines typed into the **public** chat from start to stop (pauses included) are
  kept on the recording's timeline and merged into the transcript and summaries, marked "(typed)", for
  example `[0:42:10] Aria (typed): Anyone smell brine?`. **Whispers, and the DM's private lines, are
  never included**: the server only hands public lines to the recording, and the processing step ignores
  any chat event that names a recipient. Chat outside a recording is not kept for transcripts. Typed lines are
  searchable with the rest (a hit says who typed it and when, marked "(typed)").

## Retention: raw audio is the part that fills the disk (decided and built 2026-11-10)

The transcript and the summaries are text and tiny; the per-speaker audio files are not. So the audio is
what retention removes, and the text is kept for good.

- **By time (automatic):** `RECORDING_RETENTION_DAYS` (set on the worker; blank or 0 keeps audio for ever).
  Every six hours the worker looks for **processed** recordings that stopped more than that many days ago
  and still have audio, and queues one `purge-recording` job each. The job deletes the track files, removes
  the recording's empty folder, and records `purged_at` on each track. It is safe to repeat and does not
  mind a file that is already gone.
- **By hand:** `vtt-admin recording purge <id>` or `recording purge --older-than <days>` queue the same
  jobs (the worker, which can see the audio, does the deleting). A recording that is **not processed
  yet is refused**: its audio is still the input to the transcript.
- **What it never touches:** transcripts, summaries, the recording's timeline, or any file outside the
  recordings folder (the worker refuses a path that is not under `RECORDINGS_DIR`).
- **What it costs you:** after a purge, `recording reprocess --retranscribe` is refused (there is nothing to
  transcribe); redoing only the **summaries** still works, from the kept transcript.
- **Who can see it:** `vtt-admin recording list` shows "audio kept / purged" for each recording, and the
  session history shows the DM "audio deleted". Players are not told.
- **The DM confirms (built 2026-11-10):** on a **processed** recording that still has audio, the DM sees "The
  summary is good: delete the audio" in the tray's session history, behind a "this cannot be undone" step.
  `POST /api/campaigns/:id/recordings/:rid/audio/delete` (DM only; 409 if not processed or nothing left) queues
  the same `purge-recording` job, so the worker does the deleting. It is **not** in the phone app, by decision:
  a mistap there would delete audio for good.
- **When the disk runs low (built 2026-11-10, decided with Andy):** below 10% free on the recordings disk the
  worker (hourly) picks the **oldest** processed recordings that still have audio and gives their DM a stored
  notification (`audio.purge`; shown as a pop-up under the "session" notification setting) and a note in the
  history with the date. Three days after the warning it queues the purge. Below **3%** free there is no wait.
  At most two recordings per kind per check, so one run cannot clear a library. `AUDIO_DISK_PURGE=0` turns the
  rule off. There is **no "keep this one" button**: the DM can only delete sooner or let it happen; the operator
  can switch the rule off or free space another way. (A hold would be a small addition if it is missed.)
- **When the next session starts (built 2026-11-13, off by default):** operator setting
  `audio-purge-next-session` (`vtt-admin settings set audio-purge-next-session on`). When a recording starts, the
  backend queues the ordinary `purge-recording` job for that campaign's **earlier** recordings that are
  `processed` and still hold audio. It never touches one that is queued, processing or failed, one without
  audio, the new recording, or another campaign's. There is no separate "DM confirmed" flag: the DM's confirm
  _is_ the delete button, so any processed recording that still has audio is by definition unconfirmed, which
  is exactly who this stale rule is for. It has no DM warning (it is an explicit operator setting, like the age
  rule). A failure reading the setting or queueing is logged and never stops the new recording.
- **Not built:** the DM warning on any rule but the disk one (the age rule, `RECORDING_RETENTION_DAYS`, is the
  operator's explicit setting and still deletes without a notice).

## When the server restarts mid-recording (built and drilled 2026-11-10)

Recording state lives in the backend's memory, but Egress is a separate process and **keeps writing**
when the backend goes away. Before this was handled, a restart had two bad outcomes: the app showed
"not recording" while every voice was still being captured (a consent problem, principle 4), and the audio
already captured was never registered or processed (a lost recording).

On startup, for each recording the database still calls `recording` that this process knows nothing about,
`RecordingCapture.recoverInterrupted()`:

1. asks LiveKit for the room's track egresses and picks this recording's out by the path each was started
   with (`<dir>/<recordingId>/<speaker>@{time}`, so no new table or column is needed);
2. stops every one still running and waits for its file;
3. keeps the files as tracks, closes the recording as `stopped` (events `interrupted`, `stopped`) and queues
   processing, so what was said up to the restart is transcribed and summarised like any recording;
4. only if LiveKit **cannot be asked** does it mark the recording `failed` and log `could not recover`, so the
   failure is loud. A recording with no egress on record is also marked `failed`.

After that the DM starts a new recording; the clients, which read state from the server, now truthfully see none.
**Not handled:** carrying on recording across a restart without a gap (it would need the consent
acknowledgements, which are also in memory, to survive too), and a restart while paused (the paused flag is
memory too; the recording is recovered the same way).

Drilled against a real LiveKit server and a real Egress with `infra/records-smoke/restart-drill.sh`: a speaker is
recorded, the process "restarts", recovery stops the egress and keeps a playable file. It passed on
2026-11-10 on the dev PC. The drill's backend side runs in one process (a fresh `RecordingCapture`
standing in for the restarted backend); a real `kill -9` of the packaged backend is not drilled.

## Verified on the Compose stack (2026-11-12)

`infra/records-smoke/compose-e2e.ts` ran the whole path on the local Docker Compose stack (records profile,
GPU override, GTX 1080 8 GB, 8-core desktop, 31 GB RAM): four people (DM + three players) connected over
the WebSocket and to LiveKit through Caddy's `wss://`, each publishing synthetic speech (piper TTS, four
voices) as their microphone; the DM recorded through the real API; every app acknowledged the cue.

**Passed (66 checks):** every connected app acknowledged; the late joiner was told "in progress, not
acknowledged" and **nothing they said before acknowledging was captured**; words spoken while paused were not
captured; per-speaker word accuracy 0.97–1.00 with no line under the wrong name; typed `chat`, `/say` and
`/do` lines in the transcript marked typed; **the `/ooc` line, the `/late` quick line, a `/dm` and a `/tell`
whisper appeared nowhere** (transcript, summaries, search as DM and as player); session, DM-only, two chapter
and three character summaries; DM-only never returned to a player (detail, list, search); search found a
spoken and a typed phrase; a second recording needed (and got) fresh acknowledgements; **`docker compose kill
worker` mid-job → the job finished on attempt 2** after the 5-minute lease; with transcription pointed at an
unreachable server and a 20 s fallback, **the worker fell back to the local Whisper** and the recording was
processed. A backend recreated mid-recording (by another session) was also recovered as designed: egresses
stopped, audio kept, processing queued.

**Measured** (same machine; Whisper through the worker's own windowing code, `whisper-bench.ts`, a 6.5-minute
Opus track of the scene's lines in four voices; LLM through `llm-bench.ts` on the recorded scene's transcript):

| Whisper                   | RTF (time ÷ audio) | Word accuracy | Peak memory         |
| ------------------------- | ------------------ | ------------- | ------------------- |
| GPU `small` q5_1          | 0.024              | 0.982         | ~0.6 GB VRAM        |
| GPU `medium` q5_0         | 0.044              | 0.980         | ~1.0 GB VRAM        |
| GPU `large-v3-turbo` q5_0 | 0.037              | **0.988**     | ~1.0 GB VRAM        |
| CPU `small` q5_1, 4 thr   | 0.30               | 0.982         | 0.4 GB RAM, 4 cores |
| CPU `small` q5_1, 8 thr   | 0.32 (no faster)   | 0.982         | 0.4 GB RAM          |
| CPU `medium` q5_0, 8 thr  | 0.95               | 0.984         | 0.9 GB RAM          |

| LLM, single pass as it was before 0.5.2 (one summary of a 3-min scene) | GTX 1080 | CPU    | VRAM    | Judged quality                                                                                                 |
| ---------------------------------------------------------------------- | -------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------- |
| llama3.2:3b                                                            | ~7 s     | ~50 s  | ~2.7 GB | Readable, but **invents** (an NPC "Cattil" and her promise; the eel "defeated"; the party "entering" the door) |
| llama3.1:8b                                                            | ~14 s    | —      | ~5.2 GB | Faithful and well ordered; a stray meta remark, one invented "promise" in a character summary                  |
| qwen3:8b (thinking off)                                                | ~15 s    | ~150 s | ~5.5 GB | **Most faithful**, best structure, correct who-did-what (one slip: who asked about the inscription)            |

Peaks during a full e2e run on the GPU: VRAM 7.1 GB of 8 (desktop 1.1 GB + Ollama), Ollama 6.3 GB RAM, Whisper
0.35 GB, Egress 0.18 GB and ~1.3 cores while recording four tracks, worker 75 MB. **Idle, the card is back at the
desktop's ~1.1 GB** (Whisper stops after 60 s idle, Ollama unloads after 2 min). Audio: 12–29 MB per player-hour.

**Defaults chosen:**

- **GPU (compose.gpu.yml): Whisper `large-v3-turbo` q5_0 + `qwen3:8b`.** Turbo was the most accurate and only
  ~1.5× slower than `small`; a 4-hour, five-player session is a few minutes of Whisper. qwen3:8b gave the most
  faithful summaries for ~2× llama3.2:3b's time, still about 15 s a summary; both fit an 8 GB card one after
  the other (the worker never runs them together). Smaller cards: `small` + `llama3.2:3b`.
- **CPU (compose.yml): Whisper `small` q5_1 (4 threads, whisper-server's default) + `llama3.2:3b`.** `medium` costs
  3× for no measurable gain on clean speech; 8 threads were no faster than 4. qwen3:8b would be the better
  summariser but is ~3× slower on CPU (a long session's summaries go from hours to most of a night) and needs
  ~6 GB of RAM, so it stays an opt-in (`OLLAMA_MODEL=qwen3:8b`) for CPU servers with the memory and patience.
- Ollama is always called with thinking off (reasoning models otherwise spend minutes on hidden text), and any
  `<think>` block a server returns is stripped.

**Re-measured for CPU, 2026-11-16 (Stage 9).** Same harness, but a **table-like track**: one line, then 5 s of quiet, so
each line is its own short window (a player's own track mostly looks like this; the 2026-11-12 track was a monologue).
Four cores throughout. "Fitted" means the worker sends whisper.cpp an `audio_ctx` sized to the window: Whisper otherwise
encodes a full 30 s for every window, however short.

| Whisper on CPU (time ÷ audio, word accuracy)                    | Full 30 s context | Fitted (margin 256) |
| --------------------------------------------------------------- | ----------------- | ------------------- |
| 2014 desktop, stock AVX2 image, `small`                         | 0.72, 0.986       | 0.25, 0.989         |
| 2014 desktop, stock AVX2 image, `small.en`                      | 0.72, 0.979       | **0.25, 0.989**     |
| 2014 desktop, no-AVX image as it was, `small`                   | 5.54, 0.986       | 1.52, 0.961 (m 128) |
| 2014 desktop, no-AVX image + OpenBLAS (SSE), `small.en`         | 1.02, 0.979       | 0.46, 0.982         |
| **2010 Xeon VM**, no-AVX image + OpenBLAS, `small.en`           | 3.38, 0.979       | **1.68, 0.982**     |
| 2010 Xeon VM, no-AVX image as it was, `small.en`                | —                 | 6.80, 0.989         |
| 2010 Xeon VM, no-AVX image as it was, `small` (what 0.5.1 runs) | **19.3, 0.986**   | —                   |
| 2010 Xeon VM, no-AVX image + OpenBLAS, `small`                  | —                 | 1.78, 0.972         |

What it showed, and what changed:

- **The no-AVX image was slow because of its maths, not the CPU's age:** the same 5.5× appeared on a 2014 desktop. Built
  with OpenBLAS it is 5.4× faster there with identical output, and 4× faster on the Xeon (`whisper-compat.Dockerfile`).
  **On the Xeon, like for like on this track: 19.3× the audio as shipped in 0.5.1, 1.68× with all three changes**, about
  11 times faster. (The 5.5× quoted for that VM on 2026-11-13 was a monologue track, which wastes far less.)
- **Fitting the encoder to the window is 2.2 to 2.9× faster with no accuracy cost** at a margin of 256 positions (about
  5 s); 128 cost accuracy and 400 gained nothing. **Only for the `base` and `small` models**, which is what was measured:
  the worker goes by the model's file name (`WHISPER_MODEL_FILE`; `WHISPER_FIT_AUDIO_CTX=1` or `0` overrides).
  `large-v3-turbo` **repeats itself** with a shortened context ("Both arrows hit. Both arrows hit. Both arrows hit."),
  which the end-to-end test caught on the GPU stack the same day, so the GPU default keeps the full context (it does
  not need the speed). Never sent to a remote or cloud server: `audio_ctx` is a whisper.cpp extension.
- **`small.en` is the CPU default** (Andy, 2026-11-16): same speed as `small`, equal or better on English, and it spelled
  a character's name right more often. English only; other languages go back to `ggml-small-q5_1.bin`.
- `base.en` was not worth it (0.937 fitted). A **name prompt** (character and place names sent as Whisper's `prompt`)
  made accuracy worse (0.930) and was dropped. **Parakeet** (reported about 4× Whisper `small` on CPU) was not measured:
  it needs a third-party server we have not vetted, and it takes no vocabulary hints.
- 280 words of clean TTS: a difference of one point is three words. Compare rows, do not predict a real table.

| Summary model on CPU (2014 desktop, one summary of the scene) | Time      | Judged                                                             |
| ------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| llama3.2:3b (the old default)                                 | 28–41 s   | Invents (the eel "accepted" the toll; Bram "promised")             |
| granite4.1:3b                                                 | 35–68 s   | Most faithful single-pass summary; plain and structured            |
| qwen3.5:4b                                                    | 32–106 s  | Good prose, careful about what is unconfirmed; one invented detail |
| phi4-mini                                                     | 25–45 s   | Fast and short; invents cause and effect                           |
| gemma3:4b                                                     | 45–79 s   | Liveliest voice; the character summary pasted the transcript       |
| qwen3:4b                                                      | 130–171 s | Three to four times slower, no better                              |

One short scene, one run each, read against the transcript by Claude: a guide, not a ranking.

### Scribe and bard: how a summary is written (decided 2026-11-16)

Andy's brief: _accuracy isn't critical, the story is_. A heroic retelling of the key events, "even the dumb ones that were
an epic fail", in "glorious prose" with "dry wit and gallows humour", short ("not War and Peace"). And: _"the full
transcript is searchable, but the story is what will be remembered."_ So a summary is two passes by two roles
(`ai/src/lib/prompts.ts`, `summarise.ts`):

```mermaid
flowchart LR
    T["Transcript\n(one stretch of recording)"] --> S["Scribe\nnotes: every event, big or small"]
    S --> N[("Notes\n(stored for the Game Master)")]
    N --> B1["Bard: the session's tale (≤350 words)"]
    N --> B2["Bard: each part's tale (≤200)"]
    N --> B3["Bard: each hero's tale (≤200)"]
    N --> G["Scribe: the Game Master's brief (plain)"]
```

- **The scribe** reads the transcript, a piece at a time, and writes plain notes in whole sentences: who did what and
  how it turned out, dice results (above all natural ones and twenties), failed plans, in-character jokes quoted, names
  as spoken, what was found, lost, promised or left open. Accuracy lives here.
- **The bard** never sees the transcript, only the notes. It may embellish _how_ a thing happened and may not change
  _what_ happened, who did it, or a name. Fumbles are told as proudly as feats. An unresolved thread ends the tale with
  "Next time:"; an empty one is removed.
- **The Game Master's summary is not a tale**: a plain brief from the same notes (what happened, secrets, hooks,
  promises, preparation), written by the scribe.
- **Notes are taken once and shared.** With chapters, each chapter is noted once and the session's notes are the
  chapters' notes in order. Before, every summary re-read the whole transcript: for five players, about eight readings;
  now one, plus one short call per summary. Notes too long for one call are shortened by the scribe first.
- **The Game Master's brief is a summary of key points** (Andy, 2026-11-17): to recall the last session and prepare
  the next, never the scribe's notes again. At most 250 words (less when the notes are short): last session, where
  things stand, open threads, promises, what to prepare. So the Game Master reads the tale and the brief; the notes and
  the transcript are the hidden items, the notes behind a "Scribe's notes" button and the transcript in dev mode.
- **The notes are stored for the Game Master** (2026-11-17): one `summaries` row per recording, kind `notes`,
  visibility `dm`, as Markdown (a bullet per event, a heading per part). They are for reading: a job that dies still
  takes its notes again (the transcripts, the slow part, are kept).
- **The tale is about the people who mattered.** The bard is told that not everyone in the notes belongs in the tale:
  a player or creature who did little may be left out or pass in a clause, and nobody is given a moment just to be
  included. Each hero still gets their own tale.
- **A tale is never longer than its notes.** The word limit in the bard's prompt is the kind's cap or 0.8 × the notes'
  word count, whichever is less (floor 30). Given six lines of notes and "at most 350 words", a bard fills the space
  with invention: the end-to-end test's four-line recap came back as a dungeon crawl. The scribe is likewise told that
  notes never run past the transcript. Still seen after both rules: `qwen3:8b` adds a small invented beat to a
  four-line recording, and a bard may name the Game Master's account when the notes do.
- **A piece is 12,000 characters** (was 24,000): thorough notes run nearly as long as what they describe, and both must
  fit the 8k context the worker asks Ollama for.
- **One model or two.** `OLLAMA_MODEL` plays both roles; `OLLAMA_STORY_MODEL` gives the bard its own (the status line
  then reports the worse of the two). A remote LLM plays both.

**Tried 2026-11-16** on a written scene with fumbles in it (a natural 1 on stealth, a strength check that snaps a statue's
arm off), CPU only, read by Claude:

| Scribe → bard                 | Notes                                                      | Tale                                                                                   |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| granite4.1:3b → gemma3:4b     | Thin shorthand (before the scribe was told otherwise)      | Mannered and vague; left "Next time:" dangling                                         |
| granite4.1:3b → granite4.1:3b | Thin                                                       | Purple, no humour, events wrong (a splash became a "demise")                           |
| granite4.1:3b → qwen3.5:4b    | One paragraph even when asked for more; dropped the banter | Good voice, starved of detail                                                          |
| **qwen3.5:4b → qwen3.5:4b**   | A line per exchange, nearly all right                      | The best: dry, specific, uses the fumbles; small liberties (a damage roll became fish) |

So **`qwen3.5:4b` is the CPU default for both roles** (3.3 GB; notes about 100 s and each tale about a minute for that
scene on a 2014 desktop). This replaces granite4.1:3b, which Andy had picked from the single-pass table above before
the two-pass design existed; flagged to him. The GPU default stays qwen3:8b, untested as scribe and bard.

### Step A: bigger models, and the sampling fix (measured 2026-11-17)

Run on the VM (a 2010 Xeon E5645, 8 vCPU, 24 GB, **no AVX**) and, for the summary models, on a GTX 1080, against a
written 12-minute session (`infra/records-smoke/fixtures/session-vault.txt`, scored by `session-fixture.ts` against
26 facts).

**Whisper:** `medium.en` is not worth it on a CPU. Without the fitted window it matched `small.en` (98.6% against
97.9–98.9% word accuracy) at three times the time; with a fitted window it fell to 72.5%. Whisper's server also used
only 4 of the 8 cores; it now uses them all at low priority (`small.en` 1.71× → 1.26× the speech).

**The summary model on a CPU without AVX does not work in practice:** `qwen3.5:4b` read 3.2 and wrote 1.8 tokens a
second on the Xeon (a modern CPU: roughly 50–100 and 8–12), so one 12-minute session's notes ran past the worker's
one-hour request limit. Such a server sends summaries to a remote LLM (OPERATOR-GUIDE).

**Sampling was the real problem.** The Ollama path sent no temperature, so each model's own defaults applied:
`qwen3.5` ships temperature 1.0 and **presence_penalty 1.5**, which penalises every word already used. Notes have to
repeat names and things, so the scribe was pushed to new words until it drifted into run-on invention, covering the
first third of the session and making up the rest. Facts kept, of 26:

| Scribe sampling             | `qwen3.5:4b`   | `qwen3.5:9b`   |
| --------------------------- | -------------- | -------------- |
| Model defaults (as shipped) | 11, 11, 9      | 21, 8          |
| Temperature 0.2, no penalty | **24, 26, 24** | **26, 26, 26** |

Every request now carries its role's sampling (`SCRIBE_SAMPLING`, `BARD_SAMPLING` in `ai/src/consts`), to Ollama and to
a remote alike: the scribe at 0.2, the bard at 0.7 (livelier tales, a few more liberties), no presence penalty. With
it, `qwen3.5:4b` stays the default: half the time of 9b (notes in about a minute on the GTX 1080) and close behind
on facts. Read by Claude, 4b's slips were who-did-what (a natural 1 noted as a natural 20 once); 9b's were invention
in the tale (Cassiel's cut hand became "severed") and running over the word cap. Andy's bar (2026-11-17): better than
the table's memory and fun to read, not perfect; a wrong detail is storytelling, not a failure.

**Still unverified:** real human voices, room noise, echo and crosstalk (TTS flatters accuracy); a real
4-hour session's map-reduce summaries (the scene fits one model call); the Rust desktop client and phone app as
the recorded clients (the e2e uses LiveKit's Node SDK); a CPU-only server end to end (CPU numbers are the
same Whisper/LLM measured standalone).

## Where the summaries run: three levers (planned 2026-11-17, for 0.6.2)

Andy's brief (2026-11-17): Whisper on a CPU is fine (`small.en` is about 98% accurate, and an overnight run is
acceptable); a summary model on an old CPU is not (hours per session, and 24 to 48 hours "pushes the friendship").
The budget for a whole session's processing is **8 to 12 hours**. Operators get a choice of quality, speed and cost:

| Where the LLM runs                         | Cost per session         | Speed (5-hour session)                            | Leaves the server                 |
| ------------------------------------------ | ------------------------ | ------------------------------------------------- | --------------------------------- |
| **Local** (default, `qwen3.5:4b`)          | none                     | minutes on a GPU or modern CPU; hours without AVX | nothing                           |
| **Remote you own** (Ollama on a gaming PC) | none                     | about 30 min of notes on a GTX 1080 (estimate)    | text, to your own machine         |
| **Claude** (new, opt-in)                   | about $0.30 (Sonnet 5.5) | minutes                                           | the transcript text, to Anthropic |

Whisper stays where it is in every row: the audio never goes to Claude (it does not transcribe), so only text
leaves the server, and private lines and whispers are never in that text to begin with.

### The Claude connector (design)

- **A third LLM kind, not a reuse of the OpenAI-compatible one:** `ai.llm.kind` gains `claude` beside `local` and
  `remote`, set with `vtt-admin settings set ai.llm.kind claude` and `ai.llm.model` (default `claude-sonnet-5-5`;
  `claude-haiku-5-5` for the cheapest, `claude-opus-5-5` for the best). It calls the Messages API through the
  official `@anthropic-ai/sdk`, in `ai/src/lib/providers/claude.ts`, as one more `GenerateText`.
- **The key comes from the environment** (`ANTHROPIC_API_KEY` in `.env`), never the database, like
  `LLM_API_KEY` today. A Claude Code subscription does not cover it: the API is billed separately, per token, on
  an account at console.anthropic.com.
- **Roles differ by prompt, not by sampling:** Claude's current models refuse `temperature`, so `SCRIBE_SAMPLING`
  and `BARD_SAMPLING` are not sent. Thinking runs at **low effort** (summaries are not hard reasoning; more effort
  is more output tokens, which are the expensive ones).
- **Failure is handled like any remote:** the same failover, so a job waits while Anthropic is unreachable and
  falls back to the local model after `ai.fallback.after-seconds`. A refusal (`stop_reason: "refusal"`) counts as
  a failed call and falls back locally; it is logged with its category.
- **Cost is visible:** the worker records each job's input and output tokens and the model, and
  `vtt-admin jobs list` shows them with an estimated cost (prices from a table in `ai/src/consts`, dated, so the
  operator knows when it was right). `vtt-admin status` says which LLM a job used.
- **Saving more, later and only if it matters:** the Batch API halves the price and suits an overnight job, at the
  cost of results arriving within hours rather than minutes; prompt caching would save little, because the
  long input (the transcript) is read only once. Neither is in the first version.

**How the estimate is made** (estimated, not measured; to check against the first real session): a table talks
about 6,000 to 9,000 words an hour, so 5 hours is roughly 40,000 to 60,000 tokens of transcript. The scribe reads
it once (plus about 500 tokens of instructions per piece) and writes notes of at most about 3,000 words. Each tale
and the brief read only the notes, about 4,000 tokens, roughly eight calls. In all: about **110,000 tokens in and
10,000 out**.

| Model             | Per million tokens (in / out) | One 5-hour session | A year of weekly sessions |
| ----------------- | ----------------------------- | ------------------ | ------------------------- |
| Claude Haiku 5.5  | $0.10 / $0.50                 | about $0.02        | about $1                  |
| Claude Sonnet 5.5 | $2 / $10                      | about $0.30        | about $16                 |
| Claude Opus 5.5   | $4 / $20                      | about $0.65        | about $34                 |

Prices as of 2026-11-03 (Anthropic's list, US dollars); thinking tokens are billed as output and are small at low
effort. Andy's choice (2026-11-17): **Sonnet is the suggested model**, "more than affordable".

**Telling the table (decided by Andy, 2026-11-17).** CLAUDE.md requires that players are told when session content
leaves the server. The apps get a field for it in protocol 4 (0.6.0, ROADMAP Stage 11), which arrives before the
connector (0.6.2), and the **status page** says it too. The notice appears **only when an off-site connector is
configured**: Claude, or a remote (Whisper or LLM) whose URL is not on the operator's own network. Everything else
shows as **local only**, including offloading to the operator's own gaming PC. "Own network" is read from the URL's
host: a private or loopback address (10/8, 172.16/12, 192.168/16, 127/8, IPv6 ULA and link-local), a single-label
name, or a name ending in `.local`, `.lan`, `.internal` or `.home.arpa`. Anything else counts as off-site.

### Each stage does less (Andy, 2026-11-17)

The pipeline's inputs shrink at every step, and each step should be asked for no more than the next one needs:

```mermaid
flowchart LR
    A["4–6 h of audio,<br/>chat and cues"] --> W["Whisper<br/>(local)"]
    W --> T["Transcript<br/>~40–60k tokens"]
    T --> S["Scribe<br/>key events, quotes"]
    S --> N["Notes<br/>≤ ~3,000 words"]
    N --> B["Bard<br/>one tale, 300–500 words"]
    N --> C["Chronicler<br/>GM brief, 200–300 words,<br/>under headings"]
```

A session is mostly talk, thinking and waiting for dice, with one or two fights: the scribe's job is to find the
few things that happened, plus the lines worth quoting. After the notes, the transcript is not read again; it is
kept (it is small text) so a summary can be re-run and for search. Steps D and E in the ROADMAP build to these sizes.
