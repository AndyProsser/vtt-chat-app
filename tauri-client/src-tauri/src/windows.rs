//! Panel windows: small local React pages, created when opened and destroyed when closed.
//!
//! Hidden is the default and costs nothing: no window exists while a panel is closed, so there is
//! no webview, no timer and no animation running (CLAUDE.md §2 principle 5, §8.1). Audio and the
//! consent flow never depend on a panel being open. A panel opens centred over the main window
//! (a transient child, so Wayland places it too), sized to fit the monitor it is on.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Which panel, its window title and its default size (logical pixels).
pub struct Panel {
    pub name: &'static str,
    pub title: &'static str,
    pub size: (f64, f64),
}

pub const PANELS: &[Panel] = &[
    Panel {
        name: "settings",
        title: "Settings — VTT Chat",
        size: (400.0, 460.0),
    },
    Panel {
        name: "handouts",
        title: "Handouts — VTT Chat",
        size: (420.0, 540.0),
    },
    Panel {
        name: "history",
        title: "Session history — VTT Chat",
        size: (460.0, 600.0),
    },
    Panel {
        name: "inventory",
        title: "Party inventory — VTT Chat",
        size: (400.0, 520.0),
    },
];

pub const MAIN_LABEL: &str = "main";

/// Shows the one main window, creating it if needed. It holds everything used during play (rail,
/// chat, mute, record state); the panels above are for occasional tasks only.
pub fn open_main(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut builder =
        WebviewWindowBuilder::new(app, MAIN_LABEL, WebviewUrl::App("index.html#main".into()))
            .title("VTT Chat")
            .visible(false)
            .inner_size(crate::main_layout::WIDTH, 720.0)
            .min_inner_size(380.0, 420.0);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).map_err(|e| e.to_string())?;
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    place_main(app, &window);
    show_when_ready(window);
    Ok(())
}

/// Sets the main window's size and position for this screen. The window-state plugin has already put back
/// where the player left it; that is kept only if it is still on screen and was saved under the current
/// layout version, otherwise the window gets the default (480 wide, the full usable height less 50 px at
/// each end, centred across the usable area). See `main_layout`.
fn place_main(app: &AppHandle, window: &tauri::WebviewWindow) {
    use crate::main_layout::{default_rect, fits, Rect, LAYOUT_VERSION};
    let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let logical = |p: &tauri::PhysicalPosition<i32>, s: &tauri::PhysicalSize<u32>| Rect {
        x: p.x as f64 / scale,
        y: p.y as f64 / scale,
        w: s.width as f64 / scale,
        h: s.height as f64 / scale,
    };
    let work = monitor.work_area();
    let area = logical(&work.position, &work.size);
    // On Linux the work area equals the monitor when the system cannot report its panels (Wayland).
    let bars_unknown = cfg!(target_os = "linux") && work.size == *monitor.size();

    let current = match (window.outer_position(), window.outer_size()) {
        (Ok(p), Ok(s)) => Some(logical(&p, &s)),
        _ => None,
    };
    let version_file = crate::account::data_dir(app).map(|d| d.join("window-layout.json"));
    let saved_version = version_file
        .as_ref()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| t.trim().parse::<u32>().ok());
    if saved_version == Some(LAYOUT_VERSION) && current.is_some_and(|c| fits(c, area)) {
        return;
    }

    let want = default_rect(area, bars_unknown);
    // `want` is the inner size; the title bar and borders come on top of it, so take them off the height to
    // make the whole window (not just its page) fit.
    let (extra_h, extra_w) = match (window.outer_size(), window.inner_size()) {
        (Ok(o), Ok(i)) => (
            (o.height as f64 - i.height as f64) / scale,
            (o.width as f64 - i.width as f64) / scale,
        ),
        _ => (0.0, 0.0),
    };
    let _ = window.set_size(tauri::LogicalSize::new(
        (want.w - extra_w).max(300.0),
        (want.h - extra_h).max(300.0),
    ));
    let _ = window.set_position(tauri::LogicalPosition::new(want.x, want.y));
    if let Some(file) = version_file {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(file, LAYOUT_VERSION.to_string());
    }
}

/// The window colour behind a page that is still loading; it matches the loading screen in index.html.
fn loading_colour(dark: bool) -> tauri::window::Color {
    if dark {
        tauri::window::Color(0x17, 0x14, 0x0f, 0xff)
    } else {
        tauri::window::Color(0xf4, 0xef, 0xe6, 0xff)
    }
}

/// How long a new window may stay hidden waiting for its page to say it has painted. If the page
/// never reports (a script error), the window appears anyway rather than staying invisible.
const READY_FALLBACK: std::time::Duration = std::time::Duration::from_millis(2500);

/// Windows are created hidden and shown by [`window_ready`] once the page has painted its first
/// frame, so nobody sees the blank webview that WebKit shows while it loads. The fallback timer
/// guarantees a window always appears.
fn show_when_ready(window: tauri::WebviewWindow) {
    opened_at()
        .lock()
        .unwrap()
        .insert(window.label().to_string(), std::time::Instant::now());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(READY_FALLBACK).await;
        if !window.is_visible().unwrap_or(true) {
            eprintln!(
                "[src-tauri] {} did not report ready in time; showing it anyway",
                window.label()
            );
            let _ = window.show();
        }
    });
}

fn opened_at() -> &'static std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>> {
    static OPENED: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>,
    > = std::sync::OnceLock::new();
    OPENED.get_or_init(Default::default)
}

/// Called by a page after its first paint: shows (and focuses) the calling window.
#[tauri::command]
pub fn window_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    if let Some(started) = opened_at().lock().unwrap().remove(window.label()) {
        // How long a window takes from "create" to "first frame painted": the delay a player feels.
        eprintln!(
            "[windows] {} ready in {} ms",
            window.label(),
            started.elapsed().as_millis()
        );
    }
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

/// The window size to ask for: the panel's own size, but at most 85% of the monitor's height and
/// 90% of its width, so a window never opens with its bottom edge off the screen.
fn fit_size(size: (f64, f64), screen: Option<(f64, f64)>) -> (f64, f64) {
    match screen {
        Some((w, h)) => (size.0.min(w * 0.9), size.1.min(h * 0.85)),
        None => size,
    }
}

pub fn panel(name: &str) -> Option<&'static Panel> {
    PANELS.iter().find(|p| p.name == name)
}

fn label(name: &str) -> String {
    format!("panel-{name}")
}

/// Shows the panel, creating it if needed. Unknown names are an error: the closed set is what the
/// capability file grants (`panel-*`).
pub fn open(app: &AppHandle, name: &str) -> Result<(), String> {
    let panel = panel(name).ok_or_else(|| format!("unknown panel: {name}"))?;
    open_page(app, &label(panel.name), panel.name, panel.title, panel.size)
}

/// An id that is safe to put in a window label and a URL: letters, digits, dash and underscore only.
pub fn is_plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The handout viewer's event: a new id to show in the window that is already open.
pub const HANDOUT_VIEW_EVENT: &str = "handout:view";

/// A window for one handout: the main window's handout cards open it. There is one viewer window; a second
/// card clicked shows its handout in the same window rather than piling up windows.
pub fn open_handout(app: &AppHandle, id: &str) -> Result<(), String> {
    use tauri::Emitter;
    if !is_plain_id(id) {
        return Err("not a handout id".into());
    }
    let label = label("handout");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.emit(HANDOUT_VIEW_EVENT, id);
    }
    open_page(
        app,
        &label,
        &format!("handout/{id}"),
        "Handout",
        (560.0, 720.0),
    )
}

#[tauri::command]
pub fn handout_view_open(app: AppHandle, id: String) -> Result<(), String> {
    open_handout(&app, &id)
}

fn open_page(
    app: &AppHandle,
    label: &str,
    route: &str,
    title: &str,
    size: (f64, f64),
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("index.html#{route}").into()),
    )
    .title(title);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).map_err(|e| e.to_string())?;
    }
    // Open over the main window, on the same monitor, and never taller or wider than that monitor.
    // Wayland ignores programmatic positions, so what places the window is the parent link (a
    // transient child is centred on its parent by the compositor); `center()` covers X11 and Windows.
    let main = app.get_webview_window(MAIN_LABEL);
    let screen = main
        .as_ref()
        .and_then(|m| m.current_monitor().ok().flatten())
        .map(|mon| {
            let scale = mon.scale_factor();
            (
                mon.size().width as f64 / scale,
                mon.size().height as f64 / scale,
            )
        });
    let size = fit_size(size, screen);
    if let Some(main) = &main {
        builder = builder.parent(main).map_err(|e| e.to_string())?;
    }
    // Shown at once, not after the first paint: a panel page takes a second or more to load, and a
    // window that appears after that pause feels like nothing happened. The page paints a loading
    // indicator the moment it can (index.html), and the window's own colour avoids a white flash.
    let dark = main
        .as_ref()
        .and_then(|m| m.theme().ok())
        .is_none_or(|t| t != tauri::Theme::Light);
    let window = builder
        .visible(true)
        .background_color(loading_colour(dark))
        .inner_size(size.0, size.1)
        .min_inner_size(260.0, 200.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    opened_at()
        .lock()
        .unwrap()
        .insert(window.label().to_string(), std::time::Instant::now());
    Ok(())
}

#[tauri::command]
pub fn panel_open(app: AppHandle, name: String) -> Result<(), String> {
    open(&app, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_ids_become_window_labels() {
        assert!(is_plain_id("a1b2-c3_d4"));
        assert!(!is_plain_id(""));
        assert!(!is_plain_id("../x"));
        assert!(!is_plain_id("a b"));
        assert!(!is_plain_id(&"x".repeat(65)));
    }

    #[test]
    fn a_window_is_never_taller_than_the_screen_allows() {
        assert_eq!(
            fit_size((400.0, 540.0), Some((1920.0, 1080.0))),
            (400.0, 540.0)
        );
        assert_eq!(
            fit_size((400.0, 540.0), Some((1280.0, 600.0))),
            (400.0, 510.0)
        );
        assert_eq!(
            fit_size((2000.0, 540.0), Some((1000.0, 1000.0))),
            (900.0, 540.0)
        );
        assert_eq!(fit_size((400.0, 540.0), None), (400.0, 540.0));
    }

    #[test]
    fn secondary_panels_are_exactly_the_closed_set() {
        let names: Vec<_> = PANELS.iter().map(|p| p.name).collect();
        assert_eq!(names, ["settings", "handouts", "history", "inventory"]);
        assert!(panel("chat").is_none());
        assert!(panel("main").is_none(), "main has its own opener");
        assert!(panel("../etc").is_none());
        for (i, a) in PANELS.iter().enumerate() {
            assert!(PANELS[i + 1..].iter().all(|b| b.name != a.name));
        }
    }
}
