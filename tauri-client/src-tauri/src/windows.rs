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
        name: "account",
        title: "Sign in — VTT Chat",
        size: (380.0, 460.0),
    },
    Panel {
        name: "roster",
        title: "Table — VTT Chat",
        size: (320.0, 480.0),
    },
    Panel {
        name: "handouts",
        title: "Handouts — VTT Chat",
        size: (400.0, 520.0),
    },
    Panel {
        name: "loot",
        title: "Loot — VTT Chat",
        size: (340.0, 460.0),
    },
    Panel {
        name: "schedule",
        title: "Sessions — VTT Chat",
        size: (360.0, 520.0),
    },
    Panel {
        name: "soundboard",
        title: "Soundboard — VTT Chat",
        size: (380.0, 520.0),
    },
    Panel {
        name: "parties",
        title: "Voice groups — VTT Chat",
        size: (340.0, 460.0),
    },
    Panel {
        name: "recording",
        title: "Recording — VTT Chat",
        size: (320.0, 300.0),
    },
    Panel {
        name: "chat",
        title: "Chat — VTT Chat",
        size: (380.0, 520.0),
    },
];

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
    fn only_known_panels_open_and_names_are_unique() {
        assert!(panel("chat").is_some());
        assert!(panel("../etc").is_none());
        for (i, a) in PANELS.iter().enumerate() {
            assert!(PANELS[i + 1..].iter().all(|b| b.name != a.name));
        }
    }
}
