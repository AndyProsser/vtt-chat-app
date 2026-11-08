# DM voice effect — design note (open, needs a decision)

**Status:** not built. Findings from reading the code and the `livekit` 0.8.2 / `libwebrtc` 0.3.44
sources on 2026-11-08; nothing here has been run.

## What is wanted

The DM picks a "voice" (giant, spirit, demon, robot…) in the main window; their voice changes for
everyone, live. Rust owns audio, so the effect runs in Rust.

## Why it is not a small change

Today the microphone is `PlatformAudio`: WebRTC's own audio device module captures, applies **echo
cancellation, noise suppression and gain control**, and feeds the track
(`rust-livekit/src/lib.rs`, `join_once`). There is **no access to the samples** on that path, so an
effect cannot be inserted into it.

LiveKit does offer the alternative: a `NativeAudioSource` (`libwebrtc::audio_source`) that we feed
with our own frames through `capture_frame`. Using it means **we capture the microphone ourselves**
(cpal, already a dependency for the soundboard), run the effect, and push 10 ms frames.

## The trade-offs

| Concern                        | Effect on the DM's path                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Echo cancellation, noise       | **Lost** unless re-added (WebRTC's APM is not exposed by the Rust SDK as far as I found); open-mic tables with speakers need it. Headphones largely avoid the problem. |
| "Mute releases the device"     | Still achievable: stop our own cpal stream. Unmute latency must be re-measured (AUDIO-SPIKE-RESULTS.md).|
| Latency                        | Capture buffer + one DSP block + the source queue; a pitch/formant shifter needs ~20–40 ms of look-ahead on top of today's. Budget to be measured on the dev box. |
| CPU                            | A phase-vocoder or granular shifter is a few percent of one core per 48 kHz mono stream; fine for one DM. |
| Players                        | Unchanged: only the DM's published track differs. Normal voice is the same code path with the effect off. |

## Options

1. **DM-only own-capture path (recommended if wanted):** the DM's client switches to
   `NativeAudioSource` + cpal only while an effect is selected; with "Normal" it keeps the WebRTC path
   and its echo cancellation. The AEC loss then applies only while a character voice is on.
2. **Always own-capture for everyone:** one code path, but every player loses WebRTC's AEC. Not recommended.
3. **Server-side effect:** the server transforms the DM's track before it reaches players. Adds server
   CPU and latency, and breaks "recording is per speaker, unaltered". Not recommended.

## Decisions needed from Andy

- Is **DM-only, effect-only own-capture (option 1)** acceptable, i.e. echo cancellation is off while a
  character voice is active (headphones advised)?
- Which voices first? A small, honest set is easier than many: pitch down ("giant"), pitch up,
  robot (ring modulation), and a whisper/breath ("spirit").
- Should recordings capture the **processed** voice (what players heard) or the **raw** one? Raw is
  better for transcription; processed matches the table.

## Plan once decided

Pure-Rust DSP module with unit tests on synthetic tones (pitch ratio, no clipping, silence in →
silence out) → own-capture path behind the effect selection → latency/CPU measurement on a real
device → then the picker (`/voice` and the drawer button) is enabled. The UI stays hidden until it
works.
