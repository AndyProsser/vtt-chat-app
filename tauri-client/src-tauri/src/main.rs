// A release build on Windows is a GUI program: without this it is a console program and Windows opens a
// black cmd window beside the app. Debug builds keep the console so `cargo run` still prints its logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    use vtt_chat_app_lib::supervisor;
    let flag = |name: &str| std::env::var_os(name).is_some();
    if supervisor::should_supervise(
        flag(supervisor::CHILD_ENV),
        !cfg!(debug_assertions),
        flag(supervisor::FORCE_ENV),
        flag(supervisor::OPT_OUT_ENV),
    ) {
        let code = supervisor::run_supervised();
        if code >= 0 {
            std::process::exit(code);
        }
        // Could not supervise (no executable path): fall through and just run the app.
    }
    vtt_chat_app_lib::run();
}
