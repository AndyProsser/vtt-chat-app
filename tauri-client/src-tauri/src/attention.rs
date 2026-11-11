//! Getting the player's attention while the window is closed or behind others: an unread dot on the tray
//! icon, and a desktop notification for the few things worth interrupting for.
//!
//! The rules (decided 2026-11-10; the whisper rule is Andy's):
//!
//! - Nothing happens while the player is looking at the window (it is shown **and** focused).
//! - **Public chat** from someone else counts as unread (the dot), with no pop-up: it is constant.
//! - **Whispers, handouts and loot** matter only **in-game**: connected to voice with a recording running.
//!   Then they count as unread, and a whisper or handout also gets a notification. Outside a game they are
//!   ignored here (they are still in the chat when the window is opened).
//! - **Reminders and changes to a session, and "summary ready"**, always get a notification: they are rare
//!   and they are the reason to hear from the app while it is closed.
//!
//! `classify` is the whole policy as a pure function; the rest of the file only carries it out.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use rust_sync::ServerEvent;

use crate::notify_prefs::NotifyPrefs;
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// What a server event is worth to a player who is not looking.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Attention {
    /// Adds one to the unread count.
    pub unread: bool,
    /// A notification to show: title and body.
    pub notify: Option<(String, String)>,
}

/// What `classify` needs to know about the moment.
#[derive(Debug, Clone, Copy)]
pub struct Context<'a> {
    pub self_id: &'a str,
    /// Connected to voice with a recording running.
    pub in_game: bool,
    /// The main window is shown and focused.
    pub attended: bool,
    /// What the player chose to hear about, and the quiet hours.
    pub prefs: &'a NotifyPrefs,
    /// Minutes after local midnight, for the quiet hours.
    pub minute: u16,
}

const NOTE_CHARS: usize = 90;

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn who(data: &Value, key: &str) -> (String, String) {
    let from = data.get(key).cloned().unwrap_or(Value::Null);
    (text(&from, "userId"), text(&from, "name"))
}

fn shortened(text: &str) -> String {
    let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= NOTE_CHARS {
        return one_line;
    }
    let cut: String = one_line.chars().take(NOTE_CHARS).collect();
    format!("{}…", cut.trim_end())
}

pub fn classify(event: &ServerEvent, ctx: &Context<'_>) -> Attention {
    let mut attention = classify_kinds(event, ctx);
    if ctx.prefs.is_quiet(ctx.minute) {
        attention.notify = None;
    }
    attention
}

fn classify_kinds(event: &ServerEvent, ctx: &Context<'_>) -> Attention {
    if ctx.attended {
        return Attention::default();
    }
    let prefs = ctx.prefs;
    match event {
        ServerEvent::ChatMessage { data, .. } => {
            let (sender, _) = who(data, "from");
            Attention {
                unread: prefs.chat && sender != ctx.self_id,
                notify: None,
            }
        }
        ServerEvent::Table { t, data } => match t.as_str() {
            "chat.whisper" if ctx.in_game && prefs.whispers => {
                let (sender, name) = who(data, "from");
                if sender == ctx.self_id {
                    return Attention::default();
                }
                Attention {
                    unread: true,
                    notify: Some((
                        format!("Whisper from {name}"),
                        shortened(&text(data, "text")),
                    )),
                }
            }
            "handout.shown" if ctx.in_game && prefs.table => Attention {
                unread: true,
                notify: Some((
                    "A handout was shared".into(),
                    shortened(&text(data, "title")),
                )),
            },
            "loot.dropped" if ctx.in_game && prefs.table => Attention {
                unread: true,
                notify: None,
            },
            "notification" => match text(data, "kind").as_str() {
                // Who has answered an invitation is the DM's business, not worth a pop-up.
                "rsvp.changed" => Attention::default(),
                // Asking to join a campaign: a pop-up for the DM, and for the person who asked.
                "join_request" if !prefs.join_requests => Attention::default(),
                "join_decision" if !prefs.join_decisions => Attention::default(),
                _ if !prefs.sessions => Attention::default(),
                _ => Attention {
                    unread: false,
                    notify: Some((text(data, "title"), shortened(&text(data, "body")))),
                },
            },
            _ => Attention::default(),
        },
        _ => Attention::default(),
    }
}

/// How many things have happened since the player last looked.
#[derive(Default)]
pub struct Unread(AtomicU32);

impl Unread {
    pub fn count(&self) -> u32 {
        self.0.load(Ordering::Relaxed)
    }
}

/// Who this app's player is, learned when the server accepts the sign-in.
#[derive(Default)]
pub struct SelfId(std::sync::Mutex<String>);

/// Last notification shown, to keep a burst of whispers from becoming a burst of pop-ups.
#[derive(Default)]
pub struct LastNotified(std::sync::Mutex<Option<Instant>>);

const QUIET_BETWEEN_POPUPS: Duration = Duration::from_secs(3);

fn main_attended(app: &AppHandle) -> bool {
    app.get_webview_window(crate::windows::MAIN_LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
}

fn in_game(app: &AppHandle) -> bool {
    let voice = app
        .state::<rust_livekit::SharedClient>()
        .lock()
        .unwrap()
        .is_some();
    voice
        && app
            .state::<std::sync::Mutex<crate::session::TrayModel>>()
            .lock()
            .unwrap()
            .recording_open()
}

/// Called for every server event; does nothing unless the player is not looking and it matters.
pub fn on_server_event(app: &AppHandle, event: &ServerEvent) {
    if let ServerEvent::AuthOk { user_id } = event {
        *app.state::<SelfId>().0.lock().unwrap() = user_id.clone();
        return;
    }
    let self_id = app.state::<SelfId>().0.lock().unwrap().clone();
    let attended = main_attended(app);
    let prefs = crate::account::data_dir(app)
        .map(|dir| NotifyPrefs::load(&dir))
        .unwrap_or_default();
    let ctx = Context {
        self_id: &self_id,
        in_game: in_game(app),
        attended,
        prefs: &prefs,
        minute: crate::notify_prefs::local_minute(),
    };
    let attention = classify(event, &ctx);
    if attention.unread {
        app.state::<Unread>().0.fetch_add(1, Ordering::Relaxed);
        crate::session::refresh_tray(app);
    }
    if let Some((title, body)) = attention.notify {
        let notified = app.state::<LastNotified>();
        {
            let mut last = notified.0.lock().unwrap();
            if last.is_some_and(|at| at.elapsed() < QUIET_BETWEEN_POPUPS) {
                return;
            }
            *last = Some(Instant::now());
        }
        use tauri_plugin_notification::NotificationExt;
        if let Err(err) = app.notification().builder().title(title).body(body).show() {
            eprintln!("[src-tauri] could not show a notification: {err}");
        }
    }
}

/// The player is looking again: the dot goes.
pub fn clear(app: &AppHandle) {
    if app.state::<Unread>().0.swap(0, Ordering::Relaxed) != 0 {
        crate::session::refresh_tray(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ME: &str = "me";
    static DEFAULTS: NotifyPrefs = NotifyPrefs {
        chat: true,
        whispers: true,
        table: true,
        sessions: true,
        join_requests: true,
        join_decisions: true,
        quiet: None,
    };
    fn away(in_game: bool) -> Context<'static> {
        Context {
            self_id: ME,
            in_game,
            attended: false,
            prefs: &DEFAULTS,
            minute: 12 * 60,
        }
    }
    fn with_prefs(in_game: bool, prefs: &'static NotifyPrefs) -> Context<'static> {
        Context {
            prefs,
            ..away(in_game)
        }
    }
    fn table(t: &str, data: Value) -> ServerEvent {
        ServerEvent::Table { t: t.into(), data }
    }
    fn public(from: &str) -> ServerEvent {
        ServerEvent::ChatMessage {
            campaign_id: "c".into(),
            seq: 1,
            data: json!({ "from": { "userId": from, "name": "Aria" }, "text": "hello" }),
        }
    }
    fn whisper(from: &str) -> ServerEvent {
        table(
            "chat.whisper",
            json!({ "from": { "userId": from, "name": "Aria" }, "text": "the key is cursed" }),
        )
    }

    #[test]
    fn nothing_happens_while_the_player_is_looking() {
        let looking = Context {
            attended: true,
            ..away(true)
        };
        assert_eq!(classify(&public("them"), &looking), Attention::default());
        assert_eq!(classify(&whisper("them"), &looking), Attention::default());
    }

    #[test]
    fn public_chat_from_someone_else_is_unread_with_no_pop_up_even_outside_a_game() {
        let a = classify(&public("them"), &away(false));
        assert!(a.unread);
        assert_eq!(a.notify, None);
        assert_eq!(classify(&public(ME), &away(false)), Attention::default());
    }

    #[test]
    fn a_whisper_counts_and_pops_up_only_in_game() {
        let in_game = classify(&whisper("them"), &away(true));
        assert!(in_game.unread);
        assert_eq!(
            in_game.notify,
            Some(("Whisper from Aria".into(), "the key is cursed".into()))
        );
        assert_eq!(
            classify(&whisper("them"), &away(false)),
            Attention::default()
        );
        assert_eq!(classify(&whisper(ME), &away(true)), Attention::default());
    }

    #[test]
    fn handouts_and_loot_matter_only_in_game() {
        let handout = table("handout.shown", json!({ "title": "Crypt map" }));
        assert!(classify(&handout, &away(true)).unread);
        assert_eq!(
            classify(&handout, &away(true)).notify,
            Some(("A handout was shared".into(), "Crypt map".into()))
        );
        assert_eq!(classify(&handout, &away(false)), Attention::default());
        let loot = table("loot.dropped", json!({ "name": "Ring" }));
        assert!(classify(&loot, &away(true)).unread);
        assert_eq!(classify(&loot, &away(true)).notify, None);
        assert_eq!(classify(&loot, &away(false)), Attention::default());
    }

    #[test]
    fn session_reminders_and_summaries_always_pop_up_and_rsvps_never_do() {
        let reminder = table(
            "notification",
            json!({ "kind": "session.reminder", "title": "Session 4 in an hour", "body": "Thursday 7 pm" }),
        );
        for game in [true, false] {
            assert_eq!(
                classify(&reminder, &away(game)).notify,
                Some(("Session 4 in an hour".into(), "Thursday 7 pm".into()))
            );
        }
        let rsvp = table(
            "notification",
            json!({ "kind": "rsvp.changed", "title": "x" }),
        );
        assert_eq!(classify(&rsvp, &away(true)), Attention::default());
    }

    #[test]
    fn a_kind_the_player_turned_off_is_ignored() {
        static NO_CHAT: NotifyPrefs = NotifyPrefs {
            chat: false,
            ..DEFAULTS
        };
        static NO_WHISPERS: NotifyPrefs = NotifyPrefs {
            whispers: false,
            ..DEFAULTS
        };
        static NO_TABLE: NotifyPrefs = NotifyPrefs {
            table: false,
            ..DEFAULTS
        };
        static NO_SESSIONS: NotifyPrefs = NotifyPrefs {
            sessions: false,
            ..DEFAULTS
        };
        static NO_JOIN_REQUESTS: NotifyPrefs = NotifyPrefs {
            join_requests: false,
            ..DEFAULTS
        };
        static NO_JOIN_DECISIONS: NotifyPrefs = NotifyPrefs {
            join_decisions: false,
            ..DEFAULTS
        };
        let ask = table(
            "notification",
            json!({ "kind": "join_request", "title": "Pip asked to join", "body": "Hi" }),
        );
        let answer = table(
            "notification",
            json!({ "kind": "join_decision", "title": "You're in" }),
        );
        assert!(classify(&ask, &away(false)).notify.is_some());
        assert!(classify(&answer, &away(false)).notify.is_some());
        assert_eq!(
            classify(&ask, &with_prefs(false, &NO_JOIN_REQUESTS)),
            Attention::default()
        );
        assert!(classify(&ask, &with_prefs(false, &NO_JOIN_DECISIONS))
            .notify
            .is_some());
        assert_eq!(
            classify(&answer, &with_prefs(false, &NO_JOIN_DECISIONS)),
            Attention::default()
        );
        assert_eq!(
            classify(&public("them"), &with_prefs(false, &NO_CHAT)),
            Attention::default()
        );
        assert_eq!(
            classify(&whisper("them"), &with_prefs(true, &NO_WHISPERS)),
            Attention::default()
        );
        let handout = table("handout.shown", json!({ "title": "Map" }));
        assert_eq!(
            classify(&handout, &with_prefs(true, &NO_TABLE)),
            Attention::default()
        );
        let loot = table("loot.dropped", json!({ "name": "Ring" }));
        assert_eq!(
            classify(&loot, &with_prefs(true, &NO_TABLE)),
            Attention::default()
        );
        let reminder = table(
            "notification",
            json!({ "kind": "session.reminder", "title": "Soon", "body": "7 pm" }),
        );
        assert_eq!(
            classify(&reminder, &with_prefs(false, &NO_SESSIONS)),
            Attention::default()
        );
    }

    #[test]
    fn quiet_hours_silence_pop_ups_but_the_dot_still_shows() {
        static NIGHT: NotifyPrefs = NotifyPrefs {
            quiet: Some(crate::notify_prefs::QuietHours {
                from: 22 * 60,
                to: 8 * 60,
            }),
            ..DEFAULTS
        };
        let at_night = Context {
            minute: 23 * 60,
            ..with_prefs(true, &NIGHT)
        };
        let a = classify(&whisper("them"), &at_night);
        assert!(a.unread);
        assert_eq!(a.notify, None);
        let reminder = table(
            "notification",
            json!({ "kind": "session.reminder", "title": "Soon", "body": "7 pm" }),
        );
        assert_eq!(classify(&reminder, &at_night).notify, None);
        let by_day = with_prefs(true, &NIGHT);
        assert!(classify(&whisper("them"), &by_day).notify.is_some());
    }

    #[test]
    fn long_text_is_cut_to_one_short_line() {
        let long = "word ".repeat(60);
        let a = classify(
            &table(
                "chat.whisper",
                json!({ "from": { "userId": "them", "name": "A" }, "text": long }),
            ),
            &away(true),
        );
        let body = a.notify.unwrap().1;
        assert!(body.chars().count() <= NOTE_CHARS + 1);
        assert!(body.ends_with('…'));
        assert!(!body.contains('\n'));
    }
}
