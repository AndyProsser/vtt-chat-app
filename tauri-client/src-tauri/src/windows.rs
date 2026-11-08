//! Panel windows: small local React pages, created when opened and destroyed when closed.
//!
//! Hidden is the default and costs nothing: no window exists while a panel is closed, so there is
//! no webview, no timer and no animation running (CLAUDE.md §2 principle 5, §8.1). Audio and the
//! consent flow never depend on a panel being open. Position and size are remembered per panel by
//! the window-state plugin, keyed on the window label.

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
    let window = builder
        .visible(false)
        .inner_size(panel.size.0, panel.size.1)
        .min_inner_size(260.0, 200.0)
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
