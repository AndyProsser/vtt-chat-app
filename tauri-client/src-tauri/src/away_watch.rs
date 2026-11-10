//! Notices that the player has walked away: the screen locks or the screensaver starts, or there has been no
//! keyboard or mouse use for a while (default 10 minutes, changeable in Settings, 0 turns it off). That
//! sets Away; coming back (unlock, or any input) ends an Away the app set by itself. An Away the player
//! chose stays until they change it.
//!
//! Linux (GNOME, Wayland or X11) reads Mutter's idle monitor and the screensaver's lock signal over D-Bus.
//! Windows and macOS read the system idle time; their screen-lock signal is not wired yet, so only the idle
//! timer applies there. Anything the platform cannot answer simply never sets Away.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::status::Status;

const POLL: Duration = Duration::from_secs(15);
/// Input within this many seconds counts as "back".
const BACK_WITHIN_SECS: u64 = 10;
pub const DEFAULT_AWAY_MINUTES: u32 = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AwayPrefs {
    /// Minutes without input before Away; 0 is never.
    pub away_minutes: u32,
}

impl Default for AwayPrefs {
    fn default() -> Self {
        Self {
            away_minutes: DEFAULT_AWAY_MINUTES,
        }
    }
}

const FILE_NAME: &str = "presence.json";

impl AwayPrefs {
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
}

#[derive(Debug, PartialEq, Eq)]
pub enum IdleStep {
    GoAway,
    Back,
    Nothing,
}

/// What the idle timer should do now. Only an Online player goes Away, and any recent input is "back"
/// (the status model decides whether that Away was automatic).
pub fn idle_step(status: Status, idle_secs: u64, away_minutes: u32) -> IdleStep {
    match status {
        Status::Online if away_minutes > 0 && idle_secs >= u64::from(away_minutes) * 60 => {
            IdleStep::GoAway
        }
        Status::Away if idle_secs < BACK_WITHIN_SECS => IdleStep::Back,
        _ => IdleStep::Nothing,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum LockStep {
    Locked,
    Unlocked,
    Nothing,
}

/// What a change in "is the screen locked" means. Linux hears about it from a D-Bus signal instead;
/// Windows and macOS are asked on each poll.
pub fn lock_step(was_locked: bool, locked: bool) -> LockStep {
    match (was_locked, locked) {
        (false, true) => LockStep::Locked,
        (true, false) => LockStep::Unlocked,
        _ => LockStep::Nothing,
    }
}

/// Reads macOS's session dictionary (`ioreg -n Root -d1 -a`): the screen is locked when it has
/// `CGSSessionScreenIsLocked` set to true. Unverified on a real Mac.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn ioreg_says_locked(text: &str) -> bool {
    text.find("CGSSessionScreenIsLocked")
        .map(|at| &text[at..])
        .is_some_and(|rest| {
            let after = rest.split("</key>").nth(1).unwrap_or("");
            after.trim_start().starts_with("<true/>")
        })
}

/// Whether the screen is locked right now, where the platform can be asked (Windows, macOS). On Linux the
/// screensaver's signal is used instead, and this is always `false`.
fn screen_locked() -> bool {
    #[cfg(windows)]
    {
        // The lock screen runs on a separate desktop; while it is up the input desktop cannot be opened.
        use windows_sys::Win32::System::StationsAndDesktops::{CloseDesktop, OpenInputDesktop};
        const DESKTOP_SWITCHDESKTOP: u32 = 0x0100;
        // SAFETY: a plain query; the handle, if we get one, is closed at once.
        unsafe {
            let desktop = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
            if desktop.is_null() {
                true
            } else {
                CloseDesktop(desktop);
                false
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/sbin/ioreg")
            .args(["-n", "Root", "-d1", "-a"])
            .output()
            .map(|out| ioreg_says_locked(&String::from_utf8_lossy(&out.stdout)))
            .unwrap_or(false)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        false
    }
}

/// Starts the watcher on its own thread. It does nothing while Offline.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    #[cfg(target_os = "linux")]
    {
        let lock_app = app.clone();
        std::thread::Builder::new()
            .name("away-lock".into())
            .spawn(move || linux::watch_lock(&lock_app))
            .ok();
    }
    std::thread::Builder::new()
        .name("away-idle".into())
        .spawn(move || poll(&app))
        .ok();
}

fn poll(app: &AppHandle) {
    let mut probe = IdleProbe::new();
    let mut was_locked = false;
    loop {
        std::thread::sleep(POLL);
        let status = crate::status_commands::current(app);
        if status == Status::Offline {
            continue;
        }
        let locked = screen_locked();
        let step = lock_step(was_locked, locked);
        was_locked = locked;
        match step {
            LockStep::Locked => go_away(app),
            LockStep::Unlocked => back(app),
            LockStep::Nothing => {}
        }
        if locked {
            continue;
        }
        let Some(idle) = probe.idle_secs() else {
            continue;
        };
        let minutes = crate::account::data_dir(app)
            .map(|dir| AwayPrefs::load(&dir).away_minutes)
            .unwrap_or(DEFAULT_AWAY_MINUTES);
        match idle_step(status, idle, minutes) {
            IdleStep::GoAway => go_away(app),
            IdleStep::Back => back(app),
            IdleStep::Nothing => {}
        }
    }
}

pub fn go_away(app: &AppHandle) {
    if crate::status_commands::current(app) != Status::Online {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::status_commands::apply_status(&app, Status::Away, true).await;
    });
}

pub fn back(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        crate::status_commands::on_activity(&app).await;
    });
}

#[tauri::command]
pub fn away_minutes_get(app: AppHandle) -> u32 {
    crate::account::data_dir(&app)
        .map(|dir| AwayPrefs::load(&dir).away_minutes)
        .unwrap_or(DEFAULT_AWAY_MINUTES)
}

#[tauri::command]
pub fn away_minutes_set(app: AppHandle, minutes: u32) -> Result<(), String> {
    let dir = crate::account::data_dir(&app).ok_or("no place to save the choice")?;
    AwayPrefs {
        away_minutes: minutes.min(24 * 60),
    }
    .save(&dir)
    .map_err(|e| e.to_string())
}

/// Seconds since the last keyboard or mouse use, where the platform can say.
struct IdleProbe {
    #[cfg(target_os = "linux")]
    connection: Option<zbus::blocking::Connection>,
}

impl IdleProbe {
    fn new() -> Self {
        Self {
            #[cfg(target_os = "linux")]
            connection: zbus::blocking::Connection::session().ok(),
        }
    }

    #[cfg(target_os = "linux")]
    fn idle_secs(&mut self) -> Option<u64> {
        let connection = self.connection.as_ref()?;
        let reply = connection
            .call_method(
                Some("org.gnome.Mutter.IdleMonitor"),
                "/org/gnome/Mutter/IdleMonitor/Core",
                Some("org.gnome.Mutter.IdleMonitor"),
                "GetIdletime",
                &(),
            )
            .ok()?;
        let millis: u64 = reply.body().deserialize().ok()?;
        Some(millis / 1000)
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    fn idle_secs(&mut self) -> Option<u64> {
        user_idle::UserIdle::get_time()
            .ok()
            .map(|idle| idle.as_seconds())
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    fn idle_secs(&mut self) -> Option<u64> {
        None
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;

    /// Blocks on the screensaver's `ActiveChanged(bool)`: true when the screen locks, false on unlock.
    pub fn watch_lock(app: &AppHandle) {
        let Ok(connection) = zbus::blocking::Connection::session() else {
            return;
        };
        let Ok(proxy) = zbus::blocking::Proxy::new(
            &connection,
            "org.gnome.ScreenSaver",
            "/org/gnome/ScreenSaver",
            "org.gnome.ScreenSaver",
        ) else {
            return;
        };
        let Ok(signals) = proxy.receive_signal("ActiveChanged") else {
            return;
        };
        for message in signals {
            match message.body().deserialize::<bool>() {
                Ok(true) => go_away(app),
                Ok(false) => back(app),
                Err(_) => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_online_player_goes_away_after_the_chosen_minutes() {
        assert_eq!(idle_step(Status::Online, 599, 10), IdleStep::Nothing);
        assert_eq!(idle_step(Status::Online, 600, 10), IdleStep::GoAway);
    }

    #[test]
    fn zero_minutes_turns_the_timer_off() {
        assert_eq!(idle_step(Status::Online, 99_999, 0), IdleStep::Nothing);
    }

    #[test]
    fn recent_input_while_away_is_back_and_old_input_is_not() {
        assert_eq!(idle_step(Status::Away, 3, 10), IdleStep::Back);
        assert_eq!(idle_step(Status::Away, 700, 10), IdleStep::Nothing);
    }

    #[test]
    fn an_offline_player_is_left_alone() {
        assert_eq!(idle_step(Status::Offline, 99_999, 10), IdleStep::Nothing);
        assert_eq!(idle_step(Status::Offline, 0, 10), IdleStep::Nothing);
    }

    #[test]
    fn the_default_is_ten_minutes_and_an_old_file_still_loads() {
        assert_eq!(AwayPrefs::default().away_minutes, 10);
        assert_eq!(
            serde_json::from_str::<AwayPrefs>("{}")
                .unwrap()
                .away_minutes,
            10
        );
    }

    #[test]
    fn locking_and_unlocking_are_noticed_once_each() {
        assert_eq!(lock_step(false, true), LockStep::Locked);
        assert_eq!(lock_step(true, false), LockStep::Unlocked);
        assert_eq!(lock_step(false, false), LockStep::Nothing);
        assert_eq!(lock_step(true, true), LockStep::Nothing);
    }

    #[test]
    fn the_mac_session_dictionary_says_whether_the_screen_is_locked() {
        let locked = "<key>CGSSessionScreenIsLocked</key>\n<true/>";
        let unlocked = "<key>kCGSSessionOnConsoleKey</key><true/>";
        assert!(ioreg_says_locked(locked));
        assert!(!ioreg_says_locked(unlocked));
        assert!(!ioreg_says_locked(
            "<key>CGSSessionScreenIsLocked</key><false/>"
        ));
    }
}
