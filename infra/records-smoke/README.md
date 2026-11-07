# Records smoke test (ROADMAP Stage 2, Part B)

Throwaway scripts that prove the server-side records chain on a real Linux box and **measure it** for the sizing numbers in [DEPLOYMENT-AND-TRANSPORT.md](../../docs/architecture/DEPLOYMENT-AND-TRANSPORT.md) and [RECORDING-AND-SUMMARIES.md](../../docs/architecture/RECORDING-AND-SUMMARIES.md). Nothing here is production code; Stage 5 replaces it with the job queue.

**Status:** run end to end on 2026-11-07 on a Linux dev PC — results and the design consequences are in [AUDIO-SPIKE-RESULTS.md](../../docs/architecture/AUDIO-SPIKE-RESULTS.md) (Finding 4). Docker is the easiest way to get the pieces: the Compose bundle's `records` profile runs Egress, and [whisper-docker.sh](whisper-docker.sh) stands in for a native `whisper-cli` (`--whisper-bin infra/records-smoke/whisper-docker.sh`).

**GPU:** `whisper-cuda.Dockerfile` builds whisper.cpp for Pascal and newer cards (upstream's prebuilt CUDA image does not support GTX 10-series). Then `WHISPER_IMAGE=vtt-whisper-cuda WHISPER_GPU=1 node ai/dist/cli/records-smoke.js --whisper-bin infra/records-smoke/whisper-docker.sh …`. `records-smoke` segments each track into speech windows by default; `--whole-track` restores the old behaviour for comparison, and `--noise-db` tunes the silence threshold (default -40 dB).

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
