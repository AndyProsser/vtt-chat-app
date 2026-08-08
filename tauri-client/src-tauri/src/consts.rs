/// Mirrors `ddb/src/consts/index.ts`'s `DDB_COBALT_COOKIE_NAME` — duplicated here since Rust
/// is confined to `tauri-client/` and can't import the TS `ddb/` package (CLAUDE.md §3).
pub const DDB_COBALT_COOKIE_NAME: &str = "CobaltSession";
/// `/characters`, not the bare domain — the marketing homepage's heavy hero/ad content
/// reliably segfaults WebKitGTK on at least one Linux+NVIDIA dev setup (reproduced in
/// Epiphany too, so it's a WebKitGTK issue, not app code); `/characters` and individual
/// character-sheet pages load fine and are the actual pages this app cares about anyway.
pub const DDB_URL: &str = "https://www.dndbeyond.com/characters";

pub const COBALT_COOKIE_POLL_INTERVAL_SECS: u64 = 3;
