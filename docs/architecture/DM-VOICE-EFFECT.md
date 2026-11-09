# DM voice effect — design note (open, needs a decision)

**Status:** built 2026-11-08 as **option 1** (Andy: yes, accepted the echo-cancellation trade-off, will test).
The DSP is unit-tested; the capture path starts and releases the real microphone on the dev box; **nobody
has listened to it yet, and latency/CPU on a live call are unmeasured.** See "As built" at the end.

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

| Concern                    | Effect on the DM's path                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Echo cancellation, noise   | **Lost** unless re-added (WebRTC's APM is not exposed by the Rust SDK as far as I found); open-mic tables with speakers need it. Headphones largely avoid the problem. |
| "Mute releases the device" | Still achievable: stop our own cpal stream. Unmute latency must be re-measured (AUDIO-SPIKE-RESULTS.md).                                                               |
| Latency                    | Capture buffer + one DSP block + the source queue; a pitch/formant shifter needs ~20–40 ms of look-ahead on top of today's. Budget to be measured on the dev box.      |
| CPU                        | A phase-vocoder or granular shifter is a few percent of one core per 48 kHz mono stream; fine for one DM.                                                              |
| Players                    | Unchanged: only the DM's published track differs. Normal voice is the same code path with the effect off.                                                              |

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

## As built

- **Voices:** normal, giant (×0.72), imp (×1.4), robot (70 Hz ring modulator), demon (×0.6 into soft clipping), plus four added 2026-11-09:
  - **dragon** — ×0.5, a 28 Hz amplitude "growl", soft clipping and a 70 ms echo.
  - **god** — the voice at ×0.8 with a second octave-down voice (×0.5) under it, in a 95 ms echo "hall". Two shifters, so it costs about twice the CPU of giant.
  - **drunk** — a 0.9 Hz swaying delay (±9 ms around 14 ms, about ±100 cents of wobble) through a 3.2 kHz low-pass for a slurred, dull tone.
  - **authoritative** — ×0.9, pushed into a soft limiter so quiet and loud speech sit closer, with a short 32 ms room.

  **These four are tuned by calculation and tests on synthetic tones, not by ear** (tests check pitch, layering, wobble and that nothing clips). The numbers at the top of `voice_fx/effects.rs` are the knobs to turn once someone has listened.
  Pure DSP in `rust-livekit/src/voice_fx/` (dual-tap pitch shifter; algorithmic delay 16–21 ms, i.e. half the
  window), tested on synthetic tones for pitch, sidebands, range and silence.

- **Two paths, never both open** (`voice_fx/plan.rs`, tested): the normal voice keeps WebRTC's capture and
  its echo cancellation; a character voice stops that capture, starts ours (cpal → 48 kHz mono → effect →
  `NativeAudioSource`) and unmutes a second published track, `voice-fx`. Mute stops both and releases the
  device. A rejoin republishes the track and keeps the voice. If our microphone cannot start the app falls
  back to the normal voice rather than leaving the DM silent.
- **Recordings** capture whatever each track carried: the DM's `voice-fx` track holds the **processed** voice
  while an effect is on (the silent `microphone` track is recorded too). Raw-vs-processed is therefore not
  yet a choice; keeping the raw voice would mean publishing it as a third (private) track. Decide after listening.
- **UI:** the DM's Effects drawer has a Voice row; `/voice <name>`; resets to normal when voice is left.
- **To test (needs a person):** is it intelligible and not robotic-glitchy at speaking pace; does the table
  hear it (run `npm run dev:mock`, join as the DM, and listen on a second client); latency feel; CPU while
  talking; echo with speakers vs headphones; switching voices mid-sentence.
