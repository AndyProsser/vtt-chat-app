# Quality validation: testing the whole system with a long synthetic session

**Roadmap:** [Stage 13](../../ROADMAP.md). **Status:** planned 2026-11-21 with Andy; the approach is decided, the details are not (see [Open questions](#open-questions)). Nothing here is built yet.

## Why this exists

Most of what Stages 9 to 12 built has met unit tests, fakes, and a few short recordings: a two-minute spoken scene, a four-minute Compose end-to-end test, and a 12-minute _written_ session used to compare summary models. The records pipeline is the largest untested surface: Whisper with a glossary, the scribe's structured notes, the Chronicler, campaign memory, five storytellers and two cloud connectors, none of which has seen a session of real length with real-sounding voices. A bug in any of them shows up as a wrong tale or a lost fact weeks after the session that caused it, which is the worst time to find it.

A real table session is the best test and the slowest and least repeatable one. So this stage builds a **repeatable stand-in**: a long, real multi-person dialogue, spoken by synthetic voices into the real system, with a script that tells us exactly what every output should contain. It does not replace a real session (see [What it cannot show](#what-it-cannot-show)); it finds most of the problems before one is spent on them.

## The idea in one picture

```mermaid
flowchart LR
  D["Written session<br/>30 to 60 min<br/>1 DM + 4 or more players"] --> P["Prep: lines, speakers,<br/>planted facts, canaries"]
  P --> V["Piper voices<br/>one per speaker<br/>+ room degradation"]
  V --> R["Runner: each speaker is a<br/>LiveKit participant and a<br/>WebSocket client"]
  R --> S["The real server:<br/>Egress, worker, Whisper,<br/>scribe, Chronicler, memory,<br/>storytellers"]
  S --> O["Outputs: transcript, notes,<br/>brief, memory, tales, search,<br/>export, job usage"]
  P -. ground truth .-> C["Scoring"]
  O --> C
  C --> X["BUILD-STATUS:<br/>numbers per run"]
```

Everything between the runner and the outputs is the production code and the production services. Only the people are fake.

## The source dialogue

**Decided 2026-11-21 (Andy): the session is written for the test**, not taken from an existing recording or transcript. The plan had been a real dialogue; a written one costs more of Claude's time and less of Andy's, and has no sourcing or licensing question at all. The price is realism, so the writing has to put the mess back in on purpose.

- **Written to be messy, not tidy.** The existing vault fixture is hand-written, 12 minutes, and tidy. The long session is written the way real play sounds: interruptions and talking over each other, jokes that go nowhere, rules arguments, a player who is away from the table for ten minutes, names invented on the spot and used again an hour later, a long Game Master description, an in-character speech, and in-character and out-of-character talk in the same breath. It is written in parts (an evening in four or five scenes) so no part is rushed.
- **30 to 60 minutes**, roughly 4,500 to 9,000 spoken words at 150 words a minute. Long enough to push the records pipeline through several pieces of notes (the map-reduce path), which no real or synthetic session has done yet.
- **One Game Master voice and five player voices** (one more than the minimum, so one can be the late joiner or the player who leaves).
- **What is committed and what is not.** The script and its facts file are ours, so they are committed as a fixture beside the vault one (repeatable runs, and a regression test for every later prompt change). The **rendered audio is never committed** (it is large, and regenerates from the script); it lives in a scratch directory under `~/.local/share/` and is deleted when Stage 13 closes. _Default chosen by Claude, not asked: if Andy would rather the long script stayed out of the repo too, it moves to the same scratch directory._

### Preparing it (once)

A prep script turns the source into the format the vault fixture already uses (`Speaker: words`, one line per utterance, `(typed)` for chat lines) and a facts file in the shape of `session-vault.facts.json`:

1. **Write the cast first**: one Game Master and five players, each with a character name, so the glossary and the roster have something to correct against.
2. **Choose the facts to plant and score.** Read the dialogue and pick 25 to 40 facts that a good set of notes must keep: a throwaway non-player character, a promise with a deadline, a secret only the Game Master understands, a loot item, a failed roll, a place visited twice. Each gets a pattern in the facts file. This is the same method that gave the 24 to 26 of 26 recall figures for the 4B model in Stage 12 A.
3. **Add canaries.** A canary is a word that appears nowhere else, put in a line that must never reach a shared artifact: an `/ooc` aside, a whisper, a Game Master private talk, a line spoken while the recording is paused, and a line a late joiner says before acknowledging the cue. The existing end-to-end test already uses this trick ("absent" becomes a plain text check); this reuses it at length.
4. **Mark scene changes and a few table events** (loot dropped, a handout shown, a pause for a break) at the points the dialogue suggests, so the cues, chapters and chat features are exercised in the middle of real conversation instead of in a separate scene.

## The voices

Text-to-speech is enough (Andy, 2026-11-21). The existing harness uses **piper** (a small local TTS, installed user-local, no apt) with `ffmpeg` turning each line into 48 kHz mono PCM, cached by voice and text so a rerun costs nothing ([`infra/records-smoke/e2e/tts.ts`](../../infra/records-smoke/e2e/tts.ts)).

- **Five or six clearly different voices**, one per speaker. Four voices exist today; a multi-speaker piper model gives more distinct voices from one download. Variety in accent and pitch matters for Whisper, not for attribution (see below).
- **Degrade the clean audio so it resembles a table.** Synthetic speech is far cleaner than a microphone in a spare room, so Whisper will look better on it than it will be in life. The runner can add, per speaker and per run, a noise bed, level differences between speakers, a little reverb, now and then a clipped peak, and **bleed**: a quiet copy of one speaker's voice on another's track, as when a player's microphone picks up the room. The degradations are settings, so the same session can be run clean and degraded and the difference measured.
- **Turn-taking is part of the script.** The runner places lines on a clock with natural gaps, lets a fraction of turns **overlap** (interruptions, two people laughing), and keeps a few long monologues (the Game Master describing a scene) so Whisper's handling of long clips is tested.

## What the runner does during the session

The runner extends the Compose end-to-end test ([`compose-e2e.ts`](../../infra/records-smoke/README.md)), which already connects people over the WebSocket and LiveKit and publishes a TTS microphone track for each. The difference is length, cast size, and what happens in the middle:

- **Real time, with a faster mode.** The live run is at real speed (the capture path has to be exercised as it runs). A second, **offline mode** feeds the rendered per-speaker tracks straight to the worker (the way `records-smoke` does today) so Whisper and prompt changes can be iterated in minutes instead of an hour.
- **Typed chat in every kind**, spread through the hour: plain, `/say`, `/do`, `/ooc`, `/late`, `/dm`, `/tell`, whispers.
- **Table activity**: scene changes (they start chapters), loot dropped, split and claimed, a handout, a party split and merge, the soundboard (local, so absent from recordings and checked to be absent).
- **Consent and recording controls**: a pause and resume, a late joiner who joins before and after acknowledging, a stop and a second recording the same evening.
- **Churn and faults**: a player leaves and rejoins; one loses the network for a minute (a `tc netem` drop, or a forced disconnect); a mute and unmute storm; the worker is killed mid-job and the job must finish on a retry; with `--fallback` the remote AI is made unreachable and the job must fall back to local.
- **One real client in the room (optional).** The synthetic players are headless Node participants, not the Tauri app, so they say nothing about the app's audio engine. Andy's real desktop app can join as an extra person (listening, or playing the Game Master) for the whole hour, with the existing measuring scripts ([`scripts/test/`](../../scripts/test/README.md)) recording its CPU, memory and jitter. That is the one part of the run that needs a human and a machine.

## What is scored

Every number is compared with the script, which is the ground truth. **Thresholds are set after the first run, not before**: the first run records what the system does, then we decide which numbers are acceptable. A number invented in advance would be a guess presented as a standard.

| Area           | Measure                                                                                                                                                                                             | How                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Hearing        | Word accuracy per speaker, and **proper-noun accuracy** (character, place and non-player character names) with `ai.transcription.glossary` set to `off`, `corrections`, `prompt` and `both`         | The script against the transcript (the existing scorer, plus a names list) |
| Attribution    | No line under the wrong name; each speaker's lines within a few seconds of where the script put them                                                                                                | Per-speaker tracks make this a mapping check (see the limit below)         |
| The scribe     | Planted facts kept in the notes; notes under the headings; within the size limit; how often the retry ladder was needed                                                                             | The facts file, then Andy reading a sample                                 |
| The Chronicler | Promises, deadlines, open threads and the throwaway character are in the brief; continuity warnings are right                                                                                       | Facts file, then reading                                                   |
| Memory         | An entry for each planted character and place, a sensible gist, no duplicates, a size that stays small; **a second run of the same session recognises the first** ("the party has met Gary before") | Entry list against the facts; two runs back to back                        |
| The five tales | Facts intact; each voice distinct; length follows what happened; nothing Game Master-only in any tale except the Tipsy Minstrel's                                                                   | Facts file, a canary for the Game Master's secret, Andy reading all five   |
| Privacy        | Not one canary in the transcript, notes, brief, memory, tales, search results (as the Game Master and as a player) or a `.vttcampaign` export                                                       | Plain text search of every artifact                                        |
| Cost and time  | Seconds per pipeline stage, Whisper's real-time factor, the model's time, peak CPU and memory of every container, disk used, and the cloud tokens and cost against the provider's console           | `vtt-admin jobs list`, `docker stats`, the existing benches                |
| Reliability    | Recording survives rejoin, a killed worker, a backend restart; the queue finishes the job; idle CPU and memory after the session return to baseline                                                 | The existing restart drill and kill drill, run mid-session                 |

## The run matrix

Not every combination runs every time; the first run is the baseline and each later run changes one thing.

| Run | Backend                                          | Why                                                                                       |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | The VM's CPU defaults (`small.en`, the 4B model) | The default install is the one most operators will have; this is the baseline             |
| 2   | The same session again, straight after run 1     | Campaign memory across two sessions                                                       |
| 3   | The GPU PC as a remote backend                   | The fast path; also the remote-with-fallback drill                                        |
| 4   | Claude (`ai.llm.kind claude`)                    | The connector against the real API: tokens, cost against the console, the off-site notice |
| 5   | OpenAI (`ai.llm.kind openai`)                    | The same, with an operator-named model and operator-set prices                            |
| 6   | The session looped for 8 hours with churn        | The soak, the memory rules of Stage 0.5, and the `kill -9` drill                          |

Runs 4 and 5 spend real money and send the (synthetic) session off the server; each needs Andy's say-so first, and a key kept in the `.env`, never in a command or a chat.

## Order of work

1. **A real Postgres first.** Run the backend's Postgres-only tests (27 are skipped without a database) against a throwaway database, and exercise what Stage 12 added that only the in-memory stores have tested: migrations 0042 and 0043, `addJobUsage`, the memory queries and the export round trip. Cheap, and it finds the kind of bug a unit test with a fake store cannot.
2. **Prep the dialogue and the voices**: the prep script, the facts file, the cast, the degradations.
3. **Build the long-session runner** on the existing harness, with the offline mode.
4. **Run 1, then read everything.** Fix what is wrong as bugs, with a test each, in 0.6.x patches.
5. **Runs 2 to 5**, one change at a time. Settle `ai.transcription.glossary`'s default, tune the prompts from reading the output.
6. **The soak** (run 6), and the human-only checks from the roadmap table (the real desktop client in the room, the phone, the Intel Mac, the Windows microphone).
7. **Close**: results in [BUILD-STATUS.md](../BUILD-STATUS.md), the screenshots redone, the throwaway audio and text deleted.

## What it cannot show

- **Voices are not tested by the track layout.** The server records one track per speaker, so "who spoke" comes from which track a sound is on, not from recognising a voice. That is the design, and it means the attribution score checks the mapping, not any acoustic skill. Crosstalk and bleed between microphones are the realistic risk and only the degraded runs approximate them.
- **Synthetic speech flatters Whisper.** It is clean, evenly paced and pronounced the way the model's training data expects. Treat word accuracy as a **regression and comparison** number (this build against the last one, this setting against that one), not a promise of what real players will get. Real human voices still need real sessions; the few short recordings of real voices so far (a 42-second one on Windows came through word-for-word) are the only human data.
- **It does not judge whether the tale is fun.** Facts, canaries and sizes are checked by code; whether the tale beats the table's memory is Andy's call from reading five tales (the test from Stage 12).
- **The synthetic players are not the desktop app.** The app's audio engine, echo cancellation and mixer are exercised only by the optional real client, and by real hardware checks.

## The other checks that moved into Stage 13

| From                    | To check                                                                                                                                                                                                                                                                                                        | Needs                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Stage 12 (B, C)         | **Whisper name accuracy**: the glossary as Whisper's starting prompt against corrections after transcription (`ai.transcription.glossary`): does the prompt help or hurt (an earlier name prompt dropped accuracy from 98 % to 93 %)? Settle the default                                                        | The long session, run both ways          |
| Stage 12 (D, E)         | **The scribe and the Chronicler on real sessions**: the 4B model's headings and size, the retry ladder, a transcript long enough for several pieces of notes (the map-reduce path), the vault session (Gary, the three nights, Pim's lantern)                                                                   | The long session; the written vault test |
| Stage 12 (F)            | **Campaign memory across two sessions in a row**: the second tale knows the party has met Gary before; entry names and gists stay sane; the memory stays small                                                                                                                                                  | Two runs of the session, back to back    |
| Stage 12 (G)            | **Each storyteller on the same session**: facts intact, voice distinct, length follows what happened; nothing Game Master-only reaches a tale except the Tipsy Minstrel's                                                                                                                                       | The long session, five tales             |
| Stage 12 (CL)           | **The Claude and OpenAI connectors against the real APIs**: a real recording summarised, the cost in `vtt-admin jobs list` against the provider's console, no key and no network each falling back to the local model, a refusal handled                                                                        | An API key each (Andy's call to spend)   |
| Stage 12 (F, CL)        | **The Postgres side of Stage 12**: migrations 0042 and 0043, `addJobUsage`, the memory queries and the `.vttcampaign` export round trip, none of which has run against a real database (the backend's Postgres-only tests, 27 of them, are skipped without one)                                                 | A throwaway Postgres                     |
| Stage 12                | **Cost on the default CPU install**: model time per session with every role on; whether the Chronicler, memory and a long tale fit a week between sessions                                                                                                                                                      | The long session on the VM               |
| Stage 12 (open)         | **Tune the prompts from reading real output**: tale length signals, memory format, the 4B model against 8B                                                                                                                                                                                                      | Reading the output                       |
| Stage 11                | **Built in 0.6.x, never run in a real window or on a phone**: GM Notes attachments and the PDF preview, the 400 % volume (listen for clipping), the sound deck's 8 and 8, the Unease board and the new sounds heard, the storyteller dropdown and operator controls, the off-site notice, the To confirm groups | Andy, at a desk and on a phone           |
| Stage 11                | **The phone's table page, Invite and QR on a real phone**, and the **old-browser notice in a real old Safari**                                                                                                                                                                                                  | A phone; an old iPhone or Mac            |
| Stage 11                | **The macOS Intel app installed on a real Intel Mac** (0.6.1 built it; nobody has opened it)                                                                                                                                                                                                                    | One of the family's Intel Macs           |
| Stage 11                | **Redo the user guide's screenshots** once the above is checked, all at once (the Settings → Players tab, loot To confirm, the sound deck, the character screens)                                                                                                                                               | After the checks above                   |
| Stage 9 (measuring)     | **The Windows microphone clipping retest** with auto gain off (the first real recording clipped: speech near -15 dBFS RMS, peaks at full scale)                                                                                                                                                                 | Andy, on Windows                         |
| Stage 9 (measuring)     | **The audio engine measured**: headsets and Bluetooth, latency, CPU, hour-long drift; audio parity on Linux (GNOME and KDE) and macOS; whether feeding the soundboard to the echo canceller from the first sample shortens its learning (Andy saw it on 2026-11-20)                                             | Real machines                            |
| Stage 9 (measuring)     | **The 8+ hour soak with churn**: people joining, leaving, muting and rejoining, memory against the Stage 0.5 rules; and a `kill -9` of the packaged backend mid-recording                                                                                                                                       | The VM; the long session looped          |
| Stage 10                | **OIDC against a real provider** (built, tested against a fake one; switched off on Andy's server)                                                                                                                                                                                                              | Authelia or another provider             |
| Stages 3b to 10 (audit) | **A reachability pass over every earlier stage**: Stage 10's audit found two built features a player could not reach and only looked at two; check that everything built has a way in, in both apps                                                                                                             | Reading the apps                         |
| Stage 7 (never run)     | Android browsers and iOS Safari on the phone web app; deep links on Windows and macOS; the Linux AppImage                                                                                                                                                                                                       | Real devices                             |

## Decisions and open questions

**Decided with Andy, 2026-11-21:**

1. **The session is written for the test** (see [The source dialogue](#the-source-dialogue)).
2. **The long runs happen on both machines:** the harness is built and iterated on the dev PC (a GPU, so a run takes minutes), and the baseline and the soak run on the VM (the realistic CPU case).
3. **No cloud runs yet.** Runs 4 and 5 (Claude and OpenAI) stay open in Stage 13 until Andy says go, and he supplies the keys himself.
4. **One real client in the room: Andy's Linux desktop app**, joining as an extra participant for the whole run, with the measuring scripts recording its CPU, memory and jitter. The Windows app is a separate check (the microphone clipping retest).

**Still open (Claude's defaults, change freely):** plant **25 to 40 facts**, and Andy reads **all five tales from run 1**, then a sample from later runs.
