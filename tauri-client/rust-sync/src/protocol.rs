//! The wire format — the Rust mirror of `backend/src/lib/realtime/protocol.ts` and
//! `docs/architecture/SYNC-PROTOCOL.md`. Versioned JSON text frames.

use serde::Deserialize;
use serde_json::{json, Value};
use thiserror::Error;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ParseError {
    #[error("frame is not valid JSON: {0}")]
    Json(String),
    #[error("server speaks protocol version {0}; this client speaks {PROTOCOL_VERSION}")]
    Version(u32),
}

#[derive(Debug, Deserialize)]
struct RawFrame {
    v: u32,
    t: String,
    #[serde(default)]
    seq: Option<u64>,
    #[serde(default)]
    d: Value,
}

/// A recording transition, as announced to everyone in the campaign.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordingChange {
    Started,
    Paused,
    Resumed,
    Stopped,
}

/// The current state of an ongoing recording, from one viewer's point of view.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordingInfo {
    pub recording_id: String,
    /// `true` while capturing, `false` while paused.
    pub capturing: bool,
    /// This viewer has already heard the start cue for this recording (and it hasn't expired).
    pub acknowledged: bool,
    /// Epoch milliseconds (server clock) when the recording started, if the server said.
    pub started_at: Option<u64>,
    /// How long the DM may be away before any player can pause, resume or stop it (operator setting).
    pub grace_seconds: Option<u64>,
}

/// A decoded server → client frame. Campaign data the UI renders as-is (`Snapshot`, stats) stays
/// as JSON so the panels can evolve without this crate changing in lock-step.
#[derive(Debug, Clone, PartialEq)]
pub enum ServerEvent {
    AuthOk {
        user_id: String,
    },
    /// The session is gone (revoked remotely, or aged out). The client must sign in again.
    AuthRevoked {
        code: String,
    },
    Error {
        code: String,
        message: String,
    },
    Snapshot {
        campaign_id: String,
        /// Names the event stream `seq` belongs to; sent back on resume (see SYNC-PROTOCOL.md).
        epoch: String,
        seq: u64,
        data: Value,
    },
    Resumed {
        campaign_id: String,
        epoch: String,
        seq: u64,
        replayed: u64,
    },
    PresenceUpdate {
        campaign_id: String,
        user_id: String,
        online: bool,
    },
    AudioUpdate {
        campaign_id: String,
        user_id: String,
        in_voice: bool,
        muted: bool,
        /// `"online"`, `"away"`, `"offline"`; empty from a server that predates status.
        status: String,
    },
    SpeakingUpdate {
        campaign_id: String,
        user_id: String,
        speaking: bool,
    },
    StatsUpdate {
        campaign_id: String,
        user_id: String,
        stats: Value,
    },
    ChatMessage {
        campaign_id: String,
        seq: u64,
        data: Value,
    },
    /// The recording changed: STARTED, PAUSED, RESUMED or STOPPED. Each client plays its own
    /// local cue in response.
    RecordingStatus {
        campaign_id: String,
        recording_id: String,
        status: RecordingChange,
        started_at: Option<u64>,
    },
    /// The *current* recording state, sent after every snapshot or replay (so a client that joined
    /// or rejoined mid-recording learns it). `None` means not recording.
    RecordingState {
        campaign_id: String,
        recording: Option<RecordingInfo>,
    },
    RosterChanged {
        campaign_id: String,
    },
    /// A table-feature frame (whispers, handouts, loot, soundboard, parties, notifications — see
    /// [`is_table_frame`]). The panels render these as-is, so the payload stays JSON and the type
    /// is the frame's own name; adding a field server-side needs no change here.
    Table {
        t: String,
        data: Value,
    },
    /// A type this client doesn't know. Ignored, not an error: newer servers may add frames.
    Unknown {
        t: String,
    },
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn recording_status(d: &Value, status: RecordingChange) -> ServerEvent {
    ServerEvent::RecordingStatus {
        campaign_id: text(d, "campaignId"),
        recording_id: text(d, "recordingId"),
        status,
        started_at: d.get("startedAt").and_then(Value::as_u64),
    }
}

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Server → client frames of the table features (docs/architecture/TABLE-FEATURES.md).
pub fn is_table_frame(t: &str) -> bool {
    matches!(
        t,
        "chat.whisper"
            | "chat.whispers"
            | "handout.shown"
            | "handout.removed"
            | "notification"
            | "sound.play"
            | "sound.stop"
            | "sound.volume"
            | "sound.state"
            | "scene.started"
            | "scene.stopped"
            | "party.state"
            | "roster.update"
            | "join.request"
            | "join.decided"
    ) || t.starts_with("loot.")
}

/// Client → server frames the DM and players send for the table features, relayed untouched from
/// the panels. Only known commands pass, so a panel bug can't put arbitrary frames on the socket.
pub fn is_table_command(t: &str) -> bool {
    matches!(
        t,
        "sound.play"
            | "sound.stop"
            | "scene.start"
            | "scene.stop"
            | "sound.volume"
            | "party.create"
            | "party.rename"
            | "party.delete"
            | "party.move"
            | "party.reset"
    )
}

/// A table command, as a wire frame. `None` if `t` is not a known command.
pub fn command_frame(t: &str, data: Value) -> Option<String> {
    is_table_command(t).then(|| frame(t, data))
}

/// A whisper: a chat message addressed to one member.
pub fn whisper_frame(campaign_id: &str, to: &str, text: &str) -> String {
    frame(
        "chat.message",
        json!({ "campaignId": campaign_id, "text": text, "to": to }),
    )
}

/// Decodes one text frame. Returns the event and the frame's `seq`, if it carried one.
pub fn parse_server_frame(raw: &str) -> Result<(ServerEvent, Option<u64>), ParseError> {
    let frame: RawFrame =
        serde_json::from_str(raw).map_err(|err| ParseError::Json(err.to_string()))?;
    if frame.v != PROTOCOL_VERSION {
        return Err(ParseError::Version(frame.v));
    }
    let d = &frame.d;
    let campaign_id = || text(d, "campaignId");

    let event = match frame.t.as_str() {
        "auth.ok" => ServerEvent::AuthOk {
            user_id: text(d, "userId"),
        },
        "auth.revoked" => ServerEvent::AuthRevoked {
            code: text(d, "code"),
        },
        "error" => ServerEvent::Error {
            code: text(d, "code"),
            message: text(d, "message"),
        },
        "snapshot" => ServerEvent::Snapshot {
            campaign_id: campaign_id(),
            epoch: text(d, "epoch"),
            seq: number(d, "seq"),
            data: d.clone(),
        },
        "resumed" => ServerEvent::Resumed {
            campaign_id: campaign_id(),
            epoch: text(d, "epoch"),
            seq: number(d, "seq"),
            replayed: number(d, "replayed"),
        },
        "presence.update" => ServerEvent::PresenceUpdate {
            campaign_id: campaign_id(),
            user_id: text(d, "userId"),
            online: flag(d, "online"),
        },
        "audio.update" => ServerEvent::AudioUpdate {
            campaign_id: campaign_id(),
            user_id: text(d, "userId"),
            in_voice: flag(d, "inVoice"),
            muted: flag(d, "muted"),
            status: d
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        },
        "speaking.update" => ServerEvent::SpeakingUpdate {
            campaign_id: campaign_id(),
            user_id: text(d, "userId"),
            speaking: flag(d, "speaking"),
        },
        "stats.update" => ServerEvent::StatsUpdate {
            campaign_id: campaign_id(),
            user_id: text(d, "userId"),
            stats: d.get("stats").cloned().unwrap_or(Value::Null),
        },
        "chat.message" => ServerEvent::ChatMessage {
            campaign_id: campaign_id(),
            seq: frame.seq.unwrap_or(0),
            data: d.clone(),
        },
        "recording.status" => match text(d, "status").as_str() {
            "STARTED" => recording_status(d, RecordingChange::Started),
            "PAUSED" => recording_status(d, RecordingChange::Paused),
            "RESUMED" => recording_status(d, RecordingChange::Resumed),
            "STOPPED" => recording_status(d, RecordingChange::Stopped),
            other => ServerEvent::Unknown {
                t: format!("recording.status/{other}"),
            },
        },
        "recording.state" => ServerEvent::RecordingState {
            campaign_id: campaign_id(),
            recording: d
                .get("recording")
                .and_then(Value::as_object)
                .map(|r| RecordingInfo {
                    recording_id: r
                        .get("recordingId")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    capturing: r.get("status").and_then(Value::as_str) != Some("PAUSED"),
                    acknowledged: r
                        .get("acknowledged")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    started_at: r.get("startedAt").and_then(Value::as_u64),
                    grace_seconds: r.get("graceSeconds").and_then(Value::as_u64),
                }),
        },
        "roster.changed" => ServerEvent::RosterChanged {
            campaign_id: campaign_id(),
        },
        other if is_table_frame(other) => ServerEvent::Table {
            t: other.to_string(),
            data: d.clone(),
        },
        other => ServerEvent::Unknown {
            t: other.to_string(),
        },
    };
    Ok((event, frame.seq))
}

// ---- client → server frames ----

fn frame(t: &str, d: Value) -> String {
    json!({ "v": PROTOCOL_VERSION, "t": t, "d": d }).to_string()
}

pub fn auth_frame(token: &str) -> String {
    frame("auth", json!({ "token": token }))
}

/// `cursor` is `(epoch, last_seq)`: the last replayable event this client saw and the event stream
/// it belongs to. `None` asks for a snapshot. A sequence number alone is not enough — it means
/// nothing once the server's stream has been restarted — so the two always travel together.
pub fn resume_frame(campaign_id: &str, cursor: Option<(&str, u64)>) -> String {
    match cursor {
        Some((epoch, seq)) => frame(
            "resume",
            json!({ "campaignId": campaign_id, "lastSeq": seq, "epoch": epoch }),
        ),
        None => frame("resume", json!({ "campaignId": campaign_id })),
    }
}

/// `status` is the player's own status: `"online"`, `"away"` or `"offline"`.
pub fn audio_state_frame(campaign_id: &str, in_voice: bool, muted: bool, status: &str) -> String {
    frame(
        "audio.state",
        json!({ "campaignId": campaign_id, "inVoice": in_voice, "muted": muted, "status": status }),
    )
}

pub fn speaking_frame(campaign_id: &str, speaking: bool) -> String {
    frame(
        "speaking.set",
        json!({ "campaignId": campaign_id, "speaking": speaking }),
    )
}

pub fn stats_frame(campaign_id: &str, rtt_ms: f64, jitter_ms: f64, packet_loss_pct: f64) -> String {
    frame(
        "stats.report",
        json!({
            "campaignId": campaign_id,
            "rttMs": rtt_ms,
            "jitterMs": jitter_ms,
            "packetLossPct": packet_loss_pct,
        }),
    )
}

/// "I have heard the start cue for this recording" — sent once the cue has finished playing.
pub fn recording_ack_frame(campaign_id: &str, recording_id: &str) -> String {
    frame(
        "recording.ack",
        json!({ "campaignId": campaign_id, "recordingId": recording_id }),
    )
}

/// A public chat line. `kind` (`say`, `do`, `ooc`; absent means plain `chat`) and `lang` (only on
/// `say`) are optional and sent only when set. The server validates both; the client never parses
/// commands here (CHAT-COMMANDS.md).
pub fn chat_frame(campaign_id: &str, text: &str, kind: Option<&str>, lang: Option<&str>) -> String {
    let mut data = json!({ "campaignId": campaign_id, "text": text });
    if let Some(kind) = kind.filter(|k| !k.is_empty()) {
        data["kind"] = json!(kind);
    }
    if let Some(lang) = lang.filter(|l| !l.is_empty()) {
        data["lang"] = json!(lang);
    }
    frame("chat.message", data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(t: &str, d: Value, seq: Option<u64>) -> String {
        match seq {
            Some(seq) => json!({ "v": 1, "t": t, "seq": seq, "ts": 1, "d": d }).to_string(),
            None => json!({ "v": 1, "t": t, "ts": 1, "d": d }).to_string(),
        }
    }

    #[test]
    fn decodes_each_server_frame_the_backend_sends() {
        let (e, _) =
            parse_server_frame(&server("auth.ok", json!({ "userId": "u1" }), None)).unwrap();
        assert_eq!(
            e,
            ServerEvent::AuthOk {
                user_id: "u1".into()
            }
        );

        let (e, _) = parse_server_frame(&server(
            "auth.revoked",
            json!({ "code": "session_invalid" }),
            None,
        ))
        .unwrap();
        assert_eq!(
            e,
            ServerEvent::AuthRevoked {
                code: "session_invalid".into()
            }
        );

        let (e, _) = parse_server_frame(&server(
            "snapshot",
            json!({ "campaignId": "c", "seq": 7, "members": [] }),
            None,
        ))
        .unwrap();
        assert!(
            matches!(e, ServerEvent::Snapshot { ref campaign_id, seq: 7, .. } if campaign_id == "c")
        );

        let (e, _) = parse_server_frame(&server(
            "resumed",
            json!({ "campaignId": "c", "epoch": "ep", "seq": 9, "replayed": 2 }),
            None,
        ))
        .unwrap();
        assert_eq!(
            e,
            ServerEvent::Resumed {
                campaign_id: "c".into(),
                epoch: "ep".into(),
                seq: 9,
                replayed: 2
            }
        );

        let (e, _) = parse_server_frame(&server(
            "speaking.update",
            json!({ "campaignId": "c", "userId": "u", "speaking": true }),
            None,
        ))
        .unwrap();
        assert_eq!(
            e,
            ServerEvent::SpeakingUpdate {
                campaign_id: "c".into(),
                user_id: "u".into(),
                speaking: true
            }
        );
    }

    #[test]
    fn table_frames_keep_their_type_and_payload() {
        for t in [
            "chat.whisper",
            "party.state",
            "loot.dropped",
            "notification",
            "join.request",
            "join.decided",
        ] {
            let (e, _) = parse_server_frame(&server(t, json!({ "x": 1 }), None)).unwrap();
            assert_eq!(
                e,
                ServerEvent::Table {
                    t: t.into(),
                    data: json!({ "x": 1 })
                }
            );
        }
        let (e, _) = parse_server_frame(&server("who.knows", json!({}), None)).unwrap();
        assert!(matches!(e, ServerEvent::Unknown { .. }));
    }

    #[test]
    fn only_known_table_commands_become_frames() {
        let f = command_frame("party.move", json!({ "campaignId": "c" })).unwrap();
        assert!(f.contains("\"t\":\"party.move\""));
        assert!(command_frame("auth", json!({})).is_none());
        assert!(command_frame("chat.message", json!({})).is_none());
        let w = whisper_frame("c", "u2", "psst");
        assert!(w.contains("\"to\":\"u2\""));
    }

    fn data_of(frame: &str) -> Value {
        serde_json::from_str::<Value>(frame).unwrap()["d"].clone()
    }

    #[test]
    fn plain_chat_frame_has_no_kind_or_lang() {
        let d = data_of(&chat_frame("c", "hi", None, None));
        assert_eq!(d, json!({ "campaignId": "c", "text": "hi" }));
    }

    #[test]
    fn chat_frame_carries_kind_and_lang_when_set() {
        let d = data_of(&chat_frame("c", "Hail", Some("say"), Some("elvish")));
        assert_eq!(
            d,
            json!({ "campaignId": "c", "text": "Hail", "kind": "say", "lang": "elvish" })
        );
        let d = data_of(&chat_frame("c", "late", Some("ooc"), Some("")));
        assert_eq!(d["kind"], "ooc");
        assert!(d.get("lang").is_none());
    }

    #[test]
    fn whisper_frame_has_no_kind() {
        let d = data_of(&whisper_frame("c", "u2", "psst"));
        assert!(d.get("kind").is_none() && d.get("lang").is_none());
    }

    #[test]
    fn incoming_chat_keeps_kind_and_lang_for_the_panels() {
        let (e, _) = parse_server_frame(&server(
            "chat.message",
            json!({ "campaignId": "c", "text": "x", "kind": "say", "lang": "dwarvish" }),
            Some(3),
        ))
        .unwrap();
        match e {
            ServerEvent::ChatMessage { data, .. } => {
                assert_eq!(data["kind"], "say");
                assert_eq!(data["lang"], "dwarvish");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn chat_carries_its_sequence_number() {
        let (e, seq) = parse_server_frame(&server(
            "chat.message",
            json!({ "campaignId": "c", "text": "hi" }),
            Some(12),
        ))
        .unwrap();
        assert_eq!(seq, Some(12));
        assert!(matches!(e, ServerEvent::ChatMessage { seq: 12, .. }));
    }

    #[test]
    fn unknown_types_are_ignored_not_errors() {
        let (e, _) = parse_server_frame(&server("something.new", json!({}), None)).unwrap();
        assert_eq!(
            e,
            ServerEvent::Unknown {
                t: "something.new".into()
            }
        );
    }

    #[test]
    fn rejects_other_protocol_versions_and_bad_json() {
        assert_eq!(
            parse_server_frame(r#"{"v":2,"t":"auth.ok","d":{}}"#),
            Err(ParseError::Version(2))
        );
        assert!(matches!(
            parse_server_frame("{nope"),
            Err(ParseError::Json(_))
        ));
    }

    #[test]
    fn tolerates_missing_fields_instead_of_panicking() {
        let (e, _) = parse_server_frame(r#"{"v":1,"t":"presence.update"}"#).unwrap();
        assert_eq!(
            e,
            ServerEvent::PresenceUpdate {
                campaign_id: String::new(),
                user_id: String::new(),
                online: false
            }
        );
    }

    #[test]
    fn decodes_recording_changes_and_the_current_recording_state() {
        for (wire, expected) in [
            ("STARTED", RecordingChange::Started),
            ("PAUSED", RecordingChange::Paused),
            ("RESUMED", RecordingChange::Resumed),
            ("STOPPED", RecordingChange::Stopped),
        ] {
            let (e, _) = parse_server_frame(&server(
                "recording.status",
                json!({ "campaignId": "c", "recordingId": "r1", "status": wire }),
                None,
            ))
            .unwrap();
            assert_eq!(
                e,
                ServerEvent::RecordingStatus {
                    campaign_id: "c".into(),
                    recording_id: "r1".into(),
                    status: expected,
                    started_at: None,
                }
            );
        }

        let (e, _) = parse_server_frame(&server(
            "recording.state",
            json!({ "campaignId": "c", "recording": {
                "recordingId": "r1", "status": "IN-PROGRESS", "acknowledged": true } }),
            None,
        ))
        .unwrap();
        assert_eq!(
            e,
            ServerEvent::RecordingState {
                campaign_id: "c".into(),
                recording: Some(RecordingInfo {
                    recording_id: "r1".into(),
                    capturing: true,
                    acknowledged: true,
                    started_at: None,
                    grace_seconds: None,
                })
            }
        );

        let (graced, _) = parse_server_frame(&server(
            "recording.state",
            json!({ "campaignId": "c", "recording": {
                "recordingId": "r1", "status": "IN-PROGRESS", "graceSeconds": 45 } }),
            None,
        ))
        .unwrap();
        match graced {
            ServerEvent::RecordingState {
                recording: Some(info),
                ..
            } => assert_eq!(info.grace_seconds, Some(45)),
            other => panic!("not a recording state: {other:?}"),
        }

        let (paused, _) = parse_server_frame(&server(
            "recording.state",
            json!({ "campaignId": "c", "recording": {
                "recordingId": "r1", "status": "PAUSED", "acknowledged": false } }),
            None,
        ))
        .unwrap();
        assert!(matches!(
            paused,
            ServerEvent::RecordingState {
                recording: Some(RecordingInfo {
                    capturing: false,
                    acknowledged: false,
                    ..
                }),
                ..
            }
        ));

        let (none, _) = parse_server_frame(&server(
            "recording.state",
            json!({ "campaignId": "c", "recording": null }),
            None,
        ))
        .unwrap();
        assert_eq!(
            none,
            ServerEvent::RecordingState {
                campaign_id: "c".into(),
                recording: None
            }
        );
    }

    #[test]
    fn the_recording_start_time_is_decoded_when_present() {
        let (status, _) = parse_server_frame(&server(
            "recording.status",
            json!({ "campaignId": "c", "recordingId": "r", "status": "PAUSED", "startedAt": 1000 }),
            None,
        ))
        .unwrap();
        assert!(matches!(
            status,
            ServerEvent::RecordingStatus {
                started_at: Some(1000),
                ..
            }
        ));
        let (state, _) = parse_server_frame(&server(
            "recording.state",
            json!({ "campaignId": "c", "recording": {
                "recordingId": "r", "status": "IN-PROGRESS", "acknowledged": false, "startedAt": 2000 } }),
            None,
        ))
        .unwrap();
        assert!(matches!(
            state,
            ServerEvent::RecordingState {
                recording: Some(RecordingInfo {
                    started_at: Some(2000),
                    ..
                }),
                ..
            }
        ));
    }

    #[test]
    fn an_unrecognised_recording_status_is_ignored_not_trusted() {
        let (e, _) = parse_server_frame(&server(
            "recording.status",
            json!({ "campaignId": "c", "recordingId": "r", "status": "EXPLODED" }),
            None,
        ))
        .unwrap();
        assert!(matches!(e, ServerEvent::Unknown { .. }));
    }

    #[test]
    fn the_ack_frame_matches_the_backend_schema() {
        let ack: Value = serde_json::from_str(&recording_ack_frame("c", "r1")).unwrap();
        assert_eq!(
            ack,
            json!({ "v": 1, "t": "recording.ack", "d": { "campaignId": "c", "recordingId": "r1" } })
        );
    }

    #[test]
    fn client_frames_match_the_backend_schema() {
        let auth: Value = serde_json::from_str(&auth_frame("tok")).unwrap();
        assert_eq!(
            auth,
            json!({ "v": 1, "t": "auth", "d": { "token": "tok" } })
        );

        let with_seq: Value = serde_json::from_str(&resume_frame("c", Some(("e1", 5)))).unwrap();
        assert_eq!(
            with_seq["d"],
            json!({ "campaignId": "c", "lastSeq": 5, "epoch": "e1" })
        );
        let without: Value = serde_json::from_str(&resume_frame("c", None)).unwrap();
        assert_eq!(without["d"], json!({ "campaignId": "c" }));

        let audio: Value =
            serde_json::from_str(&audio_state_frame("c", true, false, "away")).unwrap();
        assert_eq!(audio["t"], "audio.state");
        assert_eq!(
            audio["d"],
            json!({ "campaignId": "c", "inVoice": true, "muted": false, "status": "away" })
        );

        let stats: Value = serde_json::from_str(&stats_frame("c", 40.0, 5.0, 1.5)).unwrap();
        assert_eq!(stats["d"]["packetLossPct"], 1.5);
    }
}
