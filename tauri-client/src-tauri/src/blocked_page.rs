use base64::Engine;
use tauri::Url;

/// Builds the self-contained `data:` URL pages the shell sends a window to when it cancels a
/// navigation. Two callers need this with different copy — `homepage_redirect.rs` (WebKitGTK
/// crash avoidance) and `allowlist.rs`'s enforcement in `lib.rs` (page restriction) — so the
/// template lives here parameterized rather than being duplicated per call site.
///
/// Everything is embedded: the poster is `include_bytes!`d at compile time and base64'd in, so
/// there is no asset-serving pipeline to fail at runtime and no network fetch from a page whose
/// whole purpose is that navigation was blocked.
const PAGE_TEMPLATE: &str = r##"<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>__TITLE__</title>
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
  .detail {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    opacity: 0.7;
    word-break: break-all;
  }
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
    <h1>__HEADING__</h1>
    <p>__MESSAGE__</p>
    __DETAIL__
    <a href="__LINK_URL__">__LINK_LABEL__</a>
  </div>
</body>
</html>"##;

const POSTER_PNG: &[u8] = include_bytes!("../assets/homepage-redirect-poster.png");

/// Copy for one blocked-navigation page. All fields are HTML-escaped when rendered.
pub struct BlockedPage<'a> {
    pub title: &'a str,
    pub heading: &'a str,
    pub message: &'a str,
    /// Optional secondary line, rendered in monospace — used to show the URL that was blocked.
    pub detail: Option<String>,
    pub link_url: &'a str,
    pub link_label: &'a str,
}

pub fn url(page: &BlockedPage) -> Url {
    let poster_b64 = base64::engine::general_purpose::STANDARD.encode(POSTER_PNG);
    let detail_html = match &page.detail {
        Some(detail) => format!("<p class=\"detail\">{}</p>", escape_html(detail)),
        None => String::new(),
    };

    let html = PAGE_TEMPLATE
        .replace("__TITLE__", &escape_html(page.title))
        .replace("__POSTER_B64__", &poster_b64)
        .replace("__HEADING__", &escape_html(page.heading))
        .replace("__MESSAGE__", &escape_html(page.message))
        .replace("__DETAIL__", &detail_html)
        .replace("__LINK_URL__", &escape_html(page.link_url))
        .replace("__LINK_LABEL__", &escape_html(page.link_label));

    let html_b64 = base64::engine::general_purpose::STANDARD.encode(html.as_bytes());
    format!("data:text/html;base64,{html_b64}")
        .parse()
        .expect("constructed data: URL is always valid")
}

/// Escapes text interpolated into the template. Most copy here is static, but the blocked-URL
/// detail line is attacker-influenced — a page can trigger navigation to any URL it likes, and
/// that URL is echoed back into this page's markup.
fn escape_html(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_html_metacharacters() {
        assert_eq!(
            escape_html(r#"<script>alert("x" & 'y')</script>"#),
            "&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;"
        );
    }

    #[test]
    fn leaves_ordinary_text_untouched() {
        assert_eq!(
            escape_html("https://example.com/a-b_c"),
            "https://example.com/a-b_c"
        );
    }

    #[test]
    fn builds_a_data_url() {
        let page = BlockedPage {
            title: "t",
            heading: "h",
            message: "m",
            detail: None,
            link_url: "https://www.dndbeyond.com/characters",
            link_label: "go",
        };
        let url = url(&page);
        assert_eq!(url.scheme(), "data");
    }

    /// A blocked URL containing markup must not be able to inject into the page that reports it.
    #[test]
    fn detail_is_escaped_into_the_document() {
        let page = BlockedPage {
            title: "t",
            heading: "h",
            message: "m",
            detail: Some("https://evil.test/<script>".into()),
            link_url: "https://www.dndbeyond.com/characters",
            link_label: "go",
        };
        let url = url(&page);
        let encoded = url.as_str().trim_start_matches("data:text/html;base64,");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("page body is valid base64");
        let html = String::from_utf8(decoded).expect("page body is valid utf-8");

        assert!(html.contains("&lt;script&gt;"));
        assert!(!html.contains("<script>"));
    }
}
