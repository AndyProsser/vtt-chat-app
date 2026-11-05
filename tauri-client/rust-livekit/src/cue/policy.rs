//! When should this client play a recording cue? Pure decision logic, no audio.
//!
//! The rules come from RECORDING-AND-SUMMARIES.md ("Consent cue"):
//!
//! - Every **live** status change plays its cue (started, paused, resumed, stopped).
//! - A client that **joins** while a recording is in progress hears the start cue **before its
//!   own audio is captured** (`gate_capture`).
//! - A client that merely **reconnects** after a network blip does not hear it again, as long as
//!   it acknowledged that same recording recently (the acknowledgement expires).
//! - Recording state is server truth: a snapshot only ever tells us the *current* status; it must
//!   not replay the transitions we missed.

use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingStatus {
    Started,
    InProgress,
    Paused,
    Resumed,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cue {
    Start,
    Pause,
    Resume,
    Stop,
}

/// Where the status came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// A transition that just happened while we were connected.
    Live,
    /// The current state delivered on (re)connect.
    Snapshot,
}

/// "This client has already heard the start cue for this recording."
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Acknowledgement {
    pub recording_id: String,
    pub at: SystemTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub cue: Option<Cue>,
    /// Do not capture this client's audio until the cue has finished playing.
    pub gate_capture: bool,
    /// The start cue was (or will be) played for this recording; remember it.
    pub acknowledge: bool,
}

const NOTHING: Decision = Decision {
    cue: None,
    gate_capture: false,
    acknowledge: false,
};

pub fn decide(
    status: RecordingStatus,
    source: Source,
    recording_id: &str,
    acknowledgement: Option<&Acknowledgement>,
    now: SystemTime,
    ack_ttl: Duration,
) -> Decision {
    let acknowledged = acknowledgement.is_some_and(|ack| {
        ack.recording_id == recording_id
            && now
                .duration_since(ack.at)
                .map(|age| age <= ack_ttl)
                .unwrap_or(true)
    });

    match (source, status) {
        (Source::Live, RecordingStatus::Started) => Decision {
            cue: Some(Cue::Start),
            gate_capture: true,
            acknowledge: true,
        },
        (Source::Live, RecordingStatus::Paused) => cue_only(Cue::Pause),
        (Source::Live, RecordingStatus::Resumed) => cue_only(Cue::Resume),
        (Source::Live, RecordingStatus::Stopped) => cue_only(Cue::Stop),

        // Joining (or rejoining) while a recording is running or resumed. Pausing and stopped
        // snapshots show the indicator only: nothing is being captured, so there is nothing to
        // consent to yet — the live `Resumed` event will carry the cue when recording restarts.
        (
            Source::Snapshot,
            RecordingStatus::Started | RecordingStatus::InProgress | RecordingStatus::Resumed,
        ) if !acknowledged => Decision {
            cue: Some(Cue::Start),
            gate_capture: true,
            acknowledge: true,
        },

        // Live `InProgress` is a status echo, not a transition; snapshots we've acknowledged,
        // and paused/stopped snapshots, play nothing.
        _ => NOTHING,
    }
}

fn cue_only(cue: Cue) -> Decision {
    Decision {
        cue: Some(cue),
        gate_capture: false,
        acknowledge: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TTL: Duration = Duration::from_secs(30 * 60);

    fn at(secs: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn ack(id: &str, secs: u64) -> Acknowledgement {
        Acknowledgement {
            recording_id: id.to_string(),
            at: at(secs),
        }
    }

    #[test]
    fn live_start_plays_the_cue_and_gates_capture() {
        let d = decide(
            RecordingStatus::Started,
            Source::Live,
            "r1",
            None,
            at(100),
            TTL,
        );
        assert_eq!(d.cue, Some(Cue::Start));
        assert!(d.gate_capture && d.acknowledge);
    }

    #[test]
    fn live_pause_resume_stop_each_play_their_own_cue_without_gating() {
        for (status, cue) in [
            (RecordingStatus::Paused, Cue::Pause),
            (RecordingStatus::Resumed, Cue::Resume),
            (RecordingStatus::Stopped, Cue::Stop),
        ] {
            let d = decide(status, Source::Live, "r1", None, at(1), TTL);
            assert_eq!(d.cue, Some(cue));
            assert!(!d.gate_capture && !d.acknowledge);
        }
    }

    #[test]
    fn a_late_joiner_hears_the_start_cue_before_capture() {
        let d = decide(
            RecordingStatus::InProgress,
            Source::Snapshot,
            "r1",
            None,
            at(5_000),
            TTL,
        );
        assert_eq!(d.cue, Some(Cue::Start));
        assert!(d.gate_capture && d.acknowledge);
    }

    #[test]
    fn a_quick_reconnect_does_not_replay_the_cue() {
        let a = ack("r1", 1_000);
        let d = decide(
            RecordingStatus::InProgress,
            Source::Snapshot,
            "r1",
            Some(&a),
            at(1_060),
            TTL,
        );
        assert_eq!(d, NOTHING);
    }

    #[test]
    fn an_expired_acknowledgement_replays_the_cue() {
        let a = ack("r1", 1_000);
        let d = decide(
            RecordingStatus::InProgress,
            Source::Snapshot,
            "r1",
            Some(&a),
            at(1_000 + 31 * 60),
            TTL,
        );
        assert_eq!(d.cue, Some(Cue::Start));
    }

    #[test]
    fn an_acknowledgement_for_a_different_recording_does_not_count() {
        let a = ack("old", 1_000);
        let d = decide(
            RecordingStatus::InProgress,
            Source::Snapshot,
            "new",
            Some(&a),
            at(1_010),
            TTL,
        );
        assert_eq!(d.cue, Some(Cue::Start));
    }

    #[test]
    fn snapshots_never_replay_missed_transitions() {
        for status in [RecordingStatus::Paused, RecordingStatus::Stopped] {
            assert_eq!(
                decide(status, Source::Snapshot, "r1", None, at(1), TTL),
                NOTHING
            );
        }
    }

    #[test]
    fn joining_a_resumed_recording_counts_as_joining_a_running_one() {
        let d = decide(
            RecordingStatus::Resumed,
            Source::Snapshot,
            "r1",
            None,
            at(1),
            TTL,
        );
        assert_eq!(d.cue, Some(Cue::Start));
    }

    #[test]
    fn a_live_in_progress_echo_is_not_a_transition() {
        assert_eq!(
            decide(
                RecordingStatus::InProgress,
                Source::Live,
                "r1",
                None,
                at(1),
                TTL
            ),
            NOTHING
        );
    }

    #[test]
    fn a_clock_that_went_backwards_keeps_the_acknowledgement_valid() {
        let a = ack("r1", 2_000);
        let d = decide(
            RecordingStatus::InProgress,
            Source::Snapshot,
            "r1",
            Some(&a),
            at(1_000),
            TTL,
        );
        assert_eq!(d, NOTHING);
    }
}
