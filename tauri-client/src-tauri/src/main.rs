#[cfg(target_os = "linux")]
mod egl_workaround;

fn main() {
    // Before anything touches WebKit/GTK — see egl_workaround.rs for the NVIDIA EGL crash.
    #[cfg(target_os = "linux")]
    egl_workaround::apply();

    vtt_chat_app_lib::run();
}
