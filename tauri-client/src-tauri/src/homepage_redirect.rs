use base64::Engine;
use tauri::Url;

/// Native-level fallback for the WebKitGTK homepage crash (see safety_net.rs and
/// docs/superpowers/specs/2026-08-08-tracker-video-safety-net-design.md) — the JS mitigation
/// alone was confirmed insufficient (the crash trigger turned out not to be solely the
/// autoplaying video), so `lib.rs` intercepts navigation to the bare DDB homepage via
/// `on_navigation` and sends the window here instead, before the crash-prone page ever loads.
const PAGE_TEMPLATE: &str = r##"<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>VTT Chat App</title>
<style>
  html, body { margin: 0; height: 100%; font-family: -apple-system, sans-serif; }
  body {
    background-image: url('data:image/png;base64,__POSTER_B64__');
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .card {
    background: rgba(10, 8, 6, 0.78);
    color: #f5f0e6;
    padding: 2.5rem 3rem;
    border-radius: 12px;
    text-align: center;
    max-width: 32rem;
  }
  h1 { margin: 0 0 0.75rem; font-size: 1.75rem; }
  p { margin: 0.5rem 0; line-height: 1.5; }
  a {
    display: inline-block;
    margin-top: 1.25rem;
    padding: 0.6rem 1.4rem;
    background: #c0392b;
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 600;
  }
  a:hover { background: #a5281b; }
</style>
</head>
<body>
  <div class="card">
    <h1>Natural 1.</h1>
    <p>The D&amp;D Beyond homepage doesn't play nicely with this app on Linux yet, so we've sent you here instead.</p>
    <a href="https://www.dndbeyond.com/characters">Continue to your characters</a>
  </div>
</body>
</html>"##;

const POSTER_PNG: &[u8] = include_bytes!("../assets/homepage-redirect-poster.png");

pub fn url() -> Url {
    let poster_b64 = base64::engine::general_purpose::STANDARD.encode(POSTER_PNG);
    let html = PAGE_TEMPLATE.replace("__POSTER_B64__", &poster_b64);
    let html_b64 = base64::engine::general_purpose::STANDARD.encode(html.as_bytes());
    format!("data:text/html;base64,{html_b64}")
        .parse()
        .expect("constructed data: URL is always valid")
}

/// Matches the bare DDB marketing homepage: `www.dndbeyond.com` at `/` or a bare two-letter
/// locale path (DDB redirects `/` to `/en`, `/fr`, etc.) — not `/characters`, `/games/...`, or
/// any other real app page, which should navigate normally.
pub fn is_ddb_homepage(url: &Url) -> bool {
    let is_ddb_host = matches!(
        url.host_str(),
        Some("www.dndbeyond.com") | Some("dndbeyond.com")
    );
    if !is_ddb_host {
        return false;
    }
    let path = url.path();
    path == "/"
        || (path.len() == 3
            && path.starts_with('/')
            && path[1..].bytes().all(|b| b.is_ascii_lowercase()))
}
