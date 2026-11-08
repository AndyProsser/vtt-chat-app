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
    /// Not secret: shown in the panel and used to tell "mine" from "theirs" in chat.
    pub user_id: Option<String>,
    pub display_name: Option<String>,
}

const FILE_NAME: &str = "account.json";
const KEYCHAIN_SERVICE: &str = "app.vttchat.desktop";
const KEYCHAIN_USER: &str = "session-token";

/// Where the session token lives. The OS keychain in production; a map in tests.
pub trait SecretStore {
    fn get(&self) -> Option<String>;
    fn set(&self, secret: &str) -> Result<(), String>;
    fn delete(&self);
}

/// Windows Credential Manager, macOS Keychain, or the Secret Service (GNOME Keyring / KWallet) on Linux.
pub struct Keychain;

impl Keychain {
    fn entry() -> Result<keyring::Entry, keyring::Error> {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
    }
}

impl SecretStore for Keychain {
    fn get(&self) -> Option<String> {
        Self::entry().ok()?.get_password().ok()
    }
    fn set(&self, secret: &str) -> Result<(), String> {
        Self::entry()
            .and_then(|e| e.set_password(secret))
            .map_err(|e| e.to_string())
    }
    fn delete(&self) {
        if let Ok(entry) = Self::entry() {
            let _ = entry.delete_credential();
        }
    }
}

impl Saved {
    pub fn load(dir: &Path) -> Self {
        Self::load_with(dir, &Keychain)
    }

    pub fn save(&self, dir: &Path) -> std::io::Result<()> {
        self.save_with(dir, &Keychain)
    }

    pub fn clear(dir: &Path) {
        Self::clear_with(dir, &Keychain)
    }

    /// The token comes from the keychain. A token still sitting in the file (written by an earlier
    /// build, or because the keychain was unavailable when it was saved) is used, and moved into the
    /// keychain the first time one is reachable.
    pub fn load_with(dir: &Path, store: &dyn SecretStore) -> Self {
        let mut saved: Self = std::fs::read_to_string(dir.join(FILE_NAME))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        match store.get() {
            Some(token) => saved.session_token = Some(token),
            None if saved.session_token.is_some() => {
                // Migrate: rewriting stores it in the keychain and strips it from the file.
                let _ = saved.save_with(dir, store);
            }
            None => {}
        }
        saved
    }

    /// The token goes to the keychain, never the file. If there is no keychain (a headless Linux box
    /// with no Secret Service), it stays in the 0600 file instead — signing in again after every
    /// restart would be worse than a owner-only file — and the log says so.
    pub fn save_with(&self, dir: &Path, store: &dyn SecretStore) -> std::io::Result<()> {
        let mut on_disk = self.clone();
        match &self.session_token {
            Some(token) => match store.set(token) {
                Ok(()) => on_disk.session_token = None,
                Err(why) => {
                    eprintln!("keychain unavailable ({why}); keeping the token in the 0600 file")
                }
            },
            None => store.delete(),
        }
        write_private(&dir.join(FILE_NAME), &on_disk)
    }

    pub fn clear_with(dir: &Path, store: &dyn SecretStore) {
        store.delete();
        let _ = std::fs::remove_file(dir.join(FILE_NAME));
    }
}

/// Written atomically (temp + rename) with owner-only permissions where the OS has them.
fn write_private(path: &Path, saved: &Saved) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(saved)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(tmp, path)
}

/// The parts of the REST API a panel may reach, all under the signed-in campaign (or the DM's own
/// sound library). The server still checks who is allowed to do what; this only stops a panel — which
/// loads nothing but our own pages — from being turned into a general-purpose HTTP client.
const RELAY_CAMPAIGN_AREAS: [&str; 4] = ["handouts", "loot", "sessions", "sounds"];

/// `handouts/abc/show` → `/api/campaigns/<id>/handouts/abc/show`; `soundboard/library` →
/// `/api/soundboard/library`. Only plain path segments (letters, digits, `-`, `_`) are accepted: no
/// `..`, no query, no scheme, no empty segment.
pub fn relay_path(campaign_id: &str, relative: &str) -> Result<String, AccountError> {
    let bad = || AccountError::new("bad_path", "that request is not allowed");
    let segments: Vec<&str> = relative.split('/').collect();
    let plain = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    if !segments.iter().all(|s| plain(s)) {
        return Err(bad());
    }
    match segments[0] {
        "soundboard" => Ok(format!("/api/{relative}")),
        area if RELAY_CAMPAIGN_AREAS.contains(&area) => {
            if !plain(campaign_id) {
                return Err(bad());
            }
            Ok(format!("/api/campaigns/{campaign_id}/{relative}"))
        }
        _ => Err(bad()),
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

    /// Start, pause, resume or stop the campaign's recording. The server checks the caller is the DM
    /// and tells every client, which plays its own local cue — so nothing else is needed here.
    pub async fn recording_action(
        &self,
        token: &str,
        campaign_id: &str,
        action: &str,
    ) -> Result<(), AccountError> {
        let response = self
            .http
            .post(format!(
                "{}/api/campaigns/{campaign_id}/recording",
                self.base
            ))
            .bearer_auth(token)
            .json(&json!({ "action": action }))
            .send()
            .await
            .map_err(Self::unreachable)?;
        Self::read(response).await.map(|_| ())
    }

    /// A relayed call for a panel (see [`relay_path`]). 204 and empty bodies come back as `null`.
    pub async fn relay(
        &self,
        token: &str,
        method: &str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AccountError> {
        let method = reqwest::Method::from_bytes(method.as_bytes())
            .map_err(|_| AccountError::new("bad_method", "unsupported method"))?;
        let mut request = self
            .http
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(Self::unreachable)?;
        Self::read(response).await
    }

    /// A file (handout image, sound clip) as `(mime, bytes)`, capped so a bad server can't fill memory.
    pub async fn fetch_file(
        &self,
        token: &str,
        path: &str,
    ) -> Result<(String, Vec<u8>), AccountError> {
        const MAX: u64 = 12 * 1024 * 1024;
        let response = self
            .http
            .get(format!("{}{path}", self.base))
            .bearer_auth(token)
            .send()
            .await
            .map_err(Self::unreachable)?;
        if !response.status().is_success() {
            return Err(Self::read(response)
                .await
                .err()
                .unwrap_or_else(|| AccountError::new("error", "the server refused the request")));
        }
        if response.content_length().is_some_and(|n| n > MAX) {
            return Err(AccountError::new("too_large", "that file is too large"));
        }
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = response.bytes().await.map_err(Self::unreachable)?;
        if bytes.len() as u64 > MAX {
            return Err(AccountError::new("too_large", "that file is too large"));
        }
        Ok((mime, bytes.to_vec()))
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
pub fn status_json(saved: &Saved, campaigns: &[CampaignItem]) -> Value {
    json!({
        "signedIn": saved.session_token.is_some(),
        "server": saved.server,
        "campaignId": saved.campaign_id,
        "userId": saved.user_id,
        "displayName": saved.display_name,
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

    use std::cell::RefCell;

    /// A keychain stand-in; `broken` models a machine with no Secret Service.
    #[derive(Default)]
    struct MemStore {
        secret: RefCell<Option<String>>,
        broken: bool,
    }
    impl SecretStore for MemStore {
        fn get(&self) -> Option<String> {
            self.secret.borrow().clone().filter(|_| !self.broken)
        }
        fn set(&self, s: &str) -> Result<(), String> {
            if self.broken {
                return Err("no secret service".into());
            }
            *self.secret.borrow_mut() = Some(s.into());
            Ok(())
        }
        fn delete(&self) {
            *self.secret.borrow_mut() = None;
        }
    }

    fn sample() -> Saved {
        Saved {
            server: Some("https://h".into()),
            session_token: Some("tok".into()),
            campaign_id: Some("c1".into()),
            user_id: Some("u1".into()),
            display_name: Some("Ann".into()),
        }
    }

    #[test]
    fn the_token_lives_in_the_keychain_not_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemStore::default();
        assert_eq!(Saved::load_with(dir.path(), &store), Saved::default());
        sample().save_with(dir.path(), &store).unwrap();
        let file = std::fs::read_to_string(dir.path().join("account.json")).unwrap();
        assert!(!file.contains("tok"), "token must not be on disk: {file}");
        assert_eq!(Saved::load_with(dir.path(), &store), sample());
        Saved::clear_with(dir.path(), &store);
        assert_eq!(Saved::load_with(dir.path(), &store), Saved::default());
        assert!(store.get().is_none());
    }

    #[test]
    fn signing_out_removes_the_token_from_the_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemStore::default();
        sample().save_with(dir.path(), &store).unwrap();
        let signed_out = Saved {
            session_token: None,
            ..sample()
        };
        signed_out.save_with(dir.path(), &store).unwrap();
        assert!(store.get().is_none());
    }

    #[test]
    fn an_old_file_token_moves_into_the_keychain() {
        let dir = tempfile::tempdir().unwrap();
        let none = MemStore {
            broken: true,
            ..MemStore::default()
        };
        sample().save_with(dir.path(), &none).unwrap(); // no keychain: stays in the file
        let store = MemStore::default();
        assert_eq!(Saved::load_with(dir.path(), &store), sample());
        assert_eq!(store.get().as_deref(), Some("tok"));
        let file = std::fs::read_to_string(dir.path().join("account.json")).unwrap();
        assert!(!file.contains("tok"));
    }

    #[test]
    fn without_a_keychain_the_private_file_still_resumes() {
        let dir = tempfile::tempdir().unwrap();
        let store = MemStore {
            broken: true,
            ..MemStore::default()
        };
        sample().save_with(dir.path(), &store).unwrap();
        assert_eq!(Saved::load_with(dir.path(), &store), sample());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("account.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0, "fallback file must be owner-only");
        }
    }

    #[test]
    fn the_relay_only_reaches_allowed_areas() {
        assert_eq!(
            relay_path("c1", "handouts/h-1/show").unwrap(),
            "/api/campaigns/c1/handouts/h-1/show"
        );
        assert_eq!(
            relay_path("c1", "soundboard/library").unwrap(),
            "/api/soundboard/library"
        );
        for bad in [
            "",
            "auth/logout",
            "handouts/../auth/logout",
            "handouts//x",
            "handouts?x=1",
            "/handouts",
            "https://evil.example/handouts",
            "campaigns/c2/loot",
        ] {
            assert!(relay_path("c1", bad).is_err(), "{bad:?} must be refused");
        }
        assert!(relay_path("c1/../x", "loot").is_err());
    }

    /// Serves one canned response and returns `(base url, the raw request it received)`.
    async fn one_shot_server(
        status: &str,
        content_type: &str,
        body: Vec<u8>,
    ) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let head = format!(
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                received.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&received).to_string();
                if let Some(split) = text.find("\r\n\r\n") {
                    let length = text
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if received.len() >= split + 4 + length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
            String::from_utf8_lossy(&received).to_string()
        });
        (base, task)
    }

    #[tokio::test]
    async fn recording_actions_post_the_action_with_the_bearer_token() {
        let (base, request) = one_shot_server(
            "200 OK",
            "application/json",
            br#"{"recordingId":"r"}"#.to_vec(),
        )
        .await;
        AccountClient::new(&base)
            .recording_action("TOK", "c1", "pause")
            .await
            .unwrap();
        let request = request.await.unwrap();
        assert!(
            request.starts_with("POST /api/campaigns/c1/recording "),
            "{request}"
        );
        assert!(request.to_lowercase().contains("authorization: bearer tok"));
        assert!(request.contains(r#"{"action":"pause"}"#));
    }

    #[tokio::test]
    async fn the_relay_forwards_method_path_and_body_and_surfaces_server_errors() {
        let (base, request) =
            one_shot_server("200 OK", "application/json", br#"{"loot":[]}"#.to_vec()).await;
        let out = AccountClient::new(&base)
            .relay(
                "TOK",
                "POST",
                "/api/campaigns/c1/loot",
                Some(json!({"name":"Gem"})),
            )
            .await
            .unwrap();
        assert_eq!(out["loot"], json!([]));
        let request = request.await.unwrap();
        assert!(
            request.starts_with("POST /api/campaigns/c1/loot "),
            "{request}"
        );
        assert!(request.contains(r#"{"name":"Gem"}"#));

        let (base, _) = one_shot_server(
            "403 Forbidden",
            "application/json",
            br#"{"error":"forbidden","message":"only the DM"}"#.to_vec(),
        )
        .await;
        let err = AccountClient::new(&base)
            .relay("TOK", "DELETE", "/api/campaigns/c1/loot/x", None)
            .await
            .unwrap_err();
        assert_eq!(
            (err.code.as_str(), err.message.as_str()),
            ("forbidden", "only the DM")
        );
    }

    #[tokio::test]
    async fn fetch_file_returns_mime_and_bytes_and_a_204_relay_is_null() {
        let (base, _) = one_shot_server("200 OK", "image/png", vec![1, 2, 3]).await;
        let (mime, bytes) = AccountClient::new(&base)
            .fetch_file("TOK", "/api/campaigns/c1/handouts/h/file")
            .await
            .unwrap();
        assert_eq!((mime.as_str(), bytes), ("image/png", vec![1, 2, 3]));

        let (base, _) = one_shot_server("204 No Content", "application/json", Vec::new()).await;
        let out = AccountClient::new(&base)
            .relay("TOK", "DELETE", "/api/campaigns/c1/loot/x", None)
            .await
            .unwrap();
        assert!(out.is_null());
    }

    #[test]
    fn status_never_contains_the_token() {
        let saved = Saved {
            server: Some("https://h".into()),
            session_token: Some("SECRET".into()),
            campaign_id: None,
            ..Saved::default()
        };
        let text = status_json(&saved, &[]).to_string();
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
