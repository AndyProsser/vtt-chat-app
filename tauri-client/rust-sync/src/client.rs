use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::Message;

use crate::backoff::Backoff;
use crate::session::{Action, Session, SyncEvent};

/// Where to connect and which session to authenticate with. Asked for on every (re)connect, so a
/// session token or server address that changed in the meantime is picked up.
#[derive(Debug, Clone)]
pub struct ConnectInfo {
    /// `ws://` or `wss://` URL of the backend's `/ws`.
    pub url: String,
    pub session_token: String,
}

pub type ConnectInfoFuture = Pin<Box<dyn Future<Output = Result<ConnectInfo, String>> + Send>>;
pub type ConnectInfoProvider = Arc<dyn Fn() -> ConnectInfoFuture + Send + Sync>;

#[derive(Debug, Clone)]
pub struct SyncConfig {
    /// Reconnect if nothing at all (not even a server ping) arrives for this long. The server pings
    /// every 30 s, so 90 s means three missed pings: a half-open connection after sleep or a NAT drop.
    pub idle_timeout: Duration,
    pub backoff_base: Duration,
    pub backoff_cap: Duration,
    /// The app's wire-protocol integer, announced in the `auth` frame. `None` announces nothing.
    pub app_protocol: Option<u32>,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            idle_timeout: Duration::from_secs(90),
            backoff_base: Duration::from_secs(1),
            backoff_cap: Duration::from_secs(30),
            app_protocol: None,
        }
    }
}

enum Command {
    Subscribe(String),
    Unsubscribe(String),
    Send(String),
    Stop,
}

/// The app's single WebSocket to the backend: connects, authenticates, follows campaigns, resumes
/// from the last sequence number after any drop, and stops for good when the session is revoked.
///
/// Rust owns this connection (not the webview), so it keeps working with every panel closed and
/// the hidden-by-default rule holds: no panel, no timers, one idle socket.
pub struct SyncClient {
    commands: mpsc::UnboundedSender<Command>,
    task: JoinHandle<()>,
}

impl SyncClient {
    /// Starts the connection loop in the background. Events arrive on `events`.
    pub fn start(
        provider: ConnectInfoProvider,
        config: SyncConfig,
        events: mpsc::UnboundedSender<SyncEvent>,
    ) -> Self {
        let (commands, command_rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(run(provider, config, events, command_rx));
        Self { commands, task }
    }

    /// Follow a campaign's live stream.
    pub fn subscribe(&self, campaign_id: &str) {
        let _ = self
            .commands
            .send(Command::Subscribe(campaign_id.to_string()));
    }

    pub fn unsubscribe(&self, campaign_id: &str) {
        let _ = self
            .commands
            .send(Command::Unsubscribe(campaign_id.to_string()));
    }

    /// Sends a client frame (build it with `protocol::*_frame`). Frames sent while disconnected are
    /// dropped on purpose: they are live state (speaking, stats, mute), and the app re-announces
    /// its current state when it sees `SyncEvent::Connected`.
    pub fn send(&self, frame: String) {
        let _ = self.commands.send(Command::Send(frame));
    }

    /// Closes the socket and ends the loop.
    pub async fn stop(self) {
        let _ = self.commands.send(Command::Stop);
        let _ = self.task.await;
    }
}

enum Outcome {
    /// Reconnect after the backoff.
    Retry,
    Stop,
}

async fn run(
    provider: ConnectInfoProvider,
    config: SyncConfig,
    events: mpsc::UnboundedSender<SyncEvent>,
    mut commands: mpsc::UnboundedReceiver<Command>,
) {
    let mut backoff = Backoff::new(config.backoff_base, config.backoff_cap);
    // The session outlives individual sockets: it is what remembers the last sequence numbers.
    let mut session: Option<Session> = None;
    let mut subscriptions: Vec<String> = Vec::new();

    loop {
        let outcome = match provider().await {
            Ok(info) => {
                let session =
                    session.get_or_insert_with(|| {
                    Session::new(info.session_token.clone()).with_app_protocol(config.app_protocol)
                });
                // Re-assert the subscriptions made while we were disconnected.
                for campaign in &subscriptions {
                    session.subscribe(campaign);
                }
                connect_once(
                    &info,
                    &config,
                    session,
                    &events,
                    &mut commands,
                    &mut subscriptions,
                    &mut backoff,
                )
                .await
            }
            Err(message) => {
                eprintln!("[rust-sync] could not get connection details: {message}");
                // Nothing to connect with yet; wait and ask again.
                match wait(
                    &mut commands,
                    backoff.next_delay(jitter()),
                    &mut subscriptions,
                )
                .await
                {
                    true => Outcome::Retry,
                    false => Outcome::Stop,
                }
            }
        };

        match outcome {
            Outcome::Stop => return,
            Outcome::Retry => {
                if !wait(
                    &mut commands,
                    backoff.next_delay(jitter()),
                    &mut subscriptions,
                )
                .await
                {
                    return;
                }
            }
        }
    }
}

/// Sleeps for `delay`, still honouring commands. Returns `false` if told to stop.
async fn wait(
    commands: &mut mpsc::UnboundedReceiver<Command>,
    delay: Duration,
    subscriptions: &mut Vec<String>,
) -> bool {
    let sleep = tokio::time::sleep(delay);
    tokio::pin!(sleep);
    loop {
        tokio::select! {
            _ = &mut sleep => return true,
            command = commands.recv() => match command {
                None | Some(Command::Stop) => return false,
                Some(Command::Subscribe(id)) => remember(subscriptions, id),
                Some(Command::Unsubscribe(id)) => subscriptions.retain(|c| *c != id),
                // Live frames while disconnected are dropped (see `SyncClient::send`).
                Some(Command::Send(_)) => {}
            },
        }
    }
}

fn remember(subscriptions: &mut Vec<String>, id: String) {
    if !subscriptions.contains(&id) {
        subscriptions.push(id);
    }
}

async fn connect_once(
    info: &ConnectInfo,
    config: &SyncConfig,
    session: &mut Session,
    events: &mpsc::UnboundedSender<SyncEvent>,
    commands: &mut mpsc::UnboundedReceiver<Command>,
    subscriptions: &mut Vec<String>,
    backoff: &mut Backoff,
) -> Outcome {
    let mut socket = match tokio_tungstenite::connect_async(info.url.as_str()).await {
        Ok((socket, _response)) => socket,
        Err(err) => {
            eprintln!("[rust-sync] connect failed: {err}");
            return Outcome::Retry;
        }
    };

    // Run the opening actions (send `auth`).
    let opening = session.on_open();
    if !execute(opening, &mut socket, events).await.is_continue() {
        return Outcome::Retry;
    }

    let mut was_authenticated = false;
    loop {
        let incoming = tokio::time::timeout(config.idle_timeout, socket.next());
        let actions = tokio::select! {
            message = incoming => match message {
                // Nothing for too long: assume the link is dead.
                Err(_) => session.on_close(None),
                Ok(None) | Ok(Some(Err(_))) => session.on_close(None),
                Ok(Some(Ok(Message::Text(text)))) => session.on_text(text.as_str()),
                Ok(Some(Ok(Message::Close(frame)))) => {
                    session.on_close(frame.map(|f| u16::from(f.code)))
                }
                // Pings are answered by the library; pongs and binary frames carry nothing for us.
                // Receiving *anything* above already reset the idle timer.
                Ok(Some(Ok(_))) => Vec::new(),
            },
            command = commands.recv() => match command {
                None | Some(Command::Stop) => {
                    let _ = socket.close(None).await;
                    let _ = events.send(SyncEvent::Disconnected);
                    return Outcome::Stop;
                }
                Some(Command::Subscribe(id)) => {
                    remember(subscriptions, id.clone());
                    session.subscribe(&id)
                }
                Some(Command::Unsubscribe(id)) => {
                    subscriptions.retain(|c| *c != id);
                    session.unsubscribe(&id);
                    Vec::new()
                }
                Some(Command::Send(frame)) => {
                    if session.is_authenticated() { vec![Action::Send(frame)] } else { Vec::new() }
                }
            },
        };

        if session.is_authenticated() && !was_authenticated {
            // A completed handshake is what proves the server is reachable and wants us.
            was_authenticated = true;
            backoff.reset();
        }

        match execute(actions, &mut socket, events).await {
            Flow::Continue => {}
            Flow::Reconnect => {
                let _ = socket.close(None).await;
                return Outcome::Retry;
            }
            Flow::Stop => {
                let _ = socket.close(Some(close_frame())).await;
                return Outcome::Stop;
            }
        }
    }
}

fn close_frame() -> tokio_tungstenite::tungstenite::protocol::CloseFrame {
    tokio_tungstenite::tungstenite::protocol::CloseFrame {
        code: CloseCode::Normal,
        reason: "".into(),
    }
}

enum Flow {
    Continue,
    Reconnect,
    Stop,
}

impl Flow {
    fn is_continue(&self) -> bool {
        matches!(self, Flow::Continue)
    }
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn execute(
    actions: Vec<Action>,
    socket: &mut Socket,
    events: &mpsc::UnboundedSender<SyncEvent>,
) -> Flow {
    for action in actions {
        match action {
            Action::Send(text) => {
                if socket.send(Message::text(text)).await.is_err() {
                    return Flow::Reconnect;
                }
            }
            Action::Emit(event) => {
                let _ = events.send(event);
            }
            Action::Reconnect => return Flow::Reconnect,
            Action::Stop => return Flow::Stop,
        }
    }
    Flow::Continue
}

/// Cheap jitter in `0.0..1.0` without a `rand` dependency; it only has to decorrelate clients.
fn jitter() -> f64 {
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    f64::from(nanos % 1000) / 1000.0
}
