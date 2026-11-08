//! Start-up fixes for platform quirks that would otherwise kill the app before it shows anything.

/// Environment variables to set before any webview exists, given whether we are on Linux and which
/// variables the user already set (a user's own value always wins).
pub fn webkit_env_fixes(
    linux: bool,
    is_set: impl Fn(&str) -> bool,
) -> Vec<(&'static str, &'static str)> {
    let mut fixes = Vec::new();
    if linux && !is_set("WEBKIT_DISABLE_DMABUF_RENDERER") {
        fixes.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"));
    }
    fixes
}

/// Inside an AppImage, where WebKitGTK looks for its helper processes. The bundler patches WebKit's
/// built-in path to a relative one that does not exist on distros which keep the helpers under
/// `lib/<triplet>/webkit2gtk-4.1` (Debian, Ubuntu), so the first window dies with "Unable to spawn a
/// new child process: WebKitNetworkProcess". Pointing `WEBKIT_EXEC_PATH` at the bundled copy fixes it.
pub fn appimage_webkit_exec_path(
    appdir: Option<&str>,
    exists: impl Fn(&std::path::Path) -> bool,
) -> Option<std::path::PathBuf> {
    let base = std::path::Path::new(appdir?);
    [
        "usr/lib/x86_64-linux-gnu/webkit2gtk-4.1",
        "usr/lib/aarch64-linux-gnu/webkit2gtk-4.1",
        "usr/lib/webkit2gtk-4.1",
    ]
    .into_iter()
    .map(|rel| base.join(rel))
    .find(|dir| exists(&dir.join("WebKitNetworkProcess")))
}

/// Applies [`webkit_env_fixes`] to this process. Call first in `run()`, before any thread starts:
/// on NVIDIA GPUs under Wayland the dmabuf renderer makes the first webview die with
/// `Gdk Error 71 (Protocol error)`.
pub fn apply_platform_fixes() {
    let fixes = webkit_env_fixes(cfg!(target_os = "linux"), |name| {
        std::env::var_os(name).is_some()
    });
    for (name, value) in fixes {
        std::env::set_var(name, value);
    }
    if cfg!(target_os = "linux") && std::env::var_os("WEBKIT_EXEC_PATH").is_none() {
        let appdir = std::env::var("APPDIR").ok();
        if let Some(dir) = appimage_webkit_exec_path(appdir.as_deref(), |p| p.exists()) {
            std::env::set_var("WEBKIT_EXEC_PATH", &dir);
            let injected = dir.join("injected-bundle");
            if injected.exists() && std::env::var_os("WEBKIT_INJECTED_BUNDLE_PATH").is_none() {
                std::env::set_var("WEBKIT_INJECTED_BUNDLE_PATH", injected);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_bundled_webkit_helpers_only_inside_an_appimage() {
        let helper = "/tmp/app/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess";
        let found = appimage_webkit_exec_path(Some("/tmp/app"), |p| p.to_str() == Some(helper));
        assert_eq!(
            found.as_deref(),
            Some(std::path::Path::new(
                "/tmp/app/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"
            ))
        );
        assert_eq!(
            appimage_webkit_exec_path(None, |_| true),
            None,
            "not an AppImage"
        );
        assert_eq!(
            appimage_webkit_exec_path(Some("/tmp/app"), |_| false),
            None,
            "no helper bundled"
        );
    }

    #[test]
    fn no_fixes_off_linux() {
        assert!(webkit_env_fixes(false, |_| false).is_empty());
    }

    #[test]
    fn respects_a_value_the_user_set() {
        assert!(webkit_env_fixes(true, |name| name == "WEBKIT_DISABLE_DMABUF_RENDERER").is_empty());
    }

    #[test]
    fn sets_the_dmabuf_workaround_on_linux() {
        assert_eq!(
            webkit_env_fixes(true, |_| false),
            vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]
        );
    }
}
