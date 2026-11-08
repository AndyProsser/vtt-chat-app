//! Rust → panel event feed. A panel is a cache of Rust's state (STATE-AND-RESILIENCE.md): it is
//! created when opened and destroyed when closed, so on open it asks for a **hydrate** — the latest
//! snapshot plus the bounded tail of events since — and then follows live `sync:event`s.
//!
//! The tail is bounded (so a long session cannot grow memory) and holds only events a panel needs
//! to rebuild itself; high-rate, only-the-present-matters frames (who is speaking, link stats) are
//! forwarded live but never retained.

use std::collections::VecDeque;
use std::sync::Mutex;

use rust_sync::{RecordingChange, ServerEvent};
use serde_json::{json, Value};

pub const SYNC_EVENT: &str = "sync:event";
const TAIL_LIMIT: usize = 500;

/// One forwarded event: `{ "t": frame type, "d": payload, "seq"?: number }`.
fn event(t: &str, d: Value) -> Value {
    json!({ "t": t, "d": d })
}

/// What a panel should see for a server event, and whether it is worth retaining.
pub fn panel_event(server_event: &ServerEvent) -> Option<(Value, bool)> {
    Some(match server_event {
        ServerEvent::Snapshot { data, .. } => (event("snapshot", data.clone()), true),
        ServerEvent::PresenceUpdate {
            user_id, online, ..
        } => (
            event(
                "presence.update",
                json!({ "userId": user_id, "online": online }),
            ),
            true,
        ),
        ServerEvent::AudioUpdate {
            user_id,
            in_voice,
            muted,
            ..
        } => (
            event(
                "audio.update",
                json!({ "userId": user_id, "inVoice": in_voice, "muted": muted }),
            ),
            true,
        ),
        ServerEvent::SpeakingUpdate {
            user_id, speaking, ..
        } => (
            event(
                "speaking.update",
                json!({ "userId": user_id, "speaking": speaking }),
            ),
            false,
        ),
        ServerEvent::StatsUpdate { user_id, stats, .. } => (
            event("stats.update", json!({ "userId": user_id, "stats": stats })),
            false,
        ),
        ServerEvent::ChatMessage { seq, data, .. } => {
            (json!({ "t": "chat.message", "d": data, "seq": seq }), true)
        }
        ServerEvent::RecordingStatus {
            recording_id,
            status,
            started_at,
            ..
        } => (
            event(
                "recording.status",
                json!({
                    "recordingId": recording_id,
                    "startedAt": started_at,
                    "status": match status {
                        RecordingChange::Started => "STARTED",
                        RecordingChange::Paused => "PAUSED",
                        RecordingChange::Resumed => "RESUMED",
                        RecordingChange::Stopped => "STOPPED",
                    },
                }),
            ),
            true,
        ),
        ServerEvent::RecordingState { recording, .. } => (
            event(
                "recording.state",
                json!({
                    "recording": recording.as_ref().map(|r| json!({
                        "recordingId": r.recording_id,
                        "capturing": r.capturing,
                        "startedAt": r.started_at,
                    })),
                }),
            ),
            true,
        ),
        ServerEvent::RosterChanged { .. } => (event("roster.changed", Value::Null), true),
        ServerEvent::Table { t, data } => (event(t, data.clone()), true),
        _ => return None,
    })
}

#[derive(Default)]
struct Feed {
    snapshot: Option<Value>,
    tail: VecDeque<Value>,
}

#[derive(Default)]
pub struct PanelFeed(Mutex<Feed>);

impl PanelFeed {
    /// Records `value` if `retain`. A snapshot replaces everything before it, as it does on the wire.
    pub fn record(&self, value: &Value, retain: bool) {
        if !retain {
            return;
        }
        let mut feed = self.0.lock().unwrap();
        if value.get("t").and_then(Value::as_str) == Some("snapshot") {
            feed.snapshot = Some(value.clone());
            feed.tail.clear();
            return;
        }
        if feed.tail.len() == TAIL_LIMIT {
            feed.tail.pop_front();
        }
        feed.tail.push_back(value.clone());
    }

    /// `{ snapshot, events }` — the snapshot (if any) then the events to apply after it, in order.
    pub fn hydrate(&self) -> Value {
        let feed = self.0.lock().unwrap();
        json!({ "snapshot": feed.snapshot, "events": feed.tail })
    }

    pub fn clear(&self) {
        let mut feed = self.0.lock().unwrap();
        feed.snapshot = None;
        feed.tail.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat(n: u64) -> Value {
        json!({ "t": "chat.message", "d": { "n": n } })
    }

    #[test]
    fn table_frames_and_chat_are_forwarded_and_retained() {
        let table = ServerEvent::Table {
            t: "party.state".into(),
            data: json!({ "parties": [] }),
        };
        let (value, retain) = panel_event(&table).unwrap();
        assert_eq!(value["t"], "party.state");
        assert!(retain);
    }

    #[test]
    fn recording_frames_reach_panels() {
        let status = ServerEvent::RecordingStatus {
            campaign_id: "c".into(),
            recording_id: "r1".into(),
            status: RecordingChange::Paused,
            started_at: Some(1000),
        };
        let (value, retain) = panel_event(&status).unwrap();
        assert_eq!(value["t"], "recording.status");
        assert_eq!(value["d"]["status"], "PAUSED");
        assert_eq!(value["d"]["startedAt"], 1000);
        assert!(retain, "a panel opened mid-recording must learn the state");

        let none = ServerEvent::RecordingState {
            campaign_id: "c".into(),
            recording: None,
        };
        assert!(panel_event(&none).unwrap().0["d"]["recording"].is_null());

        let running = ServerEvent::RecordingState {
            campaign_id: "c".into(),
            recording: Some(rust_sync::RecordingInfo {
                recording_id: "r1".into(),
                capturing: true,
                acknowledged: false,
                started_at: Some(2000),
            }),
        };
        assert_eq!(
            panel_event(&running).unwrap().0["d"]["recording"]["startedAt"],
            2000
        );
    }

    #[test]
    fn speaking_and_stats_are_live_only() {
        let speaking = ServerEvent::SpeakingUpdate {
            campaign_id: "c".into(),
            user_id: "u".into(),
            speaking: true,
        };
        assert!(!panel_event(&speaking).unwrap().1);
        assert!(panel_event(&ServerEvent::Unknown { t: "x".into() }).is_none());
    }

    #[test]
    fn a_snapshot_resets_the_tail_and_hydrate_returns_both() {
        let feed = PanelFeed::default();
        feed.record(&chat(1), true);
        feed.record(&json!({ "t": "snapshot", "d": { "s": 1 } }), true);
        feed.record(&chat(2), true);
        feed.record(&json!({ "t": "speaking.update" }), false);
        let hydrated = feed.hydrate();
        assert_eq!(hydrated["snapshot"]["d"]["s"], 1);
        assert_eq!(hydrated["events"].as_array().unwrap().len(), 1);
        assert_eq!(hydrated["events"][0]["d"]["n"], 2);
    }

    #[test]
    fn the_tail_is_bounded_and_never_evicts_the_snapshot() {
        let feed = PanelFeed::default();
        feed.record(&json!({ "t": "snapshot", "d": {} }), true);
        for n in 0..(TAIL_LIMIT as u64 + 50) {
            feed.record(&chat(n), true);
        }
        let hydrated = feed.hydrate();
        assert!(hydrated["snapshot"].is_object());
        let events = hydrated["events"].as_array().unwrap();
        assert_eq!(events.len(), TAIL_LIMIT);
        assert_eq!(events[0]["d"]["n"], 50);
        feed.clear();
        assert!(feed.hydrate()["snapshot"].is_null());
    }
}
