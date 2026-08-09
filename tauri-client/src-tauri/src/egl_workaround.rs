//! Points WebKitGTK at Mesa's EGL vendor library on NVIDIA 580-branch systems.
//!
//! `WebKitWebProcess` segfaults inside `libnvidia-eglcore` (reached via `libEGL_nvidia` from
//! `libwebkit2gtk-4.1`) while compositing pages that play video. This is the root cause behind
//! the "unconfirmed" WebKitGTK crash noted in `consts.rs`, `safety_net.rs` and
//! `homepage_redirect.rs` — and it explains why the JS-level video mitigation was never enough:
//! the trigger is the EGL compositing path, not the `<video>` element itself.
//!
//! Bisected 2026-08-09 against WebKitGTK 2.52.3 / NVIDIA 580.173.02 / GTX 1080 (Pascal) on
//! Wayland, reproduced in stock `MiniBrowser` so it is not app code. Of the toggles tried
//! (`WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE`,
//! `WEBKIT_GST_DISABLE_GL_SINK`, `WEBKIT_SKIA_ENABLE_CPU_RENDERING`, `GDK_BACKEND=x11`,
//! deranking the NVDEC decoder, disabling the NVIDIA shader cache) only selecting a different
//! EGL vendor library avoided the crash. Hardware video *decoding* is unaffected — GStreamer
//! still picks `nvvp9dec`; only WebKit's GL compositing falls back to llvmpipe.
//!
//! Scoped to the 580 branch on purpose: it is the last branch supporting Maxwell/Pascal/Volta,
//! so affected machines cannot upgrade past it. Newer branches are presumed healthy until shown
//! otherwise — if a 580 point release ships a fix, narrow `AFFECTED_DRIVER_PREFIX` or drop this
//! module. Setting `__EGL_VENDOR_LIBRARY_FILENAMES` yourself disables the workaround.

const EGL_VENDOR_ENV: &str = "__EGL_VENDOR_LIBRARY_FILENAMES";
const MESA_EGL_VENDOR: &str = "/usr/share/glvnd/egl_vendor.d/50_mesa.json";
const NVIDIA_DRIVER_VERSION_FILE: &str = "/sys/module/nvidia/version";
const AFFECTED_DRIVER_PREFIX: &str = "580.";

/// Pure decision core, kept separate from the filesystem/env reads so it can be tested.
fn should_apply(
    existing_override: Option<&str>,
    driver_version: Option<&str>,
    mesa_vendor_present: bool,
) -> bool {
    if existing_override.is_some() || !mesa_vendor_present {
        return false;
    }
    driver_version.is_some_and(|version| version.trim_start().starts_with(AFFECTED_DRIVER_PREFIX))
}

/// Must run before any WebKit/GTK initialisation — the vendor library is resolved once, when
/// libglvnd first loads EGL, so setting this later has no effect.
pub fn apply() {
    let existing_override = std::env::var(EGL_VENDOR_ENV).ok();
    let driver_version = std::fs::read_to_string(NVIDIA_DRIVER_VERSION_FILE).ok();
    let mesa_vendor_present = std::path::Path::new(MESA_EGL_VENDOR).exists();

    if !should_apply(
        existing_override.as_deref(),
        driver_version.as_deref(),
        mesa_vendor_present,
    ) {
        return;
    }

    // Safe in edition 2021; becomes `unsafe` in edition 2024. Single-threaded here, pre-Tauri.
    std::env::set_var(EGL_VENDOR_ENV, MESA_EGL_VENDOR);
    eprintln!(
        "[src-tauri] NVIDIA {} detected; using Mesa EGL to avoid the libnvidia-eglcore video \
         crash (hardware video decoding is unaffected)",
        driver_version.as_deref().unwrap_or("").trim()
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_on_affected_driver() {
        assert!(should_apply(None, Some("580.173.02\n"), true));
    }

    #[test]
    fn respects_an_existing_user_override() {
        assert!(!should_apply(
            Some("/some/other/vendor.json"),
            Some("580.173.02\n"),
            true
        ));
    }

    #[test]
    fn skips_unaffected_driver_branches() {
        assert!(!should_apply(None, Some("595.10\n"), true));
        assert!(!should_apply(None, Some("570.86.16\n"), true));
    }

    /// `5801.x` must not be mistaken for the 580 branch.
    #[test]
    fn does_not_match_a_longer_branch_number_by_prefix() {
        assert!(!should_apply(None, Some("5801.02\n"), true));
    }

    #[test]
    fn skips_when_no_nvidia_driver_is_loaded() {
        assert!(!should_apply(None, None, true));
    }

    #[test]
    fn skips_when_mesa_vendor_library_is_missing() {
        assert!(!should_apply(None, Some("580.173.02\n"), false));
    }
}
