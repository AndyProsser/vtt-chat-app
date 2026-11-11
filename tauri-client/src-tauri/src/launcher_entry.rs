//! A menu entry and icon for the AppImage. An AppImage is a single file the desktop knows nothing about,
//! so without this GNOME and KDE show a generic icon in the dock and no entry in the application menu.
//! The `.deb` and `.rpm` install their own entry and icons, so this only runs when the app was started
//! from an AppImage (the runtime sets `APPIMAGE`). It writes into the user's own data folder, never
//! system folders, and rewrites the entry if the AppImage has been moved.

use std::io;
use std::path::Path;

/// Matches the window class the app reports (the binary name), which is how the dock finds this entry.
const NAME: &str = "vtt-chat-app";

fn quote_exec(path: &str) -> String {
    let escaped: String = path
        .chars()
        .flat_map(|c| match c {
            '"' | '`' | '$' | '\\' => vec!['\\', c],
            _ => vec![c],
        })
        .collect();
    format!("\"{escaped}\"")
}

/// The `.desktop` text for an AppImage at `appimage`.
pub fn desktop_entry(appimage: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=VTT Chat\n\
         Comment=Voice, chat and session records for tabletop groups\n\
         Exec={} %u\n\
         Icon={NAME}\n\
         Terminal=false\n\
         Categories=Network;Chat;\n\
         StartupWMClass={NAME}\n\
         MimeType=x-scheme-handler/vtt-chat;\n",
        quote_exec(appimage)
    )
}

/// Writes the entry and icon under `data_dir` (`~/.local/share`). Returns whether anything changed.
pub fn install(data_dir: &Path, appimage: &str, icon_png: &[u8]) -> io::Result<bool> {
    let entry = data_dir
        .join("applications")
        .join(format!("{NAME}.desktop"));
    let icon = data_dir
        .join("icons/hicolor/256x256/apps")
        .join(format!("{NAME}.png"));
    let wanted = desktop_entry(appimage);
    let mut changed = false;
    if std::fs::read_to_string(&entry).ok().as_deref() != Some(wanted.as_str()) {
        std::fs::create_dir_all(entry.parent().unwrap())?;
        std::fs::write(&entry, wanted)?;
        changed = true;
    }
    if std::fs::read(&icon).ok().as_deref() != Some(icon_png) {
        std::fs::create_dir_all(icon.parent().unwrap())?;
        std::fs::write(&icon, icon_png)?;
        changed = true;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("vtt-entry-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        dir
    }

    #[test]
    fn the_entry_points_at_the_appimage_and_the_icon_and_matches_the_window_class() {
        let text = desktop_entry("/home/me/Apps/VTT Chat.AppImage");
        assert!(text.contains("Exec=\"/home/me/Apps/VTT Chat.AppImage\" %u"));
        assert!(text.contains("Icon=vtt-chat-app"));
        assert!(text.contains("StartupWMClass=vtt-chat-app"));
        assert!(text.contains("Name=VTT Chat\n"));
    }

    #[test]
    fn awkward_characters_in_the_path_are_escaped() {
        assert!(desktop_entry("/a/$b\"c").contains("Exec=\"/a/\\$b\\\"c\" %u"));
    }

    #[test]
    fn it_writes_once_then_leaves_things_alone_until_the_appimage_moves() {
        let dir = temp("write");
        assert!(install(&dir, "/a/App.AppImage", b"png").unwrap());
        assert!(dir.join("applications/vtt-chat-app.desktop").exists());
        assert!(dir
            .join("icons/hicolor/256x256/apps/vtt-chat-app.png")
            .exists());
        assert!(!install(&dir, "/a/App.AppImage", b"png").unwrap());
        assert!(install(&dir, "/b/App.AppImage", b"png").unwrap());
        let text = std::fs::read_to_string(dir.join("applications/vtt-chat-app.desktop")).unwrap();
        assert!(text.contains("/b/App.AppImage"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
