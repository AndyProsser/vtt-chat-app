# The mixer engine: our own capture and playback

**Status:** design plus the first layers (2026-11-09). Built and unit-tested without a sound card; **not yet wired into a call and never listened to.** The platform audio path stays the default until the mixer has been tried on the dev PC.

## Why

Today WebRTC's `PlatformAudio` owns the sound card: it captures the microphone, plays every remote voice, and runs echo cancellation between the two. That is simple and echo-safe for plain voice, but it is a closed box:

| Want | Why the platform path cannot |
| --- | --- |
| Echo cancellation for the DM's **character voices** | The effect path captures the microphone itself, so WebRTC never sees what was played: AEC is off while a voice is on. |
| Echo cancellation for **sound we play ourselves** (soundboard monitor, recording cues) | These use a second output stream WebRTC cannot see, so the microphone hears them and nothing cancels them. |
| **Per-player volume** | No playout volume API in the SDK (checked in 0.10.1's source). |
| **Microphone gain** and a **real level meter** | No capture gain or level API on that path. |

All four come from the same thing: if one piece of our code owns both the input and the output, it can tell the echo canceller exactly what left the speakers.

## The finding that makes it practical

The earlier note ([DM-VOICE-EFFECT.md](DM-VOICE-EFFECT.md)) assumed WebRTC's audio processing was not exposed to Rust. It is: the SDK's WebRTC crate ships `AudioProcessingModule` (echo cancellation, noise suppression, high-pass, gain control) taking plain 10 ms blocks, plus an `AudioMixer` and a resampler. So our own engine keeps WebRTC's AEC3, with the speaker reference supplied by us.

Proof, headless (`engine/processing.rs` tests): a talker plays through a simulated room (50 ms delay, half level) into the microphone; with the canceller on, the echo drops **45.8 dB** after a few seconds; with it off, it stays; and a second person speaking next to the microphone is not silenced. The room is ideal, so a real one will do worse; the point is that the mechanism works in our build.

## Shape

```mermaid
flowchart LR
  subgraph In[Capture]
    MIC[cpal input] --> G[mic gain + level meter] --> FX[character voice] --> CL[APM clean]
  end
  CL --> SRC[NativeAudioSource] --> LK((LiveKit room))
  LK --> RS[NativeAudioStream per remote track]
  subgraph Out[Playback]
    RS --> PM[playout mixer: per-player gain]
    CUE[recording cues] --> PM
    MON[DM soundboard monitor] --> PM
    PM --> REF[APM played: the reference]
    PM --> SPK[cpal output]
  end
  REF -.-> CL
```

- **One 48 kHz mono, 10 ms world** inside the engine (what WebRTC wants). Device rates and channel counts are converted at the edges only.
- **Layers, each testable without hardware:** `processing` (APM wrapper), `playout` (the mixer: streams, gains, limiter), `capture` (gain, meter, voice, cleaning), `io` (cpal behind small traits, with fakes for tests), then the LiveKit wiring.
- **Mute still releases the microphone** (stop the input stream), as now.
- **The soundboard track and the cues** keep working as they do; their local monitor simply plays *through* the playout mixer, so the canceller knows about it.

## Decisions and why

- **Opt-in, platform path stays default.** The mixer replaces the part of the app that most needs ears and hardware. It is switched by `VTT_AUDIO_BACKEND=mixer` until it has been listened to on the dev PC, then the default can flip. If it misbehaves, unset the variable.
- **WebRTC's own processing, not a new canceller.** Writing AEC is out of scope for a homelab app; AEC3 is the one browsers use.
- **Delay is estimated, then trimmed.** The canceller is told the output-plus-input latency; a wrong value slows convergence rather than breaking it. Measured on the dev PC, not guessed.
- **No hardware AEC.** The platform path can use a device's built-in canceller where one exists. The mixer does not. Cost: a few percent of one core for AEC3.
- **Clock drift** between the microphone and speakers (separate devices have separate clocks) is handled by the canceller up to a point; the playout buffer absorbs the rest by dropping or repeating a block, never growing without bound.

## Not verified (needs the dev PC)

Everything past the unit tests: real device behaviour on Windows and Linux (including USB headsets and Bluetooth), measured latency, drift over an hour, CPU, and what it sounds like. `docs/BUILD-STATUS.md` tracks it.
