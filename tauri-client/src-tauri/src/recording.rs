//! The client's half of the recording-consent flow, as a pure state machine.
//!
//! Feed it what the server said (`on_server_event`) and what happened locally (`cue_finished`,
//! `cue_failed`); it returns what to do (`Command`). It never plays a sound, opens a socket or
//! touches the microphone, which keeps every rule below unit-testable. The shell (Stage 4) turns
//! the commands into actions: play the cue through `rust_livekit::cue`, hold the capture gate,
//! send the acknowledgement through `rust_sync`, update the tray icon.
//!
//! The rules (CLAUDE.md §8.4, RECORDING-AND-SUMMARIES.md):
//!
//! - every live change (started, paused, resumed, stopped) plays its own cue;
//! - someone who joins while a recording is running hears the start cue **before** their audio is
//!   captured — the capture gate stays closed until the cue has finished;
//! - a quick reconnect does not replay the cue: the *server* remembers who has heard it (with an
//!   expiry) and says so in `acknowledged`, so there is no local ack file to lose or fake;
//! - a persistent indicator is always correct: recording, paused, or nothing;
//! - if the cue can't be played (no speakers), the gate still opens so the player isn't locked out
//!   of voice, but no acknowledgement is sent, so the DM can see that they haven't heard it.

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime};

use rust_livekit::cue::policy::{decide, Acknowledgement, Cue, RecordingStatus, Source};
use rust_sync::{RecordingChange, RecordingInfo, ServerEvent};

/// What the tray icon and panels show for a campaign. Always derived from server state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Indicator {
    None,
    Recording,
    Paused,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    PlayCue(Cue),
    /// Hold (`true`) or release (`false`) the capture gate. While held, this player's audio must
    /// not be captured, whatever their mute state is.
    GateCapture(bool),
    /// Tell the server this player has heard the start cue for this recording.
    SendAck {
        campaign_id: String,
        recording_id: String,
    },
    SetIndicator {
        campaign_id: String,
        indicator: Indicator,
    },
}

/// A start cue is playing for this recording; capture waits for it to finish.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Pending {
    campaign_id: String,
    recording_id: String,
}

pub struct Coordinator {
    /// Longer than the server's acknowledgement expiry would be pointless: the server decides
    /// expiry and reports the result in `acknowledged`, so the policy is given a generous window
    /// and only ever sees "acknowledged or not".
    ack_window: Duration,
    /// Current recording per campaign, so a stop can clear the right thing.
    recordings: BTreeMap<String, String>,
    pending: Option<Pending>,
}

impl Default for Coordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl Coordinator {
    pub fn new() -> Self {
        Self {
            ack_window: Duration::from_secs(365 * 24 * 3600),
            recordings: BTreeMap::new(),
            pending: None,
        }
    }

    /// Whether this player's audio may be captured right now. The user's own mute state is separate
    /// and independent: audio flows only if both allow it.
    // Not read outside tests yet: the capture gate is not wired to the audio engine.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn capture_allowed(&self) -> bool {
        self.pending.is_none()
    }

    pub fn on_server_event(&mut self, event: &ServerEvent, now: SystemTime) -> Vec<Command> {
        match event {
            ServerEvent::RecordingStatus {
                campaign_id,
                recording_id,
                status,
                ..
            } => self.on_status(campaign_id, recording_id, *status, now),
            ServerEvent::RecordingState {
                campaign_id,
                recording,
            } => self.on_state(campaign_id, recording.as_ref(), now),
            _ => Vec::new(),
        }
    }

    /// The start cue finished playing: the player has heard it, so open the gate and say so.
    pub fn cue_finished(&mut self) -> Vec<Command> {
        match self.pending.take() {
            Some(pending) => vec![
                Command::SendAck {
                    campaign_id: pending.campaign_id,
                    recording_id: pending.recording_id,
                },
                Command::GateCapture(false),
            ],
            None => Vec::new(),
        }
    }

    /// The cue could not be played. Open the gate anyway (don't lock someone out of voice because
    /// their speakers are missing) but send **no** acknowledgement: they have not heard it.
    pub fn cue_failed(&mut self) -> Vec<Command> {
        match self.pending.take() {
            Some(_) => vec![Command::GateCapture(false)],
            None => Vec::new(),
        }
    }

    /// The session ended (signed out or revoked): forget everything and let go of the gate.
    pub fn reset(&mut self) -> Vec<Command> {
        let mut commands: Vec<Command> = self
            .recordings
            .keys()
            .map(|campaign_id| Command::SetIndicator {
                campaign_id: campaign_id.clone(),
                indicator: Indicator::None,
            })
            .collect();
        self.recordings.clear();
        if self.pending.take().is_some() {
            commands.push(Command::GateCapture(false));
        }
        commands
    }

    fn on_status(
        &mut self,
        campaign_id: &str,
        recording_id: &str,
        change: RecordingChange,
        now: SystemTime,
    ) -> Vec<Command> {
        let status = match change {
            RecordingChange::Started => RecordingStatus::Started,
            RecordingChange::Paused => RecordingStatus::Paused,
            RecordingChange::Resumed => RecordingStatus::Resumed,
            RecordingChange::Stopped => RecordingStatus::Stopped,
        };
        let mut commands = Vec::new();

        let indicator = match change {
            RecordingChange::Started | RecordingChange::Resumed => Indicator::Recording,
            RecordingChange::Paused => Indicator::Paused,
            RecordingChange::Stopped => Indicator::None,
        };
        match change {
            RecordingChange::Stopped => {
                self.recordings.remove(campaign_id);
                // A recording that ends before its start cue finished has nothing left to wait for.
                if self
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.campaign_id == campaign_id)
                {
                    self.pending = None;
                    commands.push(Command::GateCapture(false));
                }
            }
            _ => {
                self.recordings
                    .insert(campaign_id.to_string(), recording_id.to_string());
            }
        }
        commands.push(Command::SetIndicator {
            campaign_id: campaign_id.to_string(),
            indicator,
        });

        let decision = decide(
            status,
            Source::Live,
            recording_id,
            None,
            now,
            self.ack_window,
        );
        self.apply(decision, campaign_id, recording_id, &mut commands);
        commands
    }

    fn on_state(
        &mut self,
        campaign_id: &str,
        recording: Option<&RecordingInfo>,
        now: SystemTime,
    ) -> Vec<Command> {
        let mut commands = Vec::new();
        let Some(info) = recording else {
            // Not recording (any more): clear whatever we thought we knew.
            self.recordings.remove(campaign_id);
            if self
                .pending
                .as_ref()
                .is_some_and(|p| p.campaign_id == campaign_id)
            {
                self.pending = None;
                commands.push(Command::GateCapture(false));
            }
            commands.push(Command::SetIndicator {
                campaign_id: campaign_id.to_string(),
                indicator: Indicator::None,
            });
            return commands;
        };

        self.recordings
            .insert(campaign_id.to_string(), info.recording_id.clone());
        commands.push(Command::SetIndicator {
            campaign_id: campaign_id.to_string(),
            indicator: if info.capturing {
                Indicator::Recording
            } else {
                Indicator::Paused
            },
        });

        // The server says whether this person has already heard the cue; hand that to the policy
        // as an acknowledgement made "just now".
        let ack = info.acknowledged.then(|| Acknowledgement {
            recording_id: info.recording_id.clone(),
            at: now,
        });
        let status = if info.capturing {
            RecordingStatus::InProgress
        } else {
            RecordingStatus::Paused
        };
        let decision = decide(
            status,
            Source::Snapshot,
            &info.recording_id,
            ack.as_ref(),
            now,
            self.ack_window,
        );
        self.apply(decision, campaign_id, &info.recording_id, &mut commands);
        commands
    }

    fn apply(
        &mut self,
        decision: rust_livekit::cue::policy::Decision,
        campaign_id: &str,
        recording_id: &str,
        commands: &mut Vec<Command>,
    ) {
        if decision.gate_capture {
            // Close the gate *before* the cue starts, so not a syllable is captured first.
            self.pending = Some(Pending {
                campaign_id: campaign_id.to_string(),
                recording_id: recording_id.to_string(),
            });
            commands.push(Command::GateCapture(true));
        }
        if let Some(cue) = decision.cue {
            commands.push(Command::PlayCue(cue));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000)
    }

    fn status(change: RecordingChange) -> ServerEvent {
        ServerEvent::RecordingStatus {
            campaign_id: "c".into(),
            recording_id: "r1".into(),
            status: change,
            started_at: None,
        }
    }

    fn state(capturing: bool, acknowledged: bool) -> ServerEvent {
        ServerEvent::RecordingState {
            campaign_id: "c".into(),
            recording: Some(RecordingInfo {
                recording_id: "r1".into(),
                capturing,
                acknowledged,
                started_at: None,
                grace_seconds: None,
            }),
        }
    }

    fn indicator(c: &str, i: Indicator) -> Command {
        Command::SetIndicator {
            campaign_id: c.into(),
            indicator: i,
        }
    }

    #[test]
    fn a_live_start_closes_the_gate_then_plays_the_cue_and_shows_the_indicator() {
        let mut c = Coordinator::new();
        let commands = c.on_server_event(&status(RecordingChange::Started), now());
        assert_eq!(
            commands,
            vec![
                indicator("c", Indicator::Recording),
                Command::GateCapture(true),
                Command::PlayCue(Cue::Start),
            ]
        );
        assert!(
            !c.capture_allowed(),
            "nothing is captured until the cue has finished"
        );
    }

    #[test]
    fn the_gate_opens_and_the_ack_is_sent_only_after_the_cue_finishes() {
        let mut c = Coordinator::new();
        c.on_server_event(&status(RecordingChange::Started), now());
        assert_eq!(
            c.cue_finished(),
            vec![
                Command::SendAck {
                    campaign_id: "c".into(),
                    recording_id: "r1".into(),
                },
                Command::GateCapture(false),
            ]
        );
        assert!(c.capture_allowed());
        assert!(c.cue_finished().is_empty(), "finishing twice does nothing");
    }

    #[test]
    fn a_late_joiner_who_has_not_heard_the_cue_hears_it_before_being_captured() {
        let mut c = Coordinator::new();
        let commands = c.on_server_event(&state(true, false), now());
        assert_eq!(
            commands,
            vec![
                indicator("c", Indicator::Recording),
                Command::GateCapture(true),
                Command::PlayCue(Cue::Start),
            ]
        );
        assert!(!c.capture_allowed());
    }

    #[test]
    fn a_quick_reconnect_stays_quiet_because_the_server_says_it_was_acknowledged() {
        let mut c = Coordinator::new();
        let commands = c.on_server_event(&state(true, true), now());
        assert_eq!(commands, vec![indicator("c", Indicator::Recording)]);
        assert!(c.capture_allowed());
    }

    #[test]
    fn pause_resume_and_stop_each_play_their_own_cue_without_gating() {
        let mut c = Coordinator::new();
        assert_eq!(
            c.on_server_event(&status(RecordingChange::Paused), now()),
            vec![
                indicator("c", Indicator::Paused),
                Command::PlayCue(Cue::Pause)
            ]
        );
        assert_eq!(
            c.on_server_event(&status(RecordingChange::Resumed), now()),
            vec![
                indicator("c", Indicator::Recording),
                Command::PlayCue(Cue::Resume)
            ]
        );
        assert_eq!(
            c.on_server_event(&status(RecordingChange::Stopped), now()),
            vec![indicator("c", Indicator::None), Command::PlayCue(Cue::Stop)]
        );
        assert!(c.capture_allowed());
    }

    #[test]
    fn joining_a_paused_recording_shows_the_indicator_and_plays_nothing() {
        let mut c = Coordinator::new();
        let commands = c.on_server_event(&state(false, false), now());
        assert_eq!(commands, vec![indicator("c", Indicator::Paused)]);
        assert!(c.capture_allowed());
    }

    #[test]
    fn no_recording_in_the_state_clears_the_indicator() {
        let mut c = Coordinator::new();
        c.on_server_event(&state(true, true), now());
        let none = ServerEvent::RecordingState {
            campaign_id: "c".into(),
            recording: None,
        };
        assert_eq!(
            c.on_server_event(&none, now()),
            vec![indicator("c", Indicator::None)]
        );
    }

    #[test]
    fn a_recording_that_stops_before_the_cue_finishes_releases_the_gate() {
        let mut c = Coordinator::new();
        c.on_server_event(&status(RecordingChange::Started), now());
        let commands = c.on_server_event(&status(RecordingChange::Stopped), now());
        assert!(commands.contains(&Command::GateCapture(false)));
        assert!(c.capture_allowed());
        assert!(
            c.cue_finished().is_empty(),
            "the cue that was playing must not acknowledge a recording that has ended"
        );
    }

    #[test]
    fn a_cue_that_cannot_play_opens_the_gate_but_does_not_acknowledge() {
        let mut c = Coordinator::new();
        c.on_server_event(&status(RecordingChange::Started), now());
        assert_eq!(c.cue_failed(), vec![Command::GateCapture(false)]);
        assert!(c.capture_allowed());
    }

    #[test]
    fn a_stop_for_another_campaign_does_not_release_this_ones_gate() {
        let mut c = Coordinator::new();
        c.on_server_event(&status(RecordingChange::Started), now());
        let other = ServerEvent::RecordingStatus {
            campaign_id: "other".into(),
            recording_id: "r9".into(),
            status: RecordingChange::Stopped,
            started_at: None,
        };
        c.on_server_event(&other, now());
        assert!(!c.capture_allowed());
    }

    #[test]
    fn signing_out_clears_indicators_and_releases_the_gate() {
        let mut c = Coordinator::new();
        c.on_server_event(&status(RecordingChange::Started), now());
        let commands = c.reset();
        assert!(commands.contains(&indicator("c", Indicator::None)));
        assert!(commands.contains(&Command::GateCapture(false)));
        assert!(c.capture_allowed());
    }

    #[test]
    fn unrelated_server_events_do_nothing() {
        let mut c = Coordinator::new();
        let chat = ServerEvent::RosterChanged {
            campaign_id: "c".into(),
        };
        assert!(c.on_server_event(&chat, now()).is_empty());
    }
}
