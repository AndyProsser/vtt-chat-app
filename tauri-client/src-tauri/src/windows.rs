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
            .inner_size(460.0, 640.0)
            .min_inner_size(380.0, 420.0);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).map_err(|e| e.to_string())?;
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    show_when_ready(window);
    Ok(())
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
    let label = label(panel.name);
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(format!("index.html#{}", panel.name).into()),
    )
    .title(panel.title);
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
    let size = fit_size(panel.size, screen);
    if let Some(main) = &main {
        builder = builder.parent(main).map_err(|e| e.to_string())?;
    }
    let window = builder
        .visible(false)
        .inner_size(size.0, size.1)
        .min_inner_size(260.0, 200.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    show_when_ready(window);
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
        assert_eq!(names, ["settings", "handouts", "inventory"]);
        assert!(panel("chat").is_none());
        assert!(panel("main").is_none(), "main has its own opener");
        assert!(panel("../etc").is_none());
        for (i, a) in PANELS.iter().enumerate() {
            assert!(PANELS[i + 1..].iter().all(|b| b.name != a.name));
        }
    }
}
