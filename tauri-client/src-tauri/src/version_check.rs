//! Does this app's version fit the server's? The rule is VERSIONING-AND-DEPLOYMENT.md §1: client and
//! server must match on MAJOR.MINOR and may drift on PATCH, and a pre-release suffix (`-dev.N`, `-rc.N`)
//! is ignored. This is a warning for the player, never a gate: nothing here can stop the app.

use serde::Serialize;
use tauri::State;

use crate::account::{normalise_server, AccountClient};
use crate::account_commands::AccountState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionRelation {
    /// Same MAJOR.MINOR and same patch.
    Match,
    /// Same MAJOR.MINOR, different patch or pre-release: fine, no warning.
    PatchDiffers,
    /// The app's MAJOR.MINOR is behind the server's.
    AppOlder,
    /// The app's MAJOR.MINOR is ahead of the server's.
    AppNewer,
    /// Either version could not be read (an old server has no `/api/version`).
    Unknown,
}

/// `MAJOR.MINOR.PATCH` with an optional `v` prefix and any `-pre` / `+build` suffix; `None` if not that.
fn parse(version: &str) -> Option<(u64, u64, u64)> {
    let core = version.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let mut next = || -> Option<u64> {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    let parsed = (next()?, next()?, next()?);
    parts.next().is_none().then_some(parsed)
}

/// Compares by MAJOR.MINOR. Pure, so every rule is a unit test.
pub fn compare_versions(app: &str, server: &str) -> VersionRelation {
    let (Some(a), Some(s)) = (parse(app), parse(server)) else {
        return VersionRelation::Unknown;
    };
    match (a.0, a.1).cmp(&(s.0, s.1)) {
        std::cmp::Ordering::Less => VersionRelation::AppOlder,
        std::cmp::Ordering::Greater => VersionRelation::AppNewer,
        std::cmp::Ordering::Equal if app.trim() == server.trim() => VersionRelation::Match,
        std::cmp::Ordering::Equal => VersionRelation::PatchDiffers,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionCheck {
    pub app_version: String,
    pub server_version: Option<String>,
    pub relation: VersionRelation,
}

fn result(server_version: Option<String>) -> VersionCheck {
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let relation = server_version
        .as_deref()
        .map_or(VersionRelation::Unknown, |s| {
            compare_versions(&app_version, s)
        });
    VersionCheck {
        app_version,
        server_version,
        relation,
    }
}

/// Asks the server (the saved one, or `server` for the signed-out screen) for its version. Any failure
/// is `unknown`: this never returns an error.
#[tauri::command]
pub async fn server_version_check(
    accounts: State<'_, AccountState>,
    server: Option<String>,
) -> Result<VersionCheck, ()> {
    let target = match server.filter(|s| !s.trim().is_empty()) {
        Some(s) => normalise_server(&s).ok(),
        None => accounts.server().await,
    };
    let version = match target {
        Some(base) => AccountClient::new(&base).server_version().await,
        None => None,
    };
    Ok(result(version))
}

#[cfg(test)]
mod tests {
    use super::VersionRelation::*;
    use super::*;

    #[test]
    fn older_app_by_minor() {
        assert_eq!(compare_versions("0.3.2", "0.4.0-dev.1"), AppOlder);
    }

    #[test]
    fn newer_app_by_minor() {
        assert_eq!(compare_versions("0.5.1", "0.4.9"), AppNewer);
    }

    #[test]
    fn major_dominates_minor() {
        assert_eq!(compare_versions("1.0.0", "0.9.0"), AppNewer);
        assert_eq!(compare_versions("0.9.0", "1.0.0"), AppOlder);
        assert_eq!(compare_versions("1.2.0", "1.3.0"), AppOlder);
    }

    #[test]
    fn prerelease_and_patch_are_not_a_warning() {
        assert_eq!(compare_versions("0.4.0", "0.4.0-dev.2"), PatchDiffers);
        assert_eq!(compare_versions("0.4.1", "0.4.0"), PatchDiffers);
        assert_eq!(compare_versions("0.4.0-dev.1", "0.4.7"), PatchDiffers);
        assert_eq!(compare_versions("0.4.0-rc.1", "0.4.0-dev.9"), PatchDiffers);
    }

    #[test]
    fn identical_is_a_match() {
        assert_eq!(compare_versions("0.4.0", "0.4.0"), Match);
        assert_eq!(compare_versions("0.4.0-dev.1", "0.4.0-dev.1"), Match);
    }

    #[test]
    fn tolerates_v_prefix_build_metadata_and_whitespace() {
        assert_eq!(compare_versions("v0.4.0", "0.4.0"), PatchDiffers);
        assert_eq!(compare_versions("0.4.0+abc", "0.4.0\n"), PatchDiffers);
        assert_eq!(compare_versions("0.3.0", " 0.4.0 "), AppOlder);
    }

    #[test]
    fn junk_is_unknown() {
        for junk in [
            "", "banana", "0.4", "0.4.x", "1.2.3.4", "-1.0.0", "0..1", "<html>",
        ] {
            assert_eq!(compare_versions("0.4.0", junk), Unknown, "{junk}");
            assert_eq!(compare_versions(junk, "0.4.0"), Unknown, "{junk}");
        }
        assert_eq!(compare_versions("", ""), Unknown);
    }

    #[test]
    fn app_version_itself_parses() {
        assert!(parse(env!("CARGO_PKG_VERSION")).is_some());
    }

    #[test]
    fn no_server_version_is_unknown() {
        let r = result(None);
        assert_eq!(r.relation, Unknown);
        assert_eq!(r.server_version, None);
    }

    #[test]
    fn serialises_camel_case() {
        let json = serde_json::to_value(result(Some("0.0.1".into()))).unwrap();
        assert_eq!(json["relation"], "appNewer");
        assert!(json["appVersion"].is_string());
        assert_eq!(json["serverVersion"], "0.0.1");
    }
}
