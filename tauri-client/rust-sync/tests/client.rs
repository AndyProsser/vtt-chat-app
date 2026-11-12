//! Drives the real `SyncClient` against a tiny in-process WebSocket server that plays the backend's
//! part of the protocol. This exercises the tokio loop (connect, backoff, reconnect, resume) end to
//! end without a database or the Node backend.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rust_sync::{ConnectInfo, ConnectInfoProvider, ServerEvent, SyncClient, SyncConfig, SyncEvent};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

const WAIT: Duration = Duration::from_secs(10);

fn fast_config() -> SyncConfig {
    SyncConfig {
        idle_timeout: Duration::from_secs(5),
        backoff_base: Duration::from_millis(20),
        backoff_cap: Duration::from_millis(100),
        app_protocol: Some(1),
    }
}

fn provider(url: String) -> ConnectInfoProvider {
    Arc::new(move || {
        let url = url.clone();
        Box::pin(async move {
            Ok(ConnectInfo {
                url,
                session_token: "session.token".to_string(),
            })
        })
    })
}

fn frame(t: &str, d: Value, seq: Option<u64>) -> Message {
    let mut value = json!({ "v": 1, "t": t, "ts": 1, "d": d });
    if let Some(seq) = seq {
        value["seq"] = json!(seq);
    }
    Message::text(value.to_string())
}

/// Reads the next client frame as JSON.
async fn next_json(ws: &mut WebSocketStream<TcpStream>) -> Value {
    loop {
        match timeout(WAIT, ws.next()).await.expect("client went quiet") {
            Some(Ok(Message::Text(text))) => return serde_json::from_str(text.as_str()).unwrap(),
            Some(Ok(_)) => continue,
            other => panic!("socket ended unexpectedly: {other:?}"),
        }
    }
}

async fn expect_event(
    events: &mut mpsc::UnboundedReceiver<SyncEvent>,
    matches: impl Fn(&SyncEvent) -> bool,
) -> SyncEvent {
    loop {
        let event = timeout(WAIT, events.recv())
            .await
            .expect("timed out waiting for an event")
            .expect("event channel closed");
        if matches(&event) {
            return event;
        }
    }
}

async fn listener() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}", listener.local_addr().unwrap());
    (listener, url)
}

async fn accept(listener: &TcpListener) -> WebSocketStream<TcpStream> {
    let (stream, _) = timeout(WAIT, listener.accept())
        .await
        .expect("no connection")
        .unwrap();
    tokio_tungstenite::accept_async(stream).await.unwrap()
}

#[tokio::test]
async fn authenticates_resumes_and_then_resumes_from_the_last_sequence_after_a_drop() {
    let (listener, url) = listener().await;
    let (event_tx, mut events) = mpsc::unbounded_channel();
    let client = SyncClient::start(provider(url), fast_config(), event_tx);
    client.subscribe("camp");

    // --- first connection: auth, resume without a cursor, snapshot, two chat messages ---
    let mut ws = accept(&listener).await;
    let auth = next_json(&mut ws).await;
    assert_eq!(auth["t"], "auth");
    assert_eq!(auth["d"]["token"], "session.token");
    ws.send(frame("auth.ok", json!({ "userId": "u1" }), None))
        .await
        .unwrap();

    let resume = next_json(&mut ws).await;
    assert_eq!(resume["t"], "resume");
    assert_eq!(resume["d"], json!({ "campaignId": "camp" }));

    ws.send(frame(
        "snapshot",
        json!({ "campaignId": "camp", "epoch": "ep1", "seq": 3, "members": [] }),
        None,
    ))
    .await
    .unwrap();
    ws.send(frame(
        "chat.message",
        json!({ "campaignId": "camp", "text": "a" }),
        Some(4),
    ))
    .await
    .unwrap();
    ws.send(frame(
        "chat.message",
        json!({ "campaignId": "camp", "text": "b" }),
        Some(5),
    ))
    .await
    .unwrap();

    expect_event(&mut events, |e| {
        matches!(
            e,
            SyncEvent::Server(ServerEvent::ChatMessage { seq: 5, .. })
        )
    })
    .await;

    // --- the network drops: close without a close frame ---
    drop(ws);
    expect_event(&mut events, |e| matches!(e, SyncEvent::Disconnected)).await;

    // --- second connection: must authenticate again and resume from seq 5 ---
    let mut ws = accept(&listener).await;
    assert_eq!(next_json(&mut ws).await["t"], "auth");
    ws.send(frame("auth.ok", json!({ "userId": "u1" }), None))
        .await
        .unwrap();
    let resume = next_json(&mut ws).await;
    assert_eq!(
        resume["d"],
        json!({ "campaignId": "camp", "lastSeq": 5, "epoch": "ep1" })
    );
    ws.send(frame(
        "resumed",
        json!({ "campaignId": "camp", "epoch": "ep1", "seq": 5, "replayed": 0 }),
        None,
    ))
    .await
    .unwrap();
    expect_event(&mut events, |e| {
        matches!(e, SyncEvent::Server(ServerEvent::Resumed { .. }))
    })
    .await;

    client.stop().await;
}

#[tokio::test]
async fn forwards_live_frames_only_once_authenticated() {
    let (listener, url) = listener().await;
    let (event_tx, mut events) = mpsc::unbounded_channel();
    let client = SyncClient::start(provider(url), fast_config(), event_tx);
    client.subscribe("camp");

    let mut ws = accept(&listener).await;
    assert_eq!(next_json(&mut ws).await["t"], "auth");

    // Sent before auth.ok: must be dropped, not leaked to the server ahead of authentication.
    client.send(rust_sync::speaking_frame("camp", true));
    ws.send(frame("auth.ok", json!({ "userId": "u1" }), None))
        .await
        .unwrap();
    assert_eq!(next_json(&mut ws).await["t"], "resume");
    expect_event(&mut events, |e| matches!(e, SyncEvent::Connected)).await;

    client.send(rust_sync::audio_state_frame("camp", true, false, "online"));
    let forwarded = next_json(&mut ws).await;
    assert_eq!(forwarded["t"], "audio.state");

    client.stop().await;
}

#[tokio::test]
async fn stops_for_good_when_the_session_is_revoked() {
    let (listener, url) = listener().await;
    let accepts = Arc::new(AtomicUsize::new(0));
    let counter = accepts.clone();
    let server = tokio::spawn(async move {
        loop {
            let ws = accept(&listener).await;
            counter.fetch_add(1, Ordering::SeqCst);
            let mut ws = ws;
            let _ = next_json(&mut ws).await;
            ws.send(frame(
                "auth.revoked",
                json!({ "code": "session_invalid" }),
                None,
            ))
            .await
            .unwrap();
            ws.close(Some(CloseFrame {
                code: CloseCode::from(4401),
                reason: "revoked".into(),
            }))
            .await
            .ok();
        }
    });

    let (event_tx, mut events) = mpsc::unbounded_channel();
    let client = SyncClient::start(provider(url), fast_config(), event_tx);
    expect_event(&mut events, |e| matches!(e, SyncEvent::Revoked)).await;

    // Give any (wrong) retry plenty of time to show itself.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(
        accepts.load(Ordering::SeqCst),
        1,
        "must not reconnect after a revocation"
    );

    client.stop().await;
    server.abort();
}

#[tokio::test]
async fn keeps_retrying_with_backoff_while_the_server_is_unreachable() {
    // Reserve a port, then close it so connections are refused.
    let (listener, url) = listener().await;
    let address = listener.local_addr().unwrap();
    drop(listener);

    let (event_tx, mut events) = mpsc::unbounded_channel();
    let client = SyncClient::start(provider(url), fast_config(), event_tx);
    client.subscribe("camp");
    tokio::time::sleep(Duration::from_millis(400)).await;

    // The server comes up; the client should find it without being restarted.
    let listener = TcpListener::bind(address).await.unwrap();
    let mut ws = accept(&listener).await;
    assert_eq!(next_json(&mut ws).await["t"], "auth");
    ws.send(frame("auth.ok", json!({ "userId": "u1" }), None))
        .await
        .unwrap();
    expect_event(&mut events, |e| matches!(e, SyncEvent::Connected)).await;
    // A subscription made while offline is still honoured.
    assert_eq!(
        next_json(&mut ws).await["d"],
        json!({ "campaignId": "camp" })
    );

    client.stop().await;
}

#[tokio::test]
async fn reconnects_when_the_connection_goes_silent() {
    let (listener, url) = listener().await;
    let (event_tx, mut events) = mpsc::unbounded_channel();
    let config = SyncConfig {
        idle_timeout: Duration::from_millis(300),
        ..fast_config()
    };
    let client = SyncClient::start(provider(url), config, event_tx);

    // First connection: authenticate, then say nothing at all (a half-open link).
    let mut first = accept(&listener).await;
    let _ = next_json(&mut first).await;
    first
        .send(frame("auth.ok", json!({ "userId": "u1" }), None))
        .await
        .unwrap();
    expect_event(&mut events, |e| matches!(e, SyncEvent::Connected)).await;

    // The client should give up on it and come back on its own.
    let mut second = accept(&listener).await;
    assert_eq!(next_json(&mut second).await["t"], "auth");

    drop(first);
    client.stop().await;
}

#[tokio::test]
async fn stops_cleanly_on_request_even_while_disconnected() {
    let (listener, url) = listener().await;
    drop(listener); // nothing listening
    let (event_tx, _events) = mpsc::unbounded_channel();
    let client = SyncClient::start(provider(url), fast_config(), event_tx);
    tokio::time::sleep(Duration::from_millis(100)).await;
    timeout(WAIT, client.stop()).await.expect("stop() hung");
}

#[tokio::test]
async fn a_provider_error_is_retried_not_fatal() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = attempts.clone();
    let provider: ConnectInfoProvider = Arc::new(move || {
        let counter = counter.clone();
        Box::pin(async move {
            if counter.fetch_add(1, Ordering::SeqCst) < 2 {
                Err("not signed in yet".to_string())
            } else {
                Ok(ConnectInfo {
                    url: "ws://127.0.0.1:1".to_string(),
                    session_token: "t".into(),
                })
            }
        })
    });
    let (event_tx, _events) = mpsc::unbounded_channel();
    let client = SyncClient::start(provider, fast_config(), event_tx);
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(
        attempts.load(Ordering::SeqCst) >= 3,
        "should have kept asking"
    );
    timeout(WAIT, client.stop()).await.expect("stop() hung");
}

#[tokio::test]
async fn an_update_required_error_stops_for_good_and_announces_the_protocol() {
    let (listener, url) = listener().await;
    let accepts = Arc::new(AtomicUsize::new(0));
    let counter = accepts.clone();
    let server = tokio::spawn(async move {
        loop {
            let mut ws = accept(&listener).await;
            counter.fetch_add(1, Ordering::SeqCst);
            let auth = next_json(&mut ws).await;
            assert_eq!(auth["d"]["protocol"], 1, "the app announces its protocol");
            ws.send(frame(
                "error",
                json!({ "code": "update_required", "message": "update", "serverProtocol": 2 }),
                None,
            ))
            .await
            .unwrap();
            ws.close(Some(CloseFrame {
                code: CloseCode::from(4400),
                reason: "update required".into(),
            }))
            .await
            .ok();
        }
    });

    let (event_tx, mut events) = mpsc::unbounded_channel();
    let client = SyncClient::start(provider(url), fast_config(), event_tx);
    expect_event(&mut events, |e| matches!(e, SyncEvent::IncompatibleServer)).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(accepts.load(Ordering::SeqCst), 1, "must not reconnect");

    client.stop().await;
    server.abort();
}
