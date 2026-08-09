//! Manual two-identity loopback test for the capture -> publish -> subscribe -> playback
//! audio pipeline, run against a real LiveKit server. No DDB, no Tauri window.
//!
//! Connects two `LiveKitClient`s to the same room under two different identities, using the
//! same unmodified public API `src-tauri/` uses. Each identity publishes its own microphone
//! and plays back whatever it subscribes to, so this exercises both directions of the real
//! pipeline at once — wear headphones on at least one side, or you'll get feedback between
//! the two identities' playback and capture on this machine's shared speaker/mic.
//!
//! Mint the two tokens from a running `backend/` instance (same room, two distinct
//! `ddbUserId`s) — see DEVELOPING.md. Usage:
//!
//!   cargo run --example loopback -- <ws-url> <token-a> <token-b> [seconds=20]

use std::env;
use std::sync::Arc;
use std::time::Duration;

use rust_livekit::{ConnectionState, LiveKitClient};

fn print_state(label: &str, state: ConnectionState) {
    println!(
        "[{label}] connected={} room={:?} participants={:?}",
        state.connected, state.room_name, state.participant_identities
    );
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "usage: {} <ws-url> <token-a> <token-b> [seconds=20]",
            args[0]
        );
        std::process::exit(1);
    }
    let url = &args[1];
    let token_a = &args[2];
    let token_b = &args[3];
    let seconds: u64 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(20);

    println!("connecting identity A...");
    let client_a = LiveKitClient::connect(url, token_a, Arc::new(|s| print_state("A", s)))
        .await
        .expect("identity A failed to connect");

    println!("connecting identity B...");
    let client_b = LiveKitClient::connect(url, token_b, Arc::new(|s| print_state("B", s)))
        .await
        .expect("identity B failed to connect");

    println!(
        "\nBoth identities connected and publishing. Speak into your microphone for the next \
         {seconds}s — you should hear yourself played back (with round-trip network delay) \
         through the other identity's subscription to your track.\n\
         Wear headphones on at least one side to avoid feedback between the two.\n"
    );
    std::thread::sleep(Duration::from_secs(seconds));

    println!("disconnecting...");
    client_a.disconnect().await.expect("disconnect A failed");
    client_b.disconnect().await.expect("disconnect B failed");
    println!("done.");
}
