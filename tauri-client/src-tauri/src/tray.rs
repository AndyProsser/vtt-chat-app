//! The tray icon: what the app is doing, told truthfully at a glance. A hidden app must never be
//! ambiguous about whether it is live, muted or being recorded (CLAUDE.md §8.1, §8.4), so the icon
//! is derived from the same state the audio path uses, never from a panel.

use crate::recording::Indicator;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    /// Not connected to the server (or signed out): nothing is happening.
    Disconnected,
    /// Connected, microphone closed.
    Muted,
    /// Connected, microphone open and sending.
    Live,
    /// A recording is running (whatever the mic is doing): the most important thing to show.
    Recording,
    /// A recording is paused.
    Paused,
}

/// Priority: not connected beats everything (no state can be trusted); a recording beats mute/live
/// because being recorded is what a player most needs to see.
pub fn tray_state(connected: bool, mic_closed: bool, indicator: Indicator) -> TrayState {
    if !connected {
        return TrayState::Disconnected;
    }
    match indicator {
        Indicator::Recording => TrayState::Recording,
        Indicator::Paused => TrayState::Paused,
        Indicator::None if mic_closed => TrayState::Muted,
        Indicator::None => TrayState::Live,
    }
}

impl TrayState {
    pub fn tooltip(self) -> &'static str {
        match self {
            Self::Disconnected => "VTT Chat — not connected",
            Self::Muted => "VTT Chat — connected, muted",
            Self::Live => "VTT Chat — live",
            Self::Recording => "VTT Chat — this session is being recorded",
            Self::Paused => "VTT Chat — recording paused",
        }
    }

    /// Fill colour (RGB). Distinct hues, plus a ring for the recording states so they stay
    /// distinguishable without relying on colour alone.
    fn colour(self) -> [u8; 3] {
        match self {
            Self::Disconnected => [0x8a, 0x8f, 0x98],
            Self::Muted => [0xe0, 0xa1, 0x2b],
            Self::Live => [0x2e, 0xb8, 0x6c],
            Self::Recording => [0xe5, 0x39, 0x35],
            Self::Paused => [0xe5, 0x39, 0x35],
        }
    }

    fn ring(self) -> bool {
        matches!(self, Self::Recording | Self::Paused)
    }
}

pub const ICON_SIZE: u32 = 32;

/// A flat disc on a transparent background as RGBA. Recording is a solid red disc inside a ring;
/// paused is the same ring with a hollow centre, so the two differ by shape as well as by state.
pub fn render_icon(state: TrayState) -> Vec<u8> {
    let size = ICON_SIZE as i32;
    let centre = (size as f32 - 1.0) / 2.0;
    let [r, g, b] = state.colour();
    let mut pixels = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];
    for y in 0..size {
        for x in 0..size {
            let d = ((x as f32 - centre).powi(2) + (y as f32 - centre).powi(2)).sqrt();
            let on = if state.ring() {
                let ring = (13.0..=15.5).contains(&d);
                let core = d <= 8.5 && state != TrayState::Paused;
                ring || core
            } else {
                d <= 14.5
            };
            if on {
                let i = ((y * size + x) * 4) as usize;
                pixels[i..i + 4].copy_from_slice(&[r, g, b, 0xff]);
            }
        }
    }
    pixels
}

// --- Tauri glue --------------------------------------------------------------------------------

const TRAY_ID: &str = "main";
const MENU_TOGGLE_MUTE: &str = "toggle_mute";
const MENU_QUIT: &str = "quit";

/// Creates the tray icon (disconnected until the session says otherwise) with a menu:
/// mute/unmute, the panels, and quit. Muting from the tray works without any panel (usable without a mouse
/// elsewhere: hotkeys; with a mouse: this).
pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let toggle = MenuItem::with_id(app, MENU_TOGGLE_MUTE, "Mute / unmute", true, None::<&str>)?;
    let roster = MenuItem::with_id(app, "open-roster", "Table", true, None::<&str>)?;
    let chat = MenuItem::with_id(app, "open-chat", "Chat", true, None::<&str>)?;
    let account = MenuItem::with_id(app, "open-account", "Account", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &roster, &chat, &account, &quit])?;
    let state = TrayState::Disconnected;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_image(state))
        .tooltip(state.tooltip())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_TOGGLE_MUTE => {
                crate::hotkeys::dispatch(app, crate::hotkeys::HotkeyAction::ToggleMute)
            }
            MENU_QUIT => app.exit(0),
            id if id.starts_with("open-") => {
                let _ = crate::windows::open(app, &id["open-".len()..]);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn icon_image(state: TrayState) -> tauri::image::Image<'static> {
    tauri::image::Image::new_owned(render_icon(state), ICON_SIZE, ICON_SIZE)
}

/// Shows `state` on the tray icon, if one is installed.
pub fn apply(app: &tauri::AppHandle, state: TrayState) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(Some(icon_image(state)));
        let _ = tray.set_tooltip(Some(state.tooltip()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disconnected_beats_everything() {
        for indicator in [Indicator::None, Indicator::Recording, Indicator::Paused] {
            assert_eq!(tray_state(false, false, indicator), TrayState::Disconnected);
        }
    }

    #[test]
    fn a_recording_is_shown_even_when_muted() {
        assert_eq!(
            tray_state(true, true, Indicator::Recording),
            TrayState::Recording
        );
        assert_eq!(
            tray_state(true, false, Indicator::Recording),
            TrayState::Recording
        );
        assert_eq!(tray_state(true, true, Indicator::Paused), TrayState::Paused);
    }

    #[test]
    fn muted_or_live_when_nothing_is_recording() {
        assert_eq!(tray_state(true, true, Indicator::None), TrayState::Muted);
        assert_eq!(tray_state(true, false, Indicator::None), TrayState::Live);
    }

    #[test]
    fn every_state_has_its_own_tooltip_and_icon() {
        let states = [
            TrayState::Disconnected,
            TrayState::Muted,
            TrayState::Live,
            TrayState::Recording,
            TrayState::Paused,
        ];
        for (i, a) in states.iter().enumerate() {
            for b in &states[i + 1..] {
                assert_ne!(a.tooltip(), b.tooltip());
                assert_ne!(render_icon(*a), render_icon(*b), "{a:?} vs {b:?}");
            }
        }
    }

    #[test]
    fn icons_are_the_right_size_and_not_blank() {
        let icon = render_icon(TrayState::Live);
        assert_eq!(icon.len(), (ICON_SIZE * ICON_SIZE * 4) as usize);
        assert!(icon.chunks(4).any(|p| p[3] == 0xff));
        assert!(
            icon.chunks(4).any(|p| p[3] == 0x00),
            "corners are transparent"
        );
    }

    #[test]
    fn recording_and_paused_differ_by_shape_not_only_by_state() {
        let centre = ((ICON_SIZE / 2) * ICON_SIZE + ICON_SIZE / 2) as usize * 4;
        assert_eq!(
            render_icon(TrayState::Recording)[centre + 3],
            0xff,
            "solid core"
        );
        assert_eq!(
            render_icon(TrayState::Paused)[centre + 3],
            0x00,
            "hollow core"
        );
    }
}
