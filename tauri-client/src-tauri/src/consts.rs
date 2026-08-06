/// Mirrors `ddb/src/consts/index.ts`'s `DDB_COBALT_COOKIE_NAME` — duplicated here since Rust
/// is confined to `tauri-client/` and can't import the TS `ddb/` package (CLAUDE.md §3).
pub const DDB_COBALT_COOKIE_NAME: &str = "CobaltSession";
pub const DDB_URL: &str = "https://www.dndbeyond.com/";

pub const COBALT_COOKIE_POLL_INTERVAL_SECS: u64 = 3;
