# Records smoke test (ROADMAP Stage 2, Part B)

Throwaway scripts that prove the server-side records chain on a real Linux box and **measure it** for the sizing numbers in [DEPLOYMENT-AND-TRANSPORT.md](../../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md) and [RECORDING-AND-SUMMARIES.md](../../docs/architecture/RECORDING-AND-SUMMARIES.md). Nothing here is production code; Stage 5 replaces it with the job queue.

**Status:** run end to end on 2026-11-07 on a Linux dev PC — results and the design consequences are in [AUDIO-SPIKE-RESULTS.md](../../docs/architecture/AUDIO-SPIKE-RESULTS.md) (Finding 4). Docker is the easiest way to get the pieces: the Compose bundle's `records` profile runs Egress, and [whisper-docker.sh](whisper-docker.sh) stands in for a native `whisper-cli` (`--whisper-bin infra/records-smoke/whisper-docker.sh`).

**GPU:** [`whisper-cuda.Dockerfile`](../compose/whisper-cuda.Dockerfile) builds whisper.cpp for Pascal and newer cards (upstream's prebuilt CUDA image does not support GTX 10-series). Then `WHISPER_IMAGE=vtt-whisper-cuda WHISPER_GPU=1 node ai/dist/cli/records-smoke.js --whisper-bin infra/records-smoke/whisper-docker.sh …`. `records-smoke` segments each track into speech windows by default; `--whole-track` restores the old behaviour for comparison, and `--noise-db` tunes the silence threshold (default -40 dB).

**Remote or alternative backends:** `--whisper-url http://gpu-pc:8080` (an OpenAI-compatible `/v1/audio/transcriptions`; `WHISPER_API_KEY` if it needs one) and `--llm-url … --llm-model …` (`/v1/chat/completions`; `LLM_API_KEY`). With `--model` also given, the local whisper.cpp is the fallback after `--fallback-after-sec` (default 600) of the remote being unreachable; `--no-fallback` waits indefinitely instead. A whisper.cpp server speaks this API with `whisper-server --inference-path /v1/audio/transcriptions`.

**Restart drill:** `infra/records-smoke/restart-drill.sh` starts its own LiveKit and Egress, records a synthetic speaker, simulates a backend restart and checks that recovery stops the egress, keeps the audio and queues processing (see [RECORDING-AND-SUMMARIES.md](../../docs/architecture/RECORDING-AND-SUMMARIES.md)).

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
