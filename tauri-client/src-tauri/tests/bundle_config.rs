//! What the operating system shows for the app: its name (Windows Task Manager, the Linux menu, the macOS
//! Dock) and its icon (taskbars, the tray, the process list). Both come from `tauri.conf.json`.

use std::path::Path;

fn conf() -> serde_json::Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn the_app_is_called_vtt_chat() {
    // Windows reads its Task Manager name from this, Linux its menu entry, macOS the app bundle.
    assert_eq!(conf()["productName"], "VTT Chat");
}

#[test]
fn every_bundle_icon_exists_and_each_platform_has_its_format() {
    let conf = conf();
    let icons: Vec<&str> = conf["bundle"]["icon"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    for icon in &icons {
        let file = Path::new(env!("CARGO_MANIFEST_DIR")).join(icon);
        assert!(file.exists(), "{icon} is listed but missing");
    }
    assert!(icons.iter().any(|i| i.ends_with(".ico")), "Windows needs an .ico");
    assert!(icons.iter().any(|i| i.ends_with(".icns")), "macOS needs an .icns");
    assert!(
        icons.iter().any(|i| i.contains("128x128")),
        "Linux launchers need PNGs of several sizes"
    );
    // The first PNG is the one used for windows, so it must be a large one.
    assert_eq!(icons[0], "icons/icon-256.png");
}

#[test]
fn linux_launchers_file_it_under_a_menu_category() {
    assert!(conf()["bundle"]["category"].is_string());
}
