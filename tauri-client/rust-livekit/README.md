# rust-livekit

The native **audio engine and LiveKit client** — the only thing in this app that touches audio or WebRTC. See [CLAUDE.md §8.2](../../.claude/CLAUDE.md).

**Status:** rebuilt in Stage 2 on `livekit`'s `PlatformAudio` (WebRTC's own audio layer: device I/O, echo cancellation, noise suppression, gain) instead of hand-rolled `cpal` capture/playback — see [AUDIO-SPIKE-RESULTS.md](../../docs/architecture/AUDIO-SPIKE-RESULTS.md). It joins a room, publishes the microphone, **releases the capture device on mute**, and **rejoins automatically** (backoff, token refresh via a provider, sleep/wake detection). Compiles and unit-tests clean; **not yet exercised against a live server or with real acoustics** — that is the remaining Stage 2 Part A work. **Per-player gain and the local cue mixer are not built**: the audio layer's playout has no per-participant volume (open trade-off in the results doc).

`examples/loopback.rs` connects two clients to one room against a real LiveKit server to verify capture → publish → subscribe → playback without Tauri or a second account: `cargo run --example loopback -- <ws-url> <token-a> <token-b> [seconds]`. Run against a real server on 2026-08-09; Andy confirmed hearing his own voice back.

## Responsibilities

- Native WebRTC connection to the LiveKit server, with **auto-rejoin** after network drop and sleep/wake
- Native audio device control; **release the capture device on mute** so OS mic-in-use indicators turn off (under evaluation — unmute latency to be measured in Stage 2)
- **Echo cancellation and noise suppression** — open mics are the default use case
- Local mixer with **per-player gain**
- Track and group (channel / party) management
- **Local cue player**: recording start/stop cues and soundboard effects, played on the client — never through the SFU, so they are absent from recordings and play while muted
- Long-session stability: runs for the life of the app, independent of any window, so opening or closing panels never interrupts audio
- Exposes commands/events consumed by `src-tauri/` and, indirectly, `panels-ui/`
- _Not_ a recorder: recording is server-side (LiveKit Egress). Client-side recording is deliberately out of scope.

## Language / Tooling

Rust, part of the Cargo workspace rooted at `tauri-client/`. `rustfmt` + `clippy` clean, per [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md).

## Depends On

Nothing else in-repo. This is a leaf crate — `src-tauri/` depends on it, not the other way around. It must remain usable headless (no Tauri) so the Stage 2 spike and future CI can exercise it directly.
