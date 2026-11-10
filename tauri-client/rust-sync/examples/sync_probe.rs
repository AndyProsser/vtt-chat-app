//! Connects to a real backend, follows one campaign, optionally says hello, and prints what comes
//! back — a check that the Rust client and the TypeScript backend agree on the protocol.
//!
//!   cargo run -p rust-sync --example sync_probe -- <ws-url> <session-token> <campaign-id> [seconds=5] [say-this]

use std::env;
use std::sync::Arc;
use std::time::Duration;

use rust_sync::{
    audio_state_frame, chat_frame, recording_ack_frame, ConnectInfo, ConnectInfoProvider,
    ServerEvent, SyncClient, SyncConfig, SyncEvent,
};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "usage: sync_probe <ws-url> <session-token> <campaign-id> [seconds=5] [say-this]"
        );
        std::process::exit(2);
    }
    let (url, token, campaign) = (args[1].clone(), args[2].clone(), args[3].clone());
    let seconds: u64 = args.get(4).and_then(|v| v.parse().ok()).unwrap_or(5);
    let say = args.get(5).cloned();

    let provider: ConnectInfoProvider = Arc::new(move || {
        let info = ConnectInfo {
            url: url.clone(),
            session_token: token.clone(),
        };
        Box::pin(async move { Ok(info) })
    });
    let (tx, mut events) = mpsc::unbounded_channel();
    let client = SyncClient::start(provider, SyncConfig::default(), tx);
    client.subscribe(&campaign);

    let deadline = tokio::time::sleep(Duration::from_secs(seconds));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            event = events.recv() => {
                let Some(event) = event else { break };
                match &event {
                    SyncEvent::Connected => {
                        println!("connected");
                        // What a voice client does on every (re)connect: re-announce its state.
                        client.send(audio_state_frame(&campaign, true, false, "online"));
                        if let Some(text) = &say {
                            client.send(chat_frame(&campaign, text));
                        }
                    }
                    SyncEvent::Server(ServerEvent::Snapshot { data, .. }) => {
                        let members = data["members"].as_array().map_or(0, Vec::len);
                        println!("snapshot: seq={} members={members}", data["seq"]);
                    }
                    // The consent loop a real client runs: hear the cue, then acknowledge it.
                    SyncEvent::Server(ServerEvent::RecordingStatus { recording_id, status, .. }) => {
                        println!("recording {status:?} ({recording_id})");
                        if matches!(status, rust_sync::RecordingChange::Started) {
                            client.send(recording_ack_frame(&campaign, recording_id));
                        }
                    }
                    SyncEvent::Server(ServerEvent::RecordingState { recording, .. }) => {
                        println!("recording state: {recording:?}");
                        if let Some(info) = recording {
                            if !info.acknowledged {
                                client.send(recording_ack_frame(&campaign, &info.recording_id));
                            }
                        }
                    }
                    other => println!("{other:?}"),
                }
            }
        }
    }
    client.stop().await;
}
