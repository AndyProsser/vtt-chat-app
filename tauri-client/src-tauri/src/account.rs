//! Account and server settings for the signed-in player, owned by Rust.
//!
//! Why Rust and not the panels: the webview's CSP allows no remote origin (CLAUDE.md §8.1), so a
//! panel cannot `fetch` the server. A panel asks Rust to sign in; Rust talks to the backend, keeps
//! the session token, and on the next launch signs straight back in with no window open — the
//! "install it, sign in once, hide it" promise. First-run account creation is not here: it happens
//! on the browser join page (docs/architecture/JOIN-FLOW.md).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// What survives a restart. The token is a long-lived, remotely revocable session, never the password.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub server: Option<String>,
    pub session_token: Option<String>,
    pub campaign_id: Option<String>,
}

const FILE_NAME: &str = "account.json";

impl Saved {
    pub fn load(dir: &Path) -> Self {
        std::fs::read_to_string(dir.join(FILE_NAME))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    /// Written atomically (temp + rename) with owner-only permissions where the OS has them.
    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(dir)?;
        let tmp = dir.join(format!("{FILE_NAME}.tmp"));
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(tmp, dir.join(FILE_NAME))
    }

    pub fn clear(dir: &Path) {
        let _ = std::fs::remove_file(dir.join(FILE_NAME));
    }
}

/// `play.example.com` → `https://play.example.com`; trailing slashes dropped. Plain `http://` is
/// accepted only because a LAN/dev server may not have a certificate; the caller shows what it got.
pub fn normalise_server(input: &str) -> Result<String, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("enter the server address".into());
    }
    let (scheme, host) = input.split_once("://").unwrap_or(("https", input));
    if scheme != "https" && scheme != "http" {
        return Err("the server address must start with https:// or http://".into());
    }
    let host = host.trim_end_matches('/');
    if host.is_empty() {
        return Err("the server address has no host".into());
    }
    Ok(format!("{scheme}://{host}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CampaignItem {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoginOutcome {
    pub session_token: String,
    pub display_name: String,
    pub user_id: String,
}

/// A failure shown to the player: a stable `code` the panel can branch on and a readable message.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AccountError {
    pub code: String,
    pub message: String,
}

impl AccountError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

/// Thin HTTP client for the few REST calls the app makes. Everything live goes over the WebSocket.
pub struct AccountClient {
    http: reqwest::Client,
    base: String,
}

impl AccountClient {
    pub fn new(base: &str) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(15))
                .user_agent(concat!("vtt-chat-app/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("reqwest client"),
            base: base.trim_end_matches('/').to_string(),
        }
    }

    async fn read(response: reqwest::Response) -> Result<Value, AccountError> {
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if status.is_success() {
            return Ok(body);
        }
        let code = body.get("error").and_then(Value::as_str).unwrap_or("error");
        let message = body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the server refused the request");
        Err(AccountError::new(code, message))
    }

    fn unreachable(err: reqwest::Error) -> AccountError {
        AccountError::new(
            "unreachable",
            format!("could not reach the server: {}", err.without_url()),
        )
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<LoginOutcome, AccountError> {
        let response = self
            .http
            .post(format!("{}/api/auth/login", self.base))
            .json(&json!({ "email": email.trim(), "password": password, "deviceLabel": device_label() }))
            .send()
            .await
            .map_err(Self::unreachable)?;
        let body = Self::read(response).await?;
        let token = body
            .get("sessionToken")
            .and_then(Value::as_str)
            .ok_or_else(|| AccountError::new("bad_response", "the server sent no session"))?
            .to_string();
        if body.get("needsConsent").and_then(Value::as_bool) == Some(true) {
            // The consent text is shown in the browser at sign-up; a changed version is re-accepted there.
            return Err(AccountError::new(
                "consent_required",
                "the recording notice has changed — open your invite link in a browser to accept it",
            ));
        }
        let user = body.get("user").cloned().unwrap_or(Value::Null);
        Ok(LoginOutcome {
            session_token: token,
            display_name: user
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            user_id: user
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        })
    }

    pub async fn campaigns(&self, token: &str) -> Result<Vec<CampaignItem>, AccountError> {
        let response = self
            .http
            .get(format!("{}/api/campaigns", self.base))
            .bearer_auth(token)
            .send()
            .await
            .map_err(Self::unreachable)?;
        let body = Self::read(response).await?;
        Ok(body
            .get("campaigns")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        Some(CampaignItem {
                            id: item.pointer("/campaign/id")?.as_str()?.to_string(),
                            name: item.pointer("/campaign/name")?.as_str()?.to_string(),
                            role: item.get("role")?.as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// `(livekit url, token)` for the campaign's room.
    pub async fn voice_token(
        &self,
        token: &str,
        campaign_id: &str,
    ) -> Result<(String, String), AccountError> {
        let response = self
            .http
            .post(format!(
                "{}/api/campaigns/{campaign_id}/voice-token",
                self.base
            ))
            .bearer_auth(token)
            .send()
            .await
            .map_err(Self::unreachable)?;
        let body = Self::read(response).await?;
        let get = |key: &str| body.get(key).and_then(Value::as_str).map(str::to_string);
        match (get("url"), get("token")) {
            (Some(url), Some(token)) => Ok((url, token)),
            _ => Err(AccountError::new(
                "bad_response",
                "the server sent no voice token",
            )),
        }
    }

    pub async fn logout(&self, token: &str) {
        let _ = self
            .http
            .post(format!("{}/api/auth/logout", self.base))
            .bearer_auth(token)
            .send()
            .await;
    }
}

fn device_label() -> String {
    format!("Tray app ({})", std::env::consts::OS)
}

/// The panel-facing summary: never includes the token.
pub fn status_json(saved: &Saved, campaigns: &[CampaignItem], display_name: &str) -> Value {
    json!({
        "signedIn": saved.session_token.is_some(),
        "server": saved.server,
        "campaignId": saved.campaign_id,
        "displayName": display_name,
        "campaigns": campaigns,
    })
}

pub fn data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_addresses_are_normalised() {
        assert_eq!(
            normalise_server(" play.example.com/ ").unwrap(),
            "https://play.example.com"
        );
        assert_eq!(
            normalise_server("http://192.168.1.5:3000").unwrap(),
            "http://192.168.1.5:3000"
        );
        assert!(normalise_server("").is_err());
        assert!(normalise_server("ftp://x").is_err());
        assert!(normalise_server("https://").is_err());
    }

    #[test]
    fn saved_state_round_trips_with_private_permissions() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Saved::load(dir.path()), Saved::default());
        let saved = Saved {
            server: Some("https://h".into()),
            session_token: Some("tok".into()),
            campaign_id: Some("c1".into()),
        };
        saved.save(dir.path()).unwrap();
        assert_eq!(Saved::load(dir.path()), saved);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("account.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(
                mode & 0o077,
                0,
                "token file must not be group/world readable"
            );
        }
        Saved::clear(dir.path());
        assert_eq!(Saved::load(dir.path()), Saved::default());
    }

    #[test]
    fn status_never_contains_the_token() {
        let saved = Saved {
            server: Some("https://h".into()),
            session_token: Some("SECRET".into()),
            campaign_id: None,
        };
        let text = status_json(&saved, &[], "Ann").to_string();
        assert!(!text.contains("SECRET"));
        assert!(text.contains("\"signedIn\":true"));
    }

    /// Against a real backend:
    /// `VTT_TEST_SERVER=http://127.0.0.1:3111 VTT_TEST_EMAIL=… VTT_TEST_PASSWORD=… cargo test -- --ignored live_`
    #[tokio::test]
    #[ignore = "needs a running backend"]
    async fn live_login_lists_campaigns_and_issues_a_voice_token() {
        let var = |k: &str| std::env::var(k).expect(k);
        let client = AccountClient::new(&var("VTT_TEST_SERVER"));
        let login = client
            .login(&var("VTT_TEST_EMAIL"), &var("VTT_TEST_PASSWORD"))
            .await
            .unwrap();
        let campaigns = client.campaigns(&login.session_token).await.unwrap();
        assert!(!campaigns.is_empty());
        let (url, token) = client
            .voice_token(&login.session_token, &campaigns[0].id)
            .await
            .unwrap();
        assert!(!url.is_empty() && !token.is_empty());
        let bad = client
            .login(&var("VTT_TEST_EMAIL"), "wrong password!!")
            .await;
        assert_eq!(bad.unwrap_err().code, "invalid_credentials");
        client.logout(&login.session_token).await;
        assert!(client.campaigns(&login.session_token).await.is_err());
    }
}
