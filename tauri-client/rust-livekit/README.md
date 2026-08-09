# rust-livekit

Native Rust LiveKit client — the only thing that talks WebRTC in this app. See [CLAUDE.md §8.2](../../CLAUDE.md).

**Status:** Stage 1 subset implemented — room connect/disconnect, mic capture and remote playback via `cpal` (dedicated OS threads per device, since `cpal::Stream` isn't `Send`), and connection-state callbacks. The `NativeAudioSource` is built from the input device's actual negotiated sample rate rather than a hardcoded value — `capture_frame` silently rejects every frame if the two don't match exactly. Echo cancellation, audio FX, and recording are future work (see Responsibilities below).

`examples/loopback.rs` connects two `LiveKitClient`s to the same room under different identities against a real LiveKit server, to manually verify the capture → publish → subscribe → playback pipeline without needing a second DDB account or a Tauri window — see [ROADMAP.md](../../ROADMAP.md#stage-1--walking-skeleton-auth--voice-end-to-end) for the run log. `cargo run --example loopback -- <ws-url> <token-a> <token-b> [seconds]`.

## Responsibilities

- Native WebRTC connection to the LiveKit server
- Native audio device control and echo cancellation
- Track and group (channel) management
- Native audio FX
- Native recording (future)
- Long-session stability — this runs for the lifetime of the app, not per-window, so switching or closing Tauri windows never interrupts audio (see [CLAUDE.md §8.1 "Audio continuity"](../../CLAUDE.md))
- Exposes Tauri commands consumed by `src-tauri/` and, indirectly, `overlay-ui/`

## Language / Tooling

Rust, part of the Cargo workspace rooted at `tauri-client/`. `rustfmt` + `clippy` clean, per [docs/CONVENTIONS.md](../../docs/CONVENTIONS.md).

## Depends On

Nothing else in-repo. This is a leaf crate — `src-tauri/` depends on it, not the other way around.
