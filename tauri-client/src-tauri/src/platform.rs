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
}

#[cfg(test)]
mod tests {
    use super::*;

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
