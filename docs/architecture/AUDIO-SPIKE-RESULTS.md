# Audio Spike Results (Stage 2, running log)

Measured numbers and findings from [ROADMAP Stage 2](../../ROADMAP.md#stage-2--audio--records-spike), kept short and dated. Design conclusions are copied into the architecture docs once they stop moving.

## Finding 1 — use WebRTC's platform audio layer, not hand-rolled `cpal` + AEC (2026-11-05)

`livekit` 0.8.2 ships `PlatformAudio`: WebRTC's own audio device module (WASAPI on Windows, CoreAudio on macOS, PulseAudio/ALSA on Linux). It covers device enumeration and selection, capture and playout, echo cancellation, noise suppression and gain control, and it can stop and restart recording. That is the same engine on every OS, which is what "consistent audio behaviour across platforms" asks for, with far less code than our own `cpal` capture/playback plus a separately fed echo canceller.

**Trade-off found:** WebRTC's playout mixes all remote tracks with no per-participant volume. The requirement for **per-player gain** and a **local cue/soundboard mixer** (CLAUDE.md §8.2) therefore doesn't fit the ADM playout path as it stands. See "Open" below.

## Finding 2 — release-on-mute is viable on Windows (2026-11-05)

`examples/audio_probe.rs`, Windows 11, one built-in-class microphone, `PlatformAudio` with a device selected explicitly:

| Operation                                   | Measured                              | Notes                                                      |
| ------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| `stop_recording` (mute: release the device) | 3.3–4.6 ms                            |                                                            |
| `start_recording` (unmute: re-acquire)      | 22.8–27.5 ms steady, 96 ms first call | 4 cycles; well below anything a user perceives as clipping |

- Calling `start_recording` **before** selecting a device fails; select one first.
- Requesting _hardware_ processing made `start_recording` fail on this machine every time. The default (software) works.
- Whether the **OS microphone indicator** actually goes off during the released phase was not observed (no display access in the measuring session) — check by eye with `cargo run -p rust-livekit --example audio_probe -- 5 3000`.

## Finding 3 — "which AEC is active" differs per machine (2026-11-05)

On this Windows machine `active_aec_type()` reports **Hardware** (Windows-provided processing) even when software processing is requested, with NS and AGC reported as software. So "same engine everywhere" is not guaranteed in practice: the AEC in use depends on the OS and driver. Acoustic quality (echo with speakers and an open mic) needs a real two-machine test; `audio_probe` prints the active implementation so each test machine can be logged here.

## Built so far (2026-11-05, untested against a live server)

- `rust-livekit` now sits on `PlatformAudio`; the `cpal` capture/playback code is gone. The client starts muted with the capture device released; mute/unmute call `stop_recording`/`start_recording`.
- **Auto-rejoin:** a supervisor task rejoins with exponential backoff (1 s → 30 s, jittered) when the room disconnects, re-fetching the token through a `ConnectInfoProvider` each time so an expired token isn't replayed. A 5 s heartbeat compares wall-clock gaps to detect sleep/wake and rejoins immediately. Mute state survives a rejoin. Backoff and resume detection are pure functions with unit tests; the supervisor itself needs a live server to test.
- **Records pipeline pieces** in `ai/`: whisper.cpp JSON parsing, per-speaker merge (drops private tracks), chunking, map-reduce summarisation, an Ollama client, and `records-smoke` — all unit-tested with fakes. `infra/records-smoke/` has the track-egress starter and the runbook; `livekit/*.dev.yaml` has dev configs (Egress config unverified).
- **Local cue player** (`rust-livekit/src/cue/`): `policy` decides when a cue plays (live transitions always; a late joiner hears the start cue before capture; a quick reconnect does not replay it; acknowledgements expire), `synth` renders four distinct synthesised earcons (start = rising triad, stop = falling triad, pause = two low falling notes, resume = two mid rising notes), `play` outputs them on the default speakers through their own short-lived stream, independent of any room. 15 unit tests cover the policy and the synthesis; **the playing itself has not been heard** — run `cargo run -p rust-livekit --example cue_demo` and judge the sounds. Known limitation: the echo canceller doesn't see cues as far-end audio, so one played while the mic is open could leak into it; the start cue gates capture, so this mainly affects pause/resume/stop.
- Default taken for the playout trade-off below: **(a) keep the audio layer's playout** until acoustic tests say otherwise.

## Finding 4 — Part B ran end to end (2026-11-07, Linux dev PC, Docker)

Hardware: 8-core desktop CPU, 31 GB RAM, GTX 1080 (not used for Whisper in these numbers). LiveKit server 1.13.5, **Egress v1.15.0**, whisper.cpp (`ghcr.io/ggml-org/whisper.cpp:main`, CPU), `small` q5_1 model, Ollama 0.30.2 + `llama3.2:3b` (the dev PC's own).

- **Chain works:** two LiveKit participants → **per-speaker track egress** (one Ogg/Opus file per identity, never mixed) → ffmpeg → whisper.cpp → merge by speaker → Ollama summary. The summary was weak because the input was one repeated quote; the chain, not the prose, is what this proves.
- **Egress works with a minimal config** (`api_key`, `api_secret`, `ws_url`, `redis.address`, `health_port`; files land on the container's local disk). The old "unverified" dev config was not needed as written. Egress **must** share Valkey/Redis with LiveKit. Its image is ~3.8 GB (it bundles Chrome for web egress we do not use).
- **Egress files start when the egress starts, not when the speaker joined.** Filenames carry a wall-clock stamp (`alice@2026-11-07T050659.ogg`), plus a sidecar `EG_….json` with `started_at` (ns) and `ended_at`. The pipeline must turn those into `startOffsetMs` against the recording's start; the smoke script's `<id>@<offsetMs>` convention is a manual rename today.
- **Whisper CPU speed (`small` q5_1, 8 threads):** a **continuous-speech** 10-minute track took 462 s, **RTF 0.77**. A **sparse** 10-minute track (11 s of speech each minute, quiet room noise between) took 275 s without VAD (RTF 0.46, and 27 segments for 10 real utterances — Whisper invented text on the noise) and 76 s with whisper.cpp's `--vad` (RTF 0.13).
- **Do not trust whisper.cpp `--vad` timestamps.** With VAD the 10 segments spanned the gaps between utterances (e.g. 5.3–50.4 s for speech at 5–16 s), so offsets drift by tens of seconds. Without VAD a track that begins with 12 s of silence reported its speech as starting at 0 s, so two speakers both showed `[0:00:00]` in the merged transcript. **Ordering across speakers depends on accurate offsets**, so this matters.
- **ffmpeg `silencedetect` (`n=-35dB:d=2`) found the exact speech windows** (5.1–16.0 s, 65.1–76.0 s, …). Design implication for Stage 5: **segment each track ourselves** (ffmpeg or Silero VAD) into speech windows, transcribe each window (or windows merged up to Whisper's 30 s context), and add the window's offset. That gives accurate timestamps, skips silence (most of a tabletop session, per track), and avoids hallucination on noise.
- **Sizing consequence:** per-speaker tracks multiply the work — 5 players × 4 h is 20 audio-hours. Transcribing every second at RTF 0.77 would be ~15 h of CPU per session; with silence skipped and ~25% speech it is a few hours, which fits "run after the session, sessions weekly". A GPU (the dev PC's GTX 1080 is visible to Docker via CDI) should change this by an order of magnitude; **not yet measured**.

## Finding 5 — GPU, and speech-window segmentation (2026-11-07)

**GPU (GTX 1080, 8 GB, via Docker CDI).** Upstream's prebuilt `whisper.cpp:main-cuda` image only contains kernels for sm_75/80/86/90 (it is built on CUDA 13, which dropped Pascal), so on a GTX 10-series card it dies with `no kernel image is available`. [`whisper-cuda.Dockerfile`](../../infra/records-smoke/whisper-cuda.Dockerfile) rebuilds it on CUDA 12.4 for `61;75;86;89`; **the build takes ~30 minutes** (once), the image is ~5.8 GB. Anyone pointing the pipeline at a remote GPU box needs to check the card's compute capability first.

| Whisper run, same sparse 10-min track    | Time     | RTF (whole track) | Result                                                             |
| ---------------------------------------- | -------- | ----------------- | ------------------------------------------------------------------ |
| CPU `small` q5_1, whole track            | 275 s    | 0.46              | 27 segments for 10 utterances, wrong offsets                       |
| CPU `small`, whisper.cpp `--vad`         | 76 s     | 0.13              | 10 segments, offsets drift tens of seconds                         |
| GPU `small`, whole track                 | 9 s      | 0.015             | 26 segments, wrong offsets, `[ Silence ]` text                     |
| GPU `large-v3-turbo` q5_0, whole track   | 27 s     | 0.045             | **56** segments, `Thank you.` invented on noise at 30 s boundaries |
| **CPU `small`, speech windows (ours)**   | **90 s** | **0.15**          | **10 segments, offsets within the 0.4 s pad**                      |
| **GPU `small`, speech windows**          | **17 s** | **0.028**         | 10 segments, correct                                               |
| **GPU `large-v3-turbo`, speech windows** | **20 s** | **0.034**         | 10 segments, correct                                               |

(Windowed runs include launching a container per window, so they overstate the GPU's cost; they were run on an idle machine after the CUDA build finished.)

- **The timestamp problem is not CPU-bound.** The GPU reproduced it exactly: with 12 s of leading silence, `small` and `large-v3-turbo` both report the speech at 0.0 s. It is how Whisper treats long silences, not a speed or precision issue — so segmentation is needed on every hardware.
- **A bigger model is not safer on silence.** `large-v3-turbo` hallucinated _more_ on the noisy sparse track than `small` when given the whole track. Windows that contain speech fix it for both.
- **Windows work.** Segments land within the 0.4 s of padding of the true start (`[0:00:04]`, `[0:01:04]` … for speech at 5, 65, … s), the text is right every time, and no text is invented.
- **Not yet judged:** `small` vs `large-v3-turbo` _accuracy_ (the only speech available is one repeated 11 s sample, which both get right), and `medium`. Needs a real multi-speaker recording with a reference transcript.

## Open

1. **Per-player gain and the cue mixer vs. the ADM.** Options: (a) accept ADM playout and do gain by other means; (b) take over playout ourselves (`NativeAudioStream` per remote → own mixer → one output stream) and feed WebRTC's audio-processing module the mixed signal as the echo reference (`libwebrtc::native::apm`, which exists). (b) keeps full control but is the harder path and is only worth it if acoustic tests show (a) can't meet the gain requirement.
2. Acoustic AEC quality, CPU and latency — need two machines, open mics and speakers, and a LiveKit server.
3. Auto-rejoin after network drop and sleep/wake.
4. ~~Part B~~ ran on 2026-11-07 (Finding 4). Still open: Whisper on GPU, `medium`, VAD-segmented transcription built into `ai/`, and a long real conversation instead of a repeated sample.
