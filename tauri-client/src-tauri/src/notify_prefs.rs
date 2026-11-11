//! What a player wants to be told about while the window is closed, and when not to be disturbed. Kept
//! beside the account file. The defaults are the policy in [`crate::attention`]: everything on, no quiet
//! hours.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// A daily window with no pop-ups, in minutes after local midnight. It may cross midnight (22:00 to 08:00).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuietHours {
    pub from: u16,
    pub to: u16,
}

pub const MINUTES_PER_DAY: u16 = 24 * 60;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NotifyPrefs {
    /// A dot on the tray icon for public chat from other people.
    pub chat: bool,
    /// In-game whispers: the dot and a pop-up.
    pub whispers: bool,
    /// In-game handouts and loot: the dot (and a pop-up for a handout).
    pub table: bool,
    /// Session reminders, changes and "summary ready" pop-ups.
    pub sessions: bool,
    /// For a DM: someone asked to join the campaign (a pop-up).
    pub join_requests: bool,
    /// For a player: the DM answered a request to join (a pop-up).
    pub join_decisions: bool,
    /// No pop-ups during these hours (the dot still shows). `None` is no quiet hours.
    pub quiet: Option<QuietHours>,
}

impl Default for NotifyPrefs {
    fn default() -> Self {
        Self {
            chat: true,
            whispers: true,
            table: true,
            sessions: true,
            join_requests: true,
            join_decisions: true,
            quiet: None,
        }
    }
}

const FILE_NAME: &str = "notifications.json";

impl NotifyPrefs {
    /// Missing or unreadable files are just "the defaults".
    pub fn load(dir: &Path) -> Self {
        std::fs::read_to_string(dir.join(FILE_NAME))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::write(
            dir.join(FILE_NAME),
            serde_json::to_string_pretty(self).map_err(std::io::Error::other)?,
        )
    }

    /// Keeps only sane values: minutes inside the day, and an empty window (from == to) means none.
    pub fn cleaned(mut self) -> Self {
        self.quiet = self.quiet.and_then(|q| {
            let q = QuietHours {
                from: q.from.min(MINUTES_PER_DAY - 1),
                to: q.to.min(MINUTES_PER_DAY - 1),
            };
            (q.from != q.to).then_some(q)
        });
        self
    }

    /// Is `minute` (minutes after local midnight) inside the quiet hours?
    pub fn is_quiet(&self, minute: u16) -> bool {
        match self.quiet {
            None => false,
            Some(QuietHours { from, to }) if from < to => minute >= from && minute < to,
            Some(QuietHours { from, to }) => minute >= from || minute < to,
        }
    }
}

/// Minutes after local midnight, now.
pub fn local_minute() -> u16 {
    use chrono::Timelike;
    let now = chrono::Local::now();
    (now.hour() * 60 + now.minute()) as u16
}

#[tauri::command]
pub fn notify_prefs_get(app: tauri::AppHandle) -> NotifyPrefs {
    crate::account::data_dir(&app)
        .map(|dir| NotifyPrefs::load(&dir))
        .unwrap_or_default()
}

#[tauri::command]
pub fn notify_prefs_set(app: tauri::AppHandle, prefs: NotifyPrefs) -> Result<(), String> {
    let dir = crate::account::data_dir(&app).ok_or("no place to save the choice")?;
    prefs.cleaned().save(&dir).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quiet(from: u16, to: u16) -> NotifyPrefs {
        NotifyPrefs {
            quiet: Some(QuietHours { from, to }),
            ..Default::default()
        }
    }

    #[test]
    fn everything_is_on_with_no_quiet_hours_by_default() {
        let p = NotifyPrefs::default();
        assert!(p.chat && p.whispers && p.table && p.sessions);
        assert!(p.join_requests && p.join_decisions);
        assert!(!p.is_quiet(3 * 60));
    }

    #[test]
    fn a_daytime_window_is_quiet_from_its_start_up_to_its_end() {
        let p = quiet(9 * 60, 17 * 60);
        assert!(!p.is_quiet(8 * 60 + 59));
        assert!(p.is_quiet(9 * 60));
        assert!(p.is_quiet(16 * 60 + 59));
        assert!(!p.is_quiet(17 * 60));
    }

    #[test]
    fn an_overnight_window_wraps_past_midnight() {
        let p = quiet(22 * 60, 8 * 60);
        assert!(p.is_quiet(23 * 60));
        assert!(p.is_quiet(0));
        assert!(p.is_quiet(7 * 60 + 59));
        assert!(!p.is_quiet(8 * 60));
        assert!(!p.is_quiet(21 * 60 + 59));
    }

    #[test]
    fn an_empty_or_out_of_range_window_is_cleaned_up() {
        assert_eq!(quiet(600, 600).cleaned().quiet, None);
        let q = quiet(5000, 30).cleaned().quiet.unwrap();
        assert_eq!((q.from, q.to), (MINUTES_PER_DAY - 1, 30));
    }

    #[test]
    fn an_old_or_partial_file_keeps_the_defaults_for_what_it_lacks() {
        let p: NotifyPrefs = serde_json::from_str(r#"{"whispers":false}"#).unwrap();
        assert!(!p.whispers);
        assert!(p.chat && p.table && p.sessions && p.join_requests && p.join_decisions);
    }

    #[test]
    fn it_saves_and_loads() {
        let dir = std::env::temp_dir().join(format!("vtt-notify-{}", std::process::id()));
        let p = NotifyPrefs {
            chat: false,
            ..quiet(60, 120)
        };
        p.save(&dir).unwrap();
        assert_eq!(NotifyPrefs::load(&dir), p);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
