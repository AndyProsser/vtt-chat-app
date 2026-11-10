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

    /// Badge colour (RGB). Paused is also hollow, so it differs from recording by shape.
    fn colour(self) -> [u8; 3] {
        match self {
            Self::Disconnected => [0x8a, 0x8f, 0x98],
            Self::Muted => [0xe0, 0xa1, 0x2b],
            Self::Live => [0x2e, 0xb8, 0x6c],
            Self::Recording => [0xe5, 0x39, 0x35],
            Self::Paused => [0xe5, 0x39, 0x35],
        }
    }
}

pub const ICON_SIZE: u32 = 64;

/// Badge geometry: a disc in the bottom-right corner with a dark outline so it reads on any panel.
const BADGE_RADIUS: f32 = 13.0;
const BADGE_OUTLINE: f32 = 2.0;
const OUTLINE_COLOUR: [u8; 3] = [0x20, 0x20, 0x20];

/// Box-filter downscale of square RGBA `from`×`from` to `to`×`to` (`from` a multiple of `to`).
/// Premultiplied while averaging so transparent pixels do not bleed their colour into the edge.
fn downscale(rgba: &[u8], from: u32, to: u32) -> Vec<u8> {
    let k = (from / to) as usize;
    let (from, to) = (from as usize, to as usize);
    let mut out = vec![0u8; to * to * 4];
    for y in 0..to {
        for x in 0..to {
            let (mut r, mut g, mut b, mut a) = (0u32, 0u32, 0u32, 0u32);
            for dy in 0..k {
                for dx in 0..k {
                    let i = ((y * k + dy) * from + x * k + dx) * 4;
                    let alpha = rgba[i + 3] as u32;
                    r += rgba[i] as u32 * alpha;
                    g += rgba[i + 1] as u32 * alpha;
                    b += rgba[i + 2] as u32 * alpha;
                    a += alpha;
                }
            }
            let o = (y * to + x) * 4;
            if let (Some(r), Some(g), Some(b)) =
                (r.checked_div(a), g.checked_div(a), b.checked_div(a))
            {
                out[o] = r as u8;
                out[o + 1] = g as u8;
                out[o + 2] = b as u8;
            }
            out[o + 3] = (a / (k * k) as u32) as u8;
        }
    }
    out
}

/// The app logo at tray size, decoded once.
fn logo() -> &'static [u8] {
    static LOGO: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    LOGO.get_or_init(|| {
        let image = tauri::image::Image::from_bytes(include_bytes!("../icons/icon-256.png"))
            .expect("the bundled tray logo is a valid PNG");
        downscale(image.rgba(), image.width(), ICON_SIZE)
    })
}

/// The logo with a status badge bottom-right (like a file-sync client's tray icon): green live,
/// amber muted, red recording, red ring paused, grey badge on a greyed logo when disconnected.
pub fn render_icon(state: TrayState) -> Vec<u8> {
    let mut pixels = logo().to_vec();
    if state == TrayState::Disconnected {
        for p in pixels.as_chunks_mut::<4>().0.iter_mut() {
            let grey = (p[0] as u32 * 30 + p[1] as u32 * 59 + p[2] as u32 * 11) / 100;
            p[..3].fill(grey as u8);
        }
    }
    let [r, g, b] = state.colour();
    let centre = (ICON_SIZE - 14) as f32;
    for y in 0..ICON_SIZE {
        for x in 0..ICON_SIZE {
            let d = ((x as f32 - centre).powi(2) + (y as f32 - centre).powi(2)).sqrt();
            if d > BADGE_RADIUS {
                continue;
            }
            let hollow = state == TrayState::Paused && d <= 5.0;
            let colour = if d > BADGE_RADIUS - BADGE_OUTLINE || hollow {
                OUTLINE_COLOUR
            } else {
                [r, g, b]
            };
            let i = ((y * ICON_SIZE + x) * 4) as usize;
            pixels[i..i + 4].copy_from_slice(&[colour[0], colour[1], colour[2], 0xff]);
        }
    }
    pixels
}

// --- Tauri glue --------------------------------------------------------------------------------

const TRAY_ID: &str = "main";
const MENU_TOGGLE_MUTE: &str = "toggle_mute";
const MENU_QUIT: &str = "quit";
const MENU_SHOW: &str = "show";
const MENU_ONLINE: &str = "status_online";
const MENU_AWAY: &str = "status_away";
const MENU_OFFLINE: &str = "status_offline";

/// The labels and enabled state of the tray menu for a given status and mute. Pure, so it is testable:
/// the mute item reads "Mute" or "Unmute" and is disabled while Offline (there is no voice to mute).
#[derive(Debug, PartialEq, Eq)]
pub struct MenuSpec {
    pub mute_label: &'static str,
    pub mute_enabled: bool,
}

pub fn menu_spec(status: crate::status::Status, user_muted: bool) -> MenuSpec {
    MenuSpec {
        mute_label: if user_muted { "Unmute" } else { "Mute" },
        mute_enabled: status != crate::status::Status::Offline,
    }
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use crate::status::Status;
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
    use tauri::Manager;

    let status = crate::status_commands::current(app);
    let spec = menu_spec(status, app.state::<crate::mic_gate::MicGate>().user_muted());
    let show = MenuItem::with_id(app, MENU_SHOW, "Show VTT Chat", true, None::<&str>)?;
    let item = |id: &str, label: &str, mine: Status| {
        CheckMenuItem::with_id(app, id, label, true, status == mine, None::<&str>)
    };
    let online = item(MENU_ONLINE, "Online", Status::Online)?;
    let away = item(MENU_AWAY, "Away", Status::Away)?;
    let offline = item(MENU_OFFLINE, "Offline", Status::Offline)?;
    let label = match status {
        Status::Online => "Status: Online",
        Status::Away => "Status: Away",
        Status::Offline => "Status: Offline",
    };
    let status_menu = Submenu::with_items(app, label, true, &[&online, &away, &offline])?;
    let mute = MenuItem::with_id(
        app,
        MENU_TOGGLE_MUTE,
        spec.mute_label,
        spec.mute_enabled,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    Menu::with_items(app, &[&show, &status_menu, &mute, &separator, &quit])
}

/// Rebuilds the menu from the current status and mute. Cheap, and only called when one of them changes.
pub fn refresh_menu(app: &tauri::AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(menu) = build_menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// Creates the tray icon (disconnected until the session says otherwise) with a menu: show the window,
/// the status (Online, Away, Offline), mute or unmute, and quit. Muting from the tray works without any
/// panel.
pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::tray::TrayIconBuilder;

    let menu = build_menu(app)?;
    let state = TrayState::Disconnected;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_image(state))
        .tooltip(state.tooltip())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_TOGGLE_MUTE => {
                crate::hotkeys::dispatch(app, crate::hotkeys::HotkeyAction::ToggleMute)
            }
            MENU_SHOW => {
                let _ = crate::windows::open_main(app);
            }
            MENU_ONLINE => {
                crate::status_commands::apply_from_menu(app, crate::status::Status::Online)
            }
            MENU_AWAY => crate::status_commands::apply_from_menu(app, crate::status::Status::Away),
            MENU_OFFLINE => {
                crate::status_commands::apply_from_menu(app, crate::status::Status::Offline)
            }
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = crate::windows::open_main(tray.app_handle());
            }
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
    fn the_mute_item_follows_the_mute_and_is_off_while_offline() {
        use crate::status::Status::{Away, Offline, Online};
        assert_eq!(
            menu_spec(Online, false),
            MenuSpec {
                mute_label: "Mute",
                mute_enabled: true
            }
        );
        assert_eq!(menu_spec(Away, true).mute_label, "Unmute");
        assert!(menu_spec(Away, true).mute_enabled);
        assert!(!menu_spec(Offline, true).mute_enabled);
    }

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

    fn pixel(icon: &[u8], x: u32, y: u32) -> [u8; 4] {
        let i = ((y * ICON_SIZE + x) * 4) as usize;
        [icon[i], icon[i + 1], icon[i + 2], icon[i + 3]]
    }

    /// The badge sits bottom-right; its centre is where the status colour shows.
    const BADGE: (u32, u32) = (ICON_SIZE - 14, ICON_SIZE - 14);

    #[test]
    fn the_badge_shows_each_states_colour() {
        for (state, [r, g, b]) in [
            (TrayState::Live, [0x2e, 0xb8, 0x6c]),
            (TrayState::Muted, [0xe0, 0xa1, 0x2b]),
            (TrayState::Recording, [0xe5, 0x39, 0x35]),
            (TrayState::Disconnected, [0x8a, 0x8f, 0x98]),
        ] {
            assert_eq!(
                pixel(&render_icon(state), BADGE.0, BADGE.1),
                [r, g, b, 0xff],
                "{state:?}"
            );
        }
    }

    #[test]
    fn a_paused_badge_is_hollow_where_recording_is_solid() {
        let paused = pixel(&render_icon(TrayState::Paused), BADGE.0, BADGE.1);
        let recording = pixel(&render_icon(TrayState::Recording), BADGE.0, BADGE.1);
        assert_ne!(paused, recording);
        assert_eq!(
            paused,
            [0x20, 0x20, 0x20, 0xff],
            "hollow shows the outline colour"
        );
    }

    #[test]
    fn a_disconnected_logo_is_grey() {
        let icon = render_icon(TrayState::Disconnected);
        let mut checked = 0;
        for y in 0..ICON_SIZE {
            for x in 0..ICON_SIZE {
                let (dx, dy) = (x as f32 - BADGE.0 as f32, y as f32 - BADGE.1 as f32);
                if (dx * dx + dy * dy).sqrt() < 16.0 {
                    continue; // the badge and its outline
                }
                let [r, g, b, a] = pixel(&icon, x, y);
                if a == 0xff {
                    assert!(r == g && g == b, "({x},{y}) is coloured: {r},{g},{b}");
                    checked += 1;
                }
            }
        }
        assert!(checked > 100, "the logo should cover plenty of pixels");
    }

    #[test]
    fn a_live_logo_keeps_its_colour() {
        let icon = render_icon(TrayState::Live);
        let coloured = icon
            .chunks(4)
            .any(|p| p[3] == 0xff && !(p[0] == p[1] && p[1] == p[2]) && p[0] > 150 && p[1] < 80);
        assert!(
            coloured,
            "the dragon's red/orange should survive downscaling"
        );
    }
}
