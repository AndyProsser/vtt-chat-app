//! Turns what the server says into what the app does: plays the consent cue, holds the capture
//! gate, acknowledges, and keeps the indicator true. Generic over a [`Platform`] so every rule is
//! tested without a window, a speaker or a socket; `session.rs` supplies the real one.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use crate::status::Status;
use rust_livekit::cue::policy::Cue;
use rust_sync::{audio_state_frame, recording_ack_frame, SyncEvent};

use crate::recording::{Command, Coordinator, Indicator};

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// Why the app stopped following the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignedOut {
    /// The session was revoked or expired: send the player back to sign in.
    Revoked,
    /// The server needs a newer app; retrying cannot help.
    IncompatibleServer,
}

/// The side effects the shell needs. All fire-and-forget except the cue, which reports whether it
/// was actually heard.
pub trait Platform: Send + Sync + 'static {
    /// Plays a cue locally and resolves when it has finished. `false` means it could not be
    /// played (no speakers): the gate opens anyway but nothing is acknowledged.
    fn play_cue(&self, cue: Cue) -> BoxFuture<bool>;
    fn send_frame(&self, frame: String);
    /// Hold (`true`) or release the capture gate.
    fn set_capture_gate(&self, held: bool);
    fn set_indicator(&self, campaign_id: &str, indicator: Indicator);
    fn connection_changed(&self, connected: bool);
    fn signed_out(&self, reason: SignedOut);
}

pub struct Shell<P: Platform> {
    coordinator: Coordinator,
    platform: Arc<P>,
    campaign_id: String,
    /// What to re-announce to the server on every (re)connect: (in voice, muted). Shared so the
    /// mute button and hotkeys can update it without waiting for a cue to finish playing.
    voice: Arc<Mutex<(bool, bool, Status)>>,
}

impl<P: Platform> Shell<P> {
    pub fn new(platform: Arc<P>, campaign_id: impl Into<String>) -> Self {
        Self {
            coordinator: Coordinator::new(),
            platform,
            campaign_id: campaign_id.into(),
            voice: Arc::new(Mutex::new((false, true, Status::Offline))),
        }
    }

    pub fn voice_handle(&self) -> Arc<Mutex<(bool, bool, Status)>> {
        Arc::clone(&self.voice)
    }

    #[cfg(test)]
    pub fn capture_allowed(&self) -> bool {
        self.coordinator.capture_allowed()
    }

    pub async fn handle(&mut self, event: SyncEvent, now: SystemTime) {
        match event {
            SyncEvent::Connected => {
                self.platform.connection_changed(true);
                // The server forgets this on reconnect, so say it again.
                let (in_voice, muted, status) = *self.voice.lock().unwrap();
                self.platform.send_frame(audio_state_frame(
                    &self.campaign_id,
                    in_voice,
                    muted,
                    status.as_str(),
                ));
            }
            SyncEvent::Disconnected => self.platform.connection_changed(false),
            SyncEvent::Revoked => self.sign_out(SignedOut::Revoked).await,
            SyncEvent::IncompatibleServer => self.sign_out(SignedOut::IncompatibleServer).await,
            SyncEvent::Server(server_event) => {
                let commands = self.coordinator.on_server_event(&server_event, now);
                self.execute(commands).await;
            }
        }
    }

    async fn sign_out(&mut self, reason: SignedOut) {
        let commands = self.coordinator.reset();
        self.execute(commands).await;
        self.platform.connection_changed(false);
        self.platform.signed_out(reason);
    }

    /// Runs commands in two phases so the consent rules hold: first everything that is not a cue
    /// (the capture gate **closes before** a start cue plays, the indicator is correct before any
    /// sound), then the cues, one at a time, each feeding its outcome back to the coordinator.
    async fn execute(&mut self, commands: Vec<Command>) {
        let mut queue = commands;
        while !queue.is_empty() {
            let mut cues = Vec::new();
            for command in queue.drain(..) {
                match command {
                    Command::PlayCue(cue) => cues.push(cue),
                    Command::GateCapture(held) => self.platform.set_capture_gate(held),
                    Command::SendAck {
                        campaign_id,
                        recording_id,
                    } => self
                        .platform
                        .send_frame(recording_ack_frame(&campaign_id, &recording_id)),
                    Command::SetIndicator {
                        campaign_id,
                        indicator,
                    } => self.platform.set_indicator(&campaign_id, indicator),
                }
            }
            for cue in cues {
                let heard = self.platform.play_cue(cue).await;
                // Only a pending start cue produces follow-up commands (ack + open the gate);
                // for a stop or pause cue these return nothing.
                queue.extend(if heard {
                    self.coordinator.cue_finished()
                } else {
                    self.coordinator.cue_failed()
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::time::Duration;

    use rust_sync::{RecordingChange, RecordingInfo, ServerEvent};

    use super::*;

    /// Records every side effect in order, so a test can assert *when* things happened.
    #[derive(Default)]
    struct Fake {
        log: Mutex<Vec<String>>,
        cue_heard: Mutex<bool>,
        /// Live test only: frames the shell sends, to be forwarded to the real socket.
        outbox: Mutex<Option<tokio::sync::mpsc::UnboundedSender<String>>>,
    }

    impl Fake {
        fn heard() -> Arc<Self> {
            Arc::new(Self {
                cue_heard: Mutex::new(true),
                ..Self::default()
            })
        }
        fn push(&self, line: impl Into<String>) {
            self.log.lock().unwrap().push(line.into());
        }
        fn log(&self) -> Vec<String> {
            self.log.lock().unwrap().clone()
        }
        fn position(&self, needle: &str) -> Option<usize> {
            self.log().iter().position(|l| l.contains(needle))
        }
    }

    impl Platform for Fake {
        fn play_cue(&self, cue: Cue) -> BoxFuture<bool> {
            self.push(format!("cue:{cue:?}"));
            let heard = *self.cue_heard.lock().unwrap();
            Box::pin(async move { heard })
        }
        fn send_frame(&self, frame: String) {
            self.push(format!("frame:{frame}"));
            if let Some(outbox) = self.outbox.lock().unwrap().as_ref() {
                let _ = outbox.send(frame);
            }
        }
        fn set_capture_gate(&self, held: bool) {
            self.push(format!("gate:{held}"));
        }
        fn set_indicator(&self, _campaign_id: &str, indicator: Indicator) {
            self.push(format!("indicator:{indicator:?}"));
        }
        fn connection_changed(&self, connected: bool) {
            self.push(format!("connected:{connected}"));
        }
        fn signed_out(&self, reason: SignedOut) {
            self.push(format!("signed_out:{reason:?}"));
        }
    }

    fn now() -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000)
    }

    fn status(change: RecordingChange) -> SyncEvent {
        SyncEvent::Server(ServerEvent::RecordingStatus {
            campaign_id: "c".into(),
            recording_id: "r1".into(),
            status: change,
            started_at: None,
        })
    }

    fn state(capturing: bool, acknowledged: bool) -> SyncEvent {
        SyncEvent::Server(ServerEvent::RecordingState {
            campaign_id: "c".into(),
            recording: Some(RecordingInfo {
                recording_id: "r1".into(),
                capturing,
                acknowledged,
                started_at: None,
                grace_seconds: None,
            }),
        })
    }

    #[tokio::test]
    async fn a_live_start_closes_the_gate_before_the_cue_and_acknowledges_after_it() {
        let fake = Fake::heard();
        let mut shell = Shell::new(fake.clone(), "c");
        shell.handle(status(RecordingChange::Started), now()).await;

        let gate_closed = fake.position("gate:true").expect("gate closed");
        let cue = fake.position("cue:Start").expect("start cue played");
        let ack = fake.position("recording.ack").expect("acknowledged");
        let gate_open = fake.position("gate:false").expect("gate reopened");
        assert!(
            gate_closed < cue,
            "nothing may be captured before the cue: {:?}",
            fake.log()
        );
        assert!(cue < ack, "acknowledge only after hearing it");
        assert!(ack < gate_open || gate_open > cue);
        assert!(fake.log().contains(&"indicator:Recording".to_string()));
        assert!(shell.capture_allowed());
    }

    #[tokio::test]
    async fn a_late_joiner_who_has_not_heard_the_cue_hears_it_before_being_captured() {
        let fake = Fake::heard();
        let mut shell = Shell::new(fake.clone(), "c");
        shell.handle(state(true, false), now()).await;
        assert!(fake.position("gate:true").unwrap() < fake.position("cue:Start").unwrap());
        assert!(fake.position("recording.ack").is_some());
    }

    #[tokio::test]
    async fn a_quick_reconnect_does_not_replay_the_cue() {
        let fake = Fake::heard();
        let mut shell = Shell::new(fake.clone(), "c");
        shell.handle(state(true, true), now()).await;
        let log = fake.log();
        assert!(!log.iter().any(|l| l.starts_with("cue:")), "{log:?}");
        assert!(!log.iter().any(|l| l.contains("recording.ack")));
        assert!(!log.iter().any(|l| l == "gate:true"));
        assert!(log.contains(&"indicator:Recording".to_string()));
    }

    #[tokio::test]
    async fn if_the_cue_cannot_play_the_gate_opens_but_nothing_is_acknowledged() {
        let fake = Arc::new(Fake::default()); // cue_heard = false
        let mut shell = Shell::new(fake.clone(), "c");
        shell.handle(status(RecordingChange::Started), now()).await;
        let log = fake.log();
        assert!(
            log.contains(&"gate:false".to_string()),
            "never lock someone out of voice"
        );
        assert!(
            !log.iter().any(|l| l.contains("recording.ack")),
            "they did not hear it: {log:?}"
        );
        assert!(shell.capture_allowed());
    }

    #[tokio::test]
    async fn a_stop_plays_its_own_cue_and_clears_the_indicator() {
        let fake = Fake::heard();
        let mut shell = Shell::new(fake.clone(), "c");
        shell.handle(status(RecordingChange::Started), now()).await;
        shell.handle(status(RecordingChange::Stopped), now()).await;
        assert!(fake.position("cue:Stop").is_some());
        assert_eq!(fake.log().last().map(String::as_str), Some("cue:Stop"));
        assert!(fake.log().contains(&"indicator:None".to_string()));
    }

    #[tokio::test]
    async fn every_connect_reannounces_the_voice_state() {
        let fake = Fake::heard();
        let mut shell = Shell::new(fake.clone(), "c");
        *shell.voice_handle().lock().unwrap() = (true, false, Status::Away);
        fake.log.lock().unwrap().clear();
        shell.handle(SyncEvent::Connected, now()).await;
        let log = fake.log();
        assert_eq!(log[0], "connected:true");
        assert!(
            log[1].starts_with("frame:") && log[1].contains("audio"),
            "{log:?}"
        );
        assert!(log[1].contains("false"), "carries the muted flag");
    }

    #[tokio::test]
    async fn losing_the_connection_is_reported_without_touching_a_running_recording() {
        let fake = Fake::heard();
        let mut shell = Shell::new(fake.clone(), "c");
        shell.handle(status(RecordingChange::Started), now()).await;
        fake.log.lock().unwrap().clear();
        shell.handle(SyncEvent::Disconnected, now()).await;
        assert_eq!(fake.log(), vec!["connected:false".to_string()]);
    }

    #[tokio::test]
    async fn a_revoked_session_releases_the_gate_clears_the_indicator_and_signs_out() {
        let fake = Arc::new(Fake::default());
        // A cue that never finishes would hold the gate; model "gate held" by revoking mid-state.
        let mut shell = Shell::new(fake.clone(), "c");
        shell.handle(state(true, true), now()).await; // recording known, already acknowledged
        fake.log.lock().unwrap().clear();
        shell.handle(SyncEvent::Revoked, now()).await;
        let log = fake.log();
        assert!(log.contains(&"indicator:None".to_string()), "{log:?}");
        assert!(log.contains(&"connected:false".to_string()));
        assert_eq!(log.last().map(String::as_str), Some("signed_out:Revoked"));
        assert!(shell.capture_allowed());
    }

    #[tokio::test]
    async fn an_incompatible_server_signs_out_with_its_own_reason() {
        let fake = Fake::heard();
        let mut shell = Shell::new(fake.clone(), "c");
        shell.handle(SyncEvent::IncompatibleServer, now()).await;
        assert_eq!(
            fake.log().last().map(String::as_str),
            Some("signed_out:IncompatibleServer")
        );
    }

    /// Live check against a real backend, run by `scripts/consent-live.sh` (ignored otherwise):
    /// the real `rust-sync` client + this `Shell` + a fake platform. Prints markers the script waits on.
    #[tokio::test]
    #[ignore = "needs a running backend; see tauri-client/scripts/consent-live.sh"]
    async fn live_consent_flow_against_a_real_backend() {
        use std::time::Duration;

        use rust_sync::{ConnectInfo, ConnectInfoProvider, SyncClient, SyncConfig};
        use tokio::sync::mpsc;
        use tokio::time::timeout;

        struct Live {
            fake: Arc<Fake>,
            client: SyncClient,
            frames: mpsc::UnboundedReceiver<String>,
            events: mpsc::UnboundedReceiver<SyncEvent>,
            shell: Shell<Fake>,
        }

        impl Live {
            async fn start(ws: &str, token: &str, campaign: &str) -> Self {
                let (url, token) = (ws.to_string(), token.to_string());
                let provider: ConnectInfoProvider = Arc::new(move || {
                    let info = ConnectInfo {
                        url: url.clone(),
                        session_token: token.clone(),
                    };
                    Box::pin(async move { Ok(info) })
                });
                let (tx, events) = mpsc::unbounded_channel();
                let client = SyncClient::start(provider, SyncConfig::default(), tx);
                client.subscribe(campaign);
                let fake = Fake::heard();
                // The shell's outgoing frames (the ack!) must reach the real socket, or the
                // server never hears them.
                let (outbox, frames) = mpsc::unbounded_channel();
                *fake.outbox.lock().unwrap() = Some(outbox);
                let shell = Shell::new(fake.clone(), campaign);
                Self {
                    fake,
                    client,
                    frames,
                    events,
                    shell,
                }
            }

            async fn pump_until(&mut self, done: impl Fn(&Fake) -> bool) {
                timeout(Duration::from_secs(30), async {
                    while !done(&self.fake) {
                        let event = self.events.recv().await.expect("sync client ended");
                        self.shell.handle(event, SystemTime::now()).await;
                        while let Ok(frame) = self.frames.try_recv() {
                            self.client.send(frame);
                        }
                    }
                })
                .await
                .expect("timed out waiting for the expected effect");
            }
        }

        let api = std::env::var("VTT_LIVE_API").expect("VTT_LIVE_API");
        let token = std::env::var("VTT_LIVE_TOKEN").expect("VTT_LIVE_TOKEN");
        let campaign = std::env::var("VTT_LIVE_CAMPAIGN").expect("VTT_LIVE_CAMPAIGN");
        let ws = crate::session::websocket_url(&api).unwrap();

        // 1. Connect and learn there is no recording yet.
        let mut a = Live::start(&ws, &token, &campaign).await;
        a.pump_until(|f| f.position("indicator:None").is_some())
            .await;
        println!("READY");

        // 2. The DM starts a recording (the script does it): gate, cue, acknowledgement, in order.
        a.pump_until(|f| f.position("recording.ack").is_some())
            .await;
        let gate = a.fake.position("gate:true").expect("gate closed");
        let cue = a.fake.position("cue:Start").expect("start cue");
        let ack = a.fake.position("recording.ack").unwrap();
        assert!(gate < cue && cue < ack, "order was {:?}", a.fake.log());
        // Let the queued ack frame reach the server before a second client asks.
        a.pump_until(|f| f.position("gate:false").is_some()).await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        println!("ACKED");

        // 3. A fresh app start (new client, no memory) is told by the SERVER that it already heard
        //    the cue, so it shows the indicator but plays nothing and holds nothing.
        let mut b = Live::start(&ws, &token, &campaign).await;
        b.pump_until(|f| f.position("indicator:Recording").is_some())
            .await;
        assert!(
            b.fake.position("cue:").is_none(),
            "replayed the cue: {:?}",
            b.fake.log()
        );
        assert!(b.fake.position("gate:true").is_none());
        println!("RECONNECT-OK");
        b.client.stop().await;

        // 4. The DM stops the recording: the stop cue plays and the indicator clears.
        a.pump_until(|f| f.position("cue:Stop").is_some()).await;
        assert!(a.fake.log().contains(&"indicator:None".to_string()));
        println!("STOPPED-OK");
        a.client.stop().await;
    }
}
