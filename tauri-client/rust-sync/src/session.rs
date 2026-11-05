//! The connection state machine, with no I/O: feed it what happened (opened, a text frame, closed)
//! and it returns what to do. That keeps the rules — authenticate first, resume with the last
//! sequence number, never reconnect after a revocation — unit-testable without a socket.

use std::collections::BTreeMap;

use crate::protocol::{auth_frame, parse_server_frame, resume_frame, ServerEvent};

/// Where we are in one campaign's event stream. The sequence number only means something within
/// its epoch, so they are always kept — and sent — together.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Cursor {
    epoch: String,
    seq: u64,
}

/// The WebSocket close code the backend uses for "not authenticated / session revoked".
pub const CLOSE_UNAUTHORIZED: u16 = 4401;
/// …and for an unsupported protocol version.
pub const CLOSE_BAD_REQUEST: u16 = 4400;

/// What the app layer hears about.
#[derive(Debug, Clone, PartialEq)]
pub enum SyncEvent {
    /// The socket is open and authenticated; subscriptions are being resumed.
    Connected,
    /// The socket is gone. The client will retry unless it was revoked or stopped.
    Disconnected,
    /// The session is no longer valid: stop, and send the user back to sign in.
    Revoked,
    /// The server needs a newer client. Retrying cannot help.
    IncompatibleServer,
    Server(ServerEvent),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Send(String),
    Emit(SyncEvent),
    /// Close this socket and connect again (after the backoff).
    Reconnect,
    /// Give up for good.
    Stop,
}

pub struct Session {
    token: String,
    /// Campaigns we follow, and the last replayable event seen in each (`None` = never; ask for a snapshot).
    campaigns: BTreeMap<String, Option<Cursor>>,
    authenticated: bool,
    finished: bool,
}

impl Session {
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            token: token.into(),
            campaigns: BTreeMap::new(),
            authenticated: false,
            finished: false,
        }
    }

    pub fn is_authenticated(&self) -> bool {
        self.authenticated
    }

    /// The last sequence number seen for a campaign.
    pub fn last_seq(&self, campaign_id: &str) -> Option<u64> {
        self.cursor(campaign_id).map(|cursor| cursor.seq)
    }

    /// The event stream that sequence number belongs to.
    pub fn epoch(&self, campaign_id: &str) -> Option<&str> {
        self.cursor(campaign_id).map(|cursor| cursor.epoch.as_str())
    }

    fn cursor(&self, campaign_id: &str) -> Option<&Cursor> {
        self.campaigns.get(campaign_id).and_then(Option::as_ref)
    }

    /// Starts following a campaign. If already authenticated, the resume goes out now; otherwise it
    /// goes out as soon as authentication succeeds.
    pub fn subscribe(&mut self, campaign_id: &str) -> Vec<Action> {
        if self.campaigns.contains_key(campaign_id) {
            return Vec::new();
        }
        self.campaigns.insert(campaign_id.to_string(), None);
        if self.authenticated {
            vec![Action::Send(resume_frame(campaign_id, None))]
        } else {
            Vec::new()
        }
    }

    pub fn unsubscribe(&mut self, campaign_id: &str) {
        self.campaigns.remove(campaign_id);
    }

    /// A new socket opened: always authenticate first.
    pub fn on_open(&mut self) -> Vec<Action> {
        self.authenticated = false;
        vec![Action::Send(auth_frame(&self.token))]
    }

    pub fn on_text(&mut self, raw: &str) -> Vec<Action> {
        let (event, _) = match parse_server_frame(raw) {
            Ok(parsed) => parsed,
            // A frame we can't decode is dropped; a wrong protocol version is fatal.
            Err(crate::protocol::ParseError::Version(_)) => {
                self.finished = true;
                return vec![Action::Emit(SyncEvent::IncompatibleServer), Action::Stop];
            }
            Err(_) => return Vec::new(),
        };

        let mut actions = Vec::new();
        match &event {
            ServerEvent::AuthOk { .. } => {
                self.authenticated = true;
                actions.push(Action::Emit(SyncEvent::Connected));
                // Resume every campaign, telling the server where we left off.
                for (campaign_id, cursor) in &self.campaigns {
                    let cursor = cursor.as_ref().map(|c| (c.epoch.as_str(), c.seq));
                    actions.push(Action::Send(resume_frame(campaign_id, cursor)));
                }
            }
            ServerEvent::AuthRevoked { .. } => {
                self.finished = true;
                self.authenticated = false;
                actions.push(Action::Emit(SyncEvent::Revoked));
                actions.push(Action::Stop);
                return actions;
            }
            // A snapshot replaces our state wholesale and resets the cursor — including to a
            // *lower* number, which is what a restarted server looks like.
            ServerEvent::Snapshot {
                campaign_id,
                epoch,
                seq,
                ..
            } => {
                // An empty epoch can't be proven later, so it never becomes a cursor.
                if let (Some(slot), false) = (self.campaigns.get_mut(campaign_id), epoch.is_empty())
                {
                    *slot = Some(Cursor {
                        epoch: epoch.clone(),
                        seq: *seq,
                    });
                }
            }
            ServerEvent::Resumed {
                campaign_id,
                epoch,
                seq,
                ..
            } => {
                // An empty epoch can't be proven later, so it never becomes a cursor.
                if let (Some(slot), false) = (self.campaigns.get_mut(campaign_id), epoch.is_empty())
                {
                    *slot = Some(Cursor {
                        epoch: epoch.clone(),
                        seq: *seq,
                    });
                }
            }
            ServerEvent::ChatMessage {
                campaign_id, seq, ..
            } => {
                // Only ever move forward within the stream we know: a replayed older event must not rewind
                // the cursor, and a chat event can't start a cursor (no epoch to pair it with).
                if let Some(Some(cursor)) = self.campaigns.get_mut(campaign_id) {
                    if *seq > cursor.seq {
                        cursor.seq = *seq;
                    }
                }
            }
            _ => {}
        }
        actions.push(Action::Emit(SyncEvent::Server(event)));
        actions
    }

    /// The socket closed. `code` is the WebSocket close code if the server sent one.
    pub fn on_close(&mut self, code: Option<u16>) -> Vec<Action> {
        self.authenticated = false;
        if self.finished {
            return vec![Action::Stop];
        }
        match code {
            Some(CLOSE_UNAUTHORIZED) => {
                self.finished = true;
                vec![Action::Emit(SyncEvent::Revoked), Action::Stop]
            }
            Some(CLOSE_BAD_REQUEST) => {
                self.finished = true;
                vec![Action::Emit(SyncEvent::IncompatibleServer), Action::Stop]
            }
            _ => vec![Action::Emit(SyncEvent::Disconnected), Action::Reconnect],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn server(t: &str, d: Value, seq: Option<u64>) -> String {
        match seq {
            Some(seq) => json!({ "v": 1, "t": t, "seq": seq, "ts": 1, "d": d }).to_string(),
            None => json!({ "v": 1, "t": t, "ts": 1, "d": d }).to_string(),
        }
    }

    fn sent(actions: &[Action]) -> Vec<Value> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::Send(text) => Some(serde_json::from_str(text).unwrap()),
                _ => None,
            })
            .collect()
    }

    fn authed(session: &mut Session) {
        session.on_open();
        session.on_text(&server("auth.ok", json!({ "userId": "u" }), None));
    }

    #[test]
    fn authenticates_first_on_every_open() {
        let mut s = Session::new("tok");
        let first = sent(&s.on_open());
        assert_eq!(first.len(), 1);
        assert_eq!(first[0]["t"], "auth");
        assert_eq!(first[0]["d"]["token"], "tok");
    }

    #[test]
    fn resumes_each_campaign_after_auth_ok_and_only_then() {
        let mut s = Session::new("tok");
        assert!(s.subscribe("c1").is_empty(), "no resume before auth");
        s.on_open();
        let actions = s.on_text(&server("auth.ok", json!({ "userId": "u" }), None));
        let resumes = sent(&actions);
        assert_eq!(resumes.len(), 1);
        assert_eq!(resumes[0]["t"], "resume");
        assert_eq!(resumes[0]["d"], json!({ "campaignId": "c1" }));
        assert!(actions.contains(&Action::Emit(SyncEvent::Connected)));
    }

    #[test]
    fn subscribing_while_connected_resumes_immediately() {
        let mut s = Session::new("tok");
        authed(&mut s);
        let resumes = sent(&s.subscribe("c2"));
        assert_eq!(resumes[0]["d"], json!({ "campaignId": "c2" }));
        assert!(s.subscribe("c2").is_empty(), "subscribing twice is a no-op");
    }

    #[test]
    fn remembers_the_last_sequence_and_resumes_from_it_after_a_reconnect() {
        let mut s = Session::new("tok");
        s.subscribe("c");
        authed(&mut s);
        s.on_text(&server(
            "snapshot",
            json!({ "campaignId": "c", "epoch": "e1", "seq": 3 }),
            None,
        ));
        s.on_text(&server(
            "chat.message",
            json!({ "campaignId": "c", "text": "a" }),
            Some(4),
        ));
        s.on_text(&server(
            "chat.message",
            json!({ "campaignId": "c", "text": "b" }),
            Some(5),
        ));
        assert_eq!(s.last_seq("c"), Some(5));

        // The network drops and comes back.
        assert!(s.on_close(None).contains(&Action::Reconnect));
        s.on_open();
        let resumes = sent(&s.on_text(&server("auth.ok", json!({ "userId": "u" }), None)));
        assert_eq!(
            resumes[0]["d"],
            json!({ "campaignId": "c", "lastSeq": 5, "epoch": "e1" })
        );
    }

    #[test]
    fn never_moves_the_cursor_backwards_on_old_events() {
        let mut s = Session::new("tok");
        s.subscribe("c");
        authed(&mut s);
        s.on_text(&server(
            "resumed",
            json!({ "campaignId": "c", "epoch": "e1", "seq": 10, "replayed": 0 }),
            None,
        ));
        s.on_text(&server(
            "chat.message",
            json!({ "campaignId": "c" }),
            Some(7),
        ));
        assert_eq!(s.last_seq("c"), Some(10));
    }

    #[test]
    fn a_snapshot_may_reset_the_cursor_to_a_lower_number() {
        // The server restarted and its counter began again; the snapshot is the new truth.
        let mut s = Session::new("tok");
        s.subscribe("c");
        authed(&mut s);
        s.on_text(&server(
            "resumed",
            json!({ "campaignId": "c", "epoch": "e1", "seq": 40, "replayed": 0 }),
            None,
        ));
        s.on_text(&server(
            "snapshot",
            json!({ "campaignId": "c", "epoch": "e2", "seq": 2 }),
            None,
        ));
        assert_eq!(s.last_seq("c"), Some(2));
        assert_eq!(
            s.epoch("c"),
            Some("e2"),
            "the new stream's epoch replaces the old"
        );
    }

    #[test]
    fn chat_before_any_snapshot_cannot_start_a_cursor() {
        // Without an epoch there is nothing to prove which stream the number belongs to.
        let mut s = Session::new("tok");
        s.subscribe("c");
        authed(&mut s);
        s.on_text(&server(
            "chat.message",
            json!({ "campaignId": "c" }),
            Some(9),
        ));
        assert_eq!(s.last_seq("c"), None);
    }

    #[test]
    fn a_missing_epoch_is_never_stored_so_the_next_resume_asks_for_a_snapshot() {
        let mut s = Session::new("tok");
        s.subscribe("c");
        authed(&mut s);
        s.on_text(&server(
            "snapshot",
            json!({ "campaignId": "c", "seq": 4 }),
            None,
        ));
        assert_eq!(s.last_seq("c"), None);
        assert!(s.on_close(None).contains(&Action::Reconnect));
        s.on_open();
        let resumes = sent(&s.on_text(&server("auth.ok", json!({ "userId": "u" }), None)));
        assert_eq!(resumes[0]["d"], json!({ "campaignId": "c" }));
    }

    #[test]
    fn revocation_stops_for_good() {
        let mut s = Session::new("tok");
        s.on_open();
        let actions = s.on_text(&server(
            "auth.revoked",
            json!({ "code": "session_invalid" }),
            None,
        ));
        assert!(actions.contains(&Action::Emit(SyncEvent::Revoked)));
        assert!(actions.contains(&Action::Stop));
        // …and the close that follows must not turn into a reconnect.
        assert_eq!(s.on_close(Some(CLOSE_UNAUTHORIZED)), vec![Action::Stop]);
    }

    #[test]
    fn a_4401_close_alone_also_means_revoked() {
        let mut s = Session::new("tok");
        s.on_open();
        let actions = s.on_close(Some(CLOSE_UNAUTHORIZED));
        assert_eq!(
            actions,
            vec![Action::Emit(SyncEvent::Revoked), Action::Stop]
        );
    }

    #[test]
    fn ordinary_closes_reconnect() {
        let mut s = Session::new("tok");
        authed(&mut s);
        let actions = s.on_close(Some(1006));
        assert!(actions.contains(&Action::Emit(SyncEvent::Disconnected)));
        assert!(actions.contains(&Action::Reconnect));
        assert!(!s.is_authenticated());
    }

    #[test]
    fn a_newer_protocol_stops_instead_of_retrying() {
        let mut s = Session::new("tok");
        s.on_open();
        let actions = s.on_text(r#"{"v":2,"t":"auth.ok","d":{}}"#);
        assert_eq!(
            actions,
            vec![Action::Emit(SyncEvent::IncompatibleServer), Action::Stop]
        );
    }

    #[test]
    fn garbage_frames_are_dropped_quietly() {
        let mut s = Session::new("tok");
        authed(&mut s);
        assert!(s.on_text("{not json").is_empty());
        assert!(s.is_authenticated());
    }
}
