# Records smoke test (ROADMAP Stage 2, Part B)

Throwaway scripts that prove the server-side records chain on a real Linux box and **measure it** for the sizing numbers in [DEPLOYMENT-AND-TRANSPORT.md](../../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md) and [RECORDING-AND-SUMMARIES.md](../../docs/architecture/RECORDING-AND-SUMMARIES.md). Nothing here is production code; Stage 5 replaces it with the job queue.

**Status:** run end to end on 2026-11-07 on a Linux dev PC — results and the design consequences are in [AUDIO-SPIKE-RESULTS.md](../../docs/architecture/AUDIO-SPIKE-RESULTS.md) (Finding 4). Docker is the easiest way to get the pieces: the Compose bundle's `records` profile runs Egress, and [whisper-docker.sh](whisper-docker.sh) stands in for a native `whisper-cli` (`--whisper-bin infra/records-smoke/whisper-docker.sh`).

**GPU:** [`whisper-cuda.Dockerfile`](../compose/whisper-cuda.Dockerfile) builds whisper.cpp for Pascal and newer cards (upstream's prebuilt CUDA image does not support GTX 10-series). Then `WHISPER_IMAGE=vtt-whisper-cuda WHISPER_GPU=1 node ai/dist/cli/records-smoke.js --whisper-bin infra/records-smoke/whisper-docker.sh …`. `records-smoke` segments each track into speech windows by default; `--whole-track` restores the old behaviour for comparison, and `--noise-db` tunes the silence threshold (default -40 dB).

**Remote or alternative backends:** `--whisper-url http://gpu-pc:8080` (an OpenAI-compatible `/v1/audio/transcriptions`; `WHISPER_API_KEY` if it needs one) and `--llm-url … --llm-model …` (`/v1/chat/completions`; `LLM_API_KEY`). With `--model` also given, the local whisper.cpp is the fallback after `--fallback-after-sec` (default 600) of the remote being unreachable; `--no-fallback` waits indefinitely instead. A whisper.cpp server speaks this API with `whisper-server --inference-path /v1/audio/transcriptions`.

**Restart drill:** `infra/records-smoke/restart-drill.sh` starts its own LiveKit and Egress, records a synthetic speaker, simulates a backend restart and checks that recovery stops the egress, keeps the audio and queues processing (see [RECORDING-AND-SUMMARIES.md](../../docs/architecture/RECORDING-AND-SUMMARIES.md)).

**The demo campaign and its runner (Stage 13).** A reusable three-session campaign, a runner that plays it into a real server, and a monitor that records the machine while it does: [`fixtures/campaign/`](fixtures/campaign/README.md), `campaign-run.ts` and [`validation/`](validation/). Design: [QUALITY-VALIDATION.md](../../docs/architecture/QUALITY-VALIDATION.md).

```bash
npm run campaign:check                       # validate the fixtures (no services needed)
npm run campaign:test                        # the tests for the fixtures, the monitor, the report and the scoring

# Where: --target local (the Compose stack on this machine) or --target vm (over SSH)
export VTT_VM_SSH=<user@host>  VTT_API=<the server's URL as players reach it>   # for --target vm; never commit these
export NODE_EXTRA_CA_CERTS=<Caddy's root.crt>                                   # for a server with a private certificate

npm run campaign:dry -- --target vm          # walk the plan compressed while measuring the real server: sends nothing
node infra/records-smoke/campaign-run.ts live --target local --glossary both     # play the sessions for real and score them
node infra/records-smoke/campaign-run.ts live --target local --sessions 1 --max-lines 45 --no-observer   # a quick smoke test of the machinery
node infra/records-smoke/campaign-run.ts report <run dir>                        # write report.md again from a finished run
node infra/records-smoke/campaign-run.ts pack <run dir>                          # a reading pack: tales, the Game Master's brief and notes, memory, the callbacks table
```

A **dry run** needs nothing but the server's address: it measures the server at idle and shows the report's shape. A **live run** creates five accounts (`lanterns-*@example.com`) and a campaign on the target and leaves them (delete the campaign with `vtt-admin campaign delete <id>`), prints an **invite code for player 5** and waits up to ten minutes for the developer's own client to join (skip with `--no-observer`), then plays each session in real time with piper voices (the five voices are listed in the campaign README), waits for the records, and scores them: facts, canaries, glossary terms, word accuracy, memory and callbacks. Results go to `~/.local/state/vtt-validation/<time>-<target>-<label>/` (outside the repo): `report.md` (read this), `summary.json`, `samples.jsonl` (every sample), `events.jsonl` (phases, actions, error lines) and `outputs/` (each session's transcript, summaries and memory). The remote host's address is never written to a file.

## The Compose end-to-end test (`compose-e2e.ts`): run it after an install

The whole records path against a **running** Docker Compose stack with the `records` profile up, as players
would use it: throwaway accounts (`e2e-*@example.com`, made with `vtt-admin user create`) and the test's own
campaign; four people connected over the WebSocket and to LiveKit voice, each publishing synthetic speech
(piper TTS, a different voice each) as their microphone; the DM records through the API while every app
acknowledges the cue; a late joiner who has not acknowledged yet; a pause; typed chat of every kind
(plain, `/say`, `/do`, `/ooc`, `/late`, `/dm`, `/tell`); a second recording; then the worker, Whisper and
the LLM, checked through the Records API as the DM and as a player. About 4 minutes of scene, then
processing (minutes on a GPU, longer on a CPU).

```bash
# once: piper and four voices, user-local (no apt)
mkdir -p ~/.local/share/piper-voices && cd ~/.local/share
curl -fL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz | tar -xz
cd piper-voices && for v in en_GB/alan/medium/en_GB-alan-medium en_US/amy/medium/en_US-amy-medium \
    en_US/ryan/medium/en_US-ryan-medium en_GB/southern_english_female/low/en_GB-southern_english_female-low; do
  for x in onnx onnx.json; do curl -fsSLO "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/$v.$x"; done
done

# each run, from the repository root (npm install and `npm run build -w shared -w ai` done)
NODE_EXTRA_CA_CERTS=<path to Caddy's root.crt> node infra/records-smoke/compose-e2e.ts [--fallback] [--no-kill]
```

What it checks (each line is PASS/FAIL; results also go to `~/.local/state/vtt-compose-e2e/results-*.json`,
with the transcripts and summaries it read):

- every connected app acknowledged the cue; the late joiner is told "in progress, not acknowledged", and
  **nothing they said before acknowledging is in the transcript**;
- each speaker's words are attributed to them (word accuracy ≥ 0.85 against the script, per speaker), and no
  line is under the wrong name;
- typed in-character lines are in the transcript, marked typed; **the `/ooc`, `/late`, `/dm` and `/tell`
  lines and the words spoken while paused appear nowhere** (transcript, summaries, search as DM or player);
- session, DM-only, chapter (one per side of the pause) and character summaries exist; players never get
  the DM-only one (detail, list or search);
- search finds a spoken phrase and a typed one; the bookmarks (start/pause/resume/stop) are in the history;
- the durable queue: the worker is `docker compose kill`ed mid-job and started again, and the job finishes on
  a later attempt (it waits out the 5-minute lease) — skip with `--no-kill`;
- `--fallback`: transcription is pointed at an unreachable server with a 20 s fallback, recording B is
  re-transcribed, and the worker must fall back to the local Whisper (AI settings are restored afterwards).

It needs `docker` access (for `vtt-admin`, the kill drill and the logs) and opens campaign creation for a
moment if it is closed. `--verify <A>,<B>` re-checks two earlier recordings without a new scene.
**Measuring a server:** `whisper-bench.ts` (Whisper real-time factor and accuracy through the worker's
own code path, against any whisper-server) and `llm-bench.ts` (the summary models on one transcript).

## The protocol 4 end-to-end test (`protocol4-e2e.ts`)

What 0.6.0 added to the wire, driven as real people would use it, against a running stack (no voice, no AI, so any
install will do; **do not point it at a server you care about**: it makes three `p4-*@example.com` accounts and the
campaign "E2E: Protocol 4", and puts back every setting it touches). 39 checks: the handshake (protocol 4 accepted,
3 told to update), the storyteller (default, DM-only change, live `campaign.updated`, the operator switches and the
Tavern Bard that cannot be turned off, where tales are processed), loot (re-drop moves one card, "added to my sheet"
per person, resets, announced only to who may see it, never shown to the DM), GM notes and the glossary (a picture
attached, every route refused to players, only pictures and PDFs accepted) and deleting a character.

```bash
NODE_EXTRA_CA_CERTS=<path to Caddy's root.crt> node infra/records-smoke/protocol4-e2e.ts
```

It is safe to run again and again. First run 2026-11-20 against the local smoke stack on a rebuilt backend: 39 of 39.
The phone app's table page, invite page and Leave have their own browser test, `web/e2e/campaign-screens.mjs`.

## What you need on the server (native; or use Docker as above)

| Piece                           | Used for                        | Notes                                                        |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------ |
| `livekit-server`                | the SFU                         | `livekit-server --config livekit.dev.yaml`                   |
| LiveKit **Egress**              | writing per-speaker track files | needs Redis; configs in [livekit/](../../livekit/)           |
| Redis                           | Egress ↔ server signalling      | `redis-server` on localhost                                  |
| `ffmpeg` / `ffprobe`            | transcoding to 16 kHz mono WAV  | from apt                                                     |
| **Whisper.cpp** (`whisper-cli`) | transcription                   | build from source; download a ggml model (`small`, `medium`) |
| **Ollama**                      | summary                         | `ollama pull <model>`; any small instruct model to start     |
| Node 26                         | runs the scripts                | same as the repo                                             |

## Steps

1. **Start** LiveKit, Redis and Egress with the dev configs in [livekit/](../../livekit/).
2. **Join the room** with two or more clients (the `loopback` example in `tauri-client/rust-livekit`, or any LiveKit client) and talk.
3. **Record per-speaker tracks:**
   ```bash
   LIVEKIT_URL=http://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
     node infra/records-smoke/start-track-egress.ts <room-name> <output-dir>
   ```
   It starts one **track egress** per published audio track, so each speaker lands in its own file (never a mixed one), and prints the egress ids. Stop them with the same script and `--stop <id> ...`.
4. **Name the files** `<speakerId>.<ext>`, or `<speakerId>@<startOffsetMs>.<ext>` for someone who joined late (their file starts later than the recording did).
5. **Run the pipeline:**
   ```bash
   npm run build -w @vtt-chat-app/ai
   node ai/dist/cli/records-smoke.js --tracks <dir> --model <ggml-small.bin> --ollama-model <name>
   ```
   Optional: `--names names.json` (`{"alice": "Aria"}`), `--kind session|dm-only|character`, `--threads N`.
6. **Read the output** in `records-smoke-out/`: `transcript.txt` (speaker-attributed), `summary-<kind>.md`, and `timings.json` with the **Whisper real-time factor per track** — the key sizing number.

## What "done" looks like

A correctly speaker-attributed transcript of a real conversation, a readable summary, and the measured real-time factor for `small` and `medium` on the server's CPU (and GPU, if any) written into the design docs.
