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
        size: (440.0, 580.0),
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
            .inner_size(460.0, 640.0)
            .min_inner_size(380.0, 420.0);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).map_err(|e| e.to_string())?;
    }
    builder.build().map_err(|e| e.to_string())?;
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
    builder
        .inner_size(panel.size.0, panel.size.1)
        .min_inner_size(260.0, 200.0)
        .build()
        .map_err(|e| e.to_string())?;
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
