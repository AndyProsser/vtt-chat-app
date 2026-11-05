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
    RosterChanged {
        campaign_id: String,
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

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
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
        "roster.changed" => ServerEvent::RosterChanged {
            campaign_id: campaign_id(),
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

pub fn audio_state_frame(campaign_id: &str, in_voice: bool, muted: bool) -> String {
    frame(
        "audio.state",
        json!({ "campaignId": campaign_id, "inVoice": in_voice, "muted": muted }),
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

pub fn chat_frame(campaign_id: &str, text: &str) -> String {
    frame(
        "chat.message",
        json!({ "campaignId": campaign_id, "text": text }),
    )
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

        let audio: Value = serde_json::from_str(&audio_state_frame("c", true, false)).unwrap();
        assert_eq!(audio["t"], "audio.state");
        assert_eq!(
            audio["d"],
            json!({ "campaignId": "c", "inVoice": true, "muted": false })
        );

        let stats: Value = serde_json::from_str(&stats_frame("c", 40.0, 5.0, 1.5)).unwrap();
        assert_eq!(stats["d"]["packetLossPct"], 1.5);
    }
}
