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
