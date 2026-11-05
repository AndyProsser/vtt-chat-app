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
- Default taken for the playout trade-off below: **(a) keep the audio layer's playout** until acoustic tests say otherwise.

## Open

1. **Per-player gain and the cue mixer vs. the ADM.** Options: (a) accept ADM playout and do gain by other means; (b) take over playout ourselves (`NativeAudioStream` per remote → own mixer → one output stream) and feed WebRTC's audio-processing module the mixed signal as the echo reference (`libwebrtc::native::apm`, which exists). (b) keeps full control but is the harder path and is only worth it if acoustic tests show (a) can't meet the gain requirement.
2. Acoustic AEC quality, CPU and latency — need two machines, open mics and speakers, and a LiveKit server.
3. Auto-rejoin after network drop and sleep/wake.
4. Part B (Egress → Whisper.cpp → Ollama): needs a Linux dev server; none of `livekit-server`, `ffmpeg`, `whisper.cpp` or `ollama` is installed on the Windows machine used so far.
