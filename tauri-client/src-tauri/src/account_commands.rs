//! The panel-facing account commands, and the silent resume on launch. State lives here (not in a
//! panel): a panel only asks and renders. See [`crate::account`] for why HTTP is done in Rust.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::account::{
    data_dir, normalise_link_code, normalise_server, percent_encode_component, relay_path,
    status_json, AccountClient, AccountError, CampaignItem, DeviceStart, LoginOutcome, Saved,
};
use crate::session::{end_session, start_session, SessionState};

pub const ACCOUNT_ERROR_EVENT: &str = "account:error";
/// Sign-in, sign-out, campaign choice or a revoked/expired session: windows re-read `account_status`.
pub const ACCOUNT_CHANGED_EVENT: &str = "account:changed";

fn notify_changed(app: &AppHandle) {
    let _ = app.emit(ACCOUNT_CHANGED_EVENT, ());
}

#[derive(Default)]
struct Inner {
    saved: Saved,
    campaigns: Vec<CampaignItem>,
}

#[derive(Default)]
pub struct AccountState(tokio::sync::Mutex<Inner>);

fn persist(app: &AppHandle, saved: &Saved) {
    if let Some(dir) = data_dir(app) {
        if let Err(err) = saved.save(&dir) {
            eprintln!("[src-tauri] could not save the account: {err}");
        }
    }
}

fn error(code: &str, message: &str) -> AccountError {
    AccountError {
        code: code.into(),
        message: message.into(),
    }
}

/// Starts the live session for `campaign_id` (chat, presence, the consent flow). It does not join voice:
/// the player is Offline until they choose Online (status.rs).
async fn go_live(
    app: &AppHandle,
    sessions: &SessionState,
    server: &str,
    token: &str,
    campaign_id: &str,
) -> Result<(), AccountError> {
    start_session(
        app.clone(),
        sessions,
        server.to_string(),
        token.to_string(),
        campaign_id.to_string(),
    )
    .await
    .map_err(|m| error("session", &m))?;

    Ok(())
}

/// Env switch for the password / email-code / SSO forms, which are developer tools: players connect
/// through the browser (APP-SIGN-IN.md).
const DEV_SIGNIN_ENV: &str = "VTT_DEV_SIGNIN";

/// Dev mode is on only for exactly `1`. The reader is a parameter so it can be tested.
fn dev_signin_from(value: Option<&str>) -> bool {
    value == Some("1")
}

fn dev_signin_enabled_now() -> bool {
    dev_signin_from(std::env::var(DEV_SIGNIN_ENV).ok().as_deref())
}

/// The gate every password-path command passes before touching the network.
fn require_dev(enabled: bool) -> Result<(), AccountError> {
    if enabled {
        Ok(())
    } else {
        Err(error(
            "dev_only",
            "password sign-in is only available in developer mode",
        ))
    }
}

#[tauri::command]
pub fn dev_signin_enabled() -> bool {
    dev_signin_enabled_now()
}

#[tauri::command]
pub async fn account_status(state: State<'_, AccountState>) -> Result<Value, AccountError> {
    let inner = state.0.lock().await;
    Ok(status_json(&inner.saved, &inner.campaigns))
}

#[tauri::command]
pub async fn account_sign_in(
    app: AppHandle,
    state: State<'_, AccountState>,
    sessions: State<'_, SessionState>,
    server: String,
    email: String,
    password: String,
) -> Result<Value, AccountError> {
    require_dev(dev_signin_enabled_now())?;
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    let client = AccountClient::new(&server);
    let login = client.login(&email, &password).await?;
    finish_sign_in(&app, &state, &sessions, server, login).await
}

/// Which optional sign-in methods this server offers: `{ oidc, mail }`.
#[tauri::command]
pub async fn auth_providers(server: String) -> Result<Value, AccountError> {
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    AccountClient::new(&server).providers().await
}

/// Opens the server's single sign-on page in the system browser. The address is built here from the
/// server the player typed, so the webview cannot ask for any other page to be opened.
#[tauri::command]
pub async fn account_open_sso(app: AppHandle, server: String) -> Result<(), AccountError> {
    use tauri_plugin_opener::OpenerExt;
    require_dev(dev_signin_enabled_now())?;
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    app.opener()
        .open_url(format!("{server}/api/auth/oidc/"), None::<&str>)
        .map_err(|_| error("open_failed", "could not open your browser"))
}

/// The page where a signed-in browser approves a device code. Built from the typed server and a
/// code that must have the code shape, with the code percent-encoded: no other page can be named.
fn connect_page_url(server: &str, user_code: &str) -> Result<String, AccountError> {
    let server = normalise_server(server).map_err(|m| error("invalid_server", &m))?;
    let code = normalise_link_code(user_code)
        .ok_or_else(|| error("invalid_code", "that code is not the right shape"))?;
    let shown = format!("{}-{}", &code[..4], &code[4..]);
    Ok(format!(
        "{server}/connect?c={}",
        percent_encode_component(&shown)
    ))
}

/// Opens the browser approval page for a device code in the system browser. Works in every mode;
/// the address is built here, so the webview cannot ask for any other page to be opened.
#[tauri::command]
pub async fn account_open_connect(
    app: AppHandle,
    server: String,
    user_code: String,
) -> Result<(), AccountError> {
    use tauri_plugin_opener::OpenerExt;
    let url = connect_page_url(&server, &user_code)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| error("open_failed", "could not open your browser"))
}

/// The web app's home page for a typed server: `{origin}/` and nothing else. A server address that
/// carries a path is refused, so this can only ever name the root page of an http(s) server.
fn home_page_url(server: &str) -> Result<String, AccountError> {
    let server = normalise_server(server).map_err(|m| error("invalid_server", &m))?;
    let after_scheme = server.split_once("://").map_or("", |(_, rest)| rest);
    if after_scheme.contains('/') {
        return Err(error(
            "invalid_server",
            "enter just the server address, without a page path",
        ));
    }
    Ok(format!("{server}/"))
}

/// Opens the server's web app home page in the system browser, where the player signs in or joins
/// and then presses "Open VTT Chat". Built here from the typed server, so the webview cannot ask for
/// any other page to be opened.
#[tauri::command]
pub async fn account_open_home(app: AppHandle, server: String) -> Result<(), AccountError> {
    use tauri_plugin_opener::OpenerExt;
    let url = home_page_url(&server)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| error("open_failed", "could not open your browser"))
}

/// Emails a one-time sign-in code. Always succeeds from the player's side when the server is reachable:
/// whether the address has an account, or the server can send mail, is not revealed.
#[tauri::command]
pub async fn account_request_code(server: String, email: String) -> Result<(), AccountError> {
    require_dev(dev_signin_enabled_now())?;
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    AccountClient::new(&server).request_code(&email).await
}

/// Signs in with a one-time code.
#[tauri::command]
pub async fn account_sign_in_code(
    app: AppHandle,
    state: State<'_, AccountState>,
    sessions: State<'_, SessionState>,
    server: String,
    code: String,
) -> Result<Value, AccountError> {
    require_dev(dev_signin_enabled_now())?;
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    let login = AccountClient::new(&server).redeem_code(&code).await?;
    finish_sign_in(&app, &state, &sessions, server, login).await
}

/// The longest one-time code the server accepts at `/api/auth/magic-link/redeem`.
const MAX_TYPED_CODE_BYTES: usize = 256;

/// What the typed-code box sends. A short link code (`abcd 2345`, `ABCD-2345`) goes in its canonical
/// 8-character form; anything else (a `vtt-admin user code` token, an emailed code, the SSO callback's
/// code) goes as typed, trimmed, and the server decides. Only empty or over-long input is refused here.
fn typed_connect_code(input: &str) -> Result<String, AccountError> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_TYPED_CODE_BYTES {
        return Err(error("invalid_code", "that is not a code"));
    }
    Ok(normalise_link_code(trimmed).unwrap_or_else(|| trimmed.to_string()))
}

/// Connects with any one-time code: a link code from the join page or a connect link, a code from
/// `vtt-admin user code`, an emailed code, or the code the SSO page shows. Works in every mode: it is
/// not a password path, and the server validates the code.
#[tauri::command]
pub async fn account_connect_with_code(
    app: AppHandle,
    state: State<'_, AccountState>,
    sessions: State<'_, SessionState>,
    server: String,
    code: String,
) -> Result<Value, AccountError> {
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    let code = typed_connect_code(&code)?;
    let login = AccountClient::new(&server).redeem_code(&code).await?;
    finish_sign_in(&app, &state, &sessions, server, login).await
}

/// Starts a browser-approved sign-in; the panel shows the code, opens `approveUrl`, and polls.
#[tauri::command]
pub async fn account_device_start(server: String) -> Result<DeviceStart, AccountError> {
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    AccountClient::new(&server).device_start().await
}

/// One poll of a device sign-in: `null` while pending, the account status once approved.
#[tauri::command]
pub async fn account_device_poll(
    app: AppHandle,
    state: State<'_, AccountState>,
    sessions: State<'_, SessionState>,
    server: String,
    request_id: String,
    poll_secret: String,
) -> Result<Option<Value>, AccountError> {
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    let Some(login) = AccountClient::new(&server)
        .device_poll(&request_id, &poll_secret)
        .await?
    else {
        return Ok(None);
    };
    finish_sign_in(&app, &state, &sessions, server, login)
        .await
        .map(Some)
}

/// Saves the new session, lists the campaigns, and goes live in the only one (if there is just one).
async fn finish_sign_in(
    app: &AppHandle,
    state: &State<'_, AccountState>,
    sessions: &State<'_, SessionState>,
    server: String,
    login: LoginOutcome,
) -> Result<Value, AccountError> {
    let client = AccountClient::new(&server);
    let campaigns = client.campaigns(&login.session_token).await?;

    let mut inner = state.0.lock().await;
    inner.saved = Saved {
        server: Some(server.clone()),
        session_token: Some(login.session_token.clone()),
        user_id: Some(login.user_id.clone()),
        display_name: Some(login.display_name.clone()),
        avatar_url: login.avatar_url.clone(),
        // A single campaign needs no picker.
        campaign_id: (campaigns.len() == 1).then(|| campaigns[0].id.clone()),
    };
    inner.campaigns = campaigns;
    persist(app, &inner.saved);

    if let Some(campaign_id) = inner.saved.campaign_id.clone() {
        go_live(app, sessions, &server, &login.session_token, &campaign_id).await?;
    }
    notify_changed(app);
    Ok(status_json(&inner.saved, &inner.campaigns))
}

/// The DM cannot leave a campaign that is recording: the recording is their session. Players come and go.
fn switch_blocked(current_role: Option<&str>, recording_open: bool) -> bool {
    recording_open && current_role == Some("dm")
}

/// Makes `campaign_id` the live campaign: leaves the current one (chat link and voice room) first, so
/// switching never leaves a second voice connection behind, then joins the new one.
async fn switch_to(
    app: &AppHandle,
    sessions: &SessionState,
    inner: &mut Inner,
    campaign_id: &str,
) -> Result<(), AccountError> {
    let (Some(server), Some(token)) = (
        inner.saved.server.clone(),
        inner.saved.session_token.clone(),
    ) else {
        return Err(error("signed_out", "sign in first"));
    };
    if !inner.campaigns.iter().any(|c| c.id == campaign_id) {
        return Err(error("unknown_campaign", "you are not in that campaign"));
    }
    let role = inner
        .saved
        .campaign_id
        .as_deref()
        .filter(|current| *current != campaign_id)
        .and_then(|current| inner.campaigns.iter().find(|c| c.id == current))
        .map(|c| c.role.as_str());
    let recording_open = app
        .state::<std::sync::Mutex<crate::session::TrayModel>>()
        .lock()
        .unwrap()
        .recording_open();
    if switch_blocked(role, recording_open) {
        return Err(error(
            "recording_active",
            "A recording is running. Stop it before switching campaigns.",
        ));
    }
    teardown(app, sessions).await;
    inner.saved.campaign_id = Some(campaign_id.to_string());
    persist(app, &inner.saved);
    go_live(app, sessions, &server, &token, campaign_id).await?;
    notify_changed(app);
    Ok(())
}

#[tauri::command]
pub async fn account_select_campaign(
    app: AppHandle,
    state: State<'_, AccountState>,
    sessions: State<'_, SessionState>,
    campaign_id: String,
) -> Result<Value, AccountError> {
    let mut inner = state.0.lock().await;
    switch_to(&app, &sessions, &mut inner, &campaign_id).await?;
    Ok(status_json(&inner.saved, &inner.campaigns))
}

/// Joins a campaign with an invite code, or creates one (the server decides who may create), then
/// switches to it. `action` is `join` (value = the code), `create` (value = the name) or `refresh`
/// (re-read the list after leaving a campaign or a DM swap; if the current campaign is gone, move to
/// another or to none).
#[tauri::command]
pub async fn account_add_campaign(
    app: AppHandle,
    state: State<'_, AccountState>,
    sessions: State<'_, SessionState>,
    action: String,
    value: String,
) -> Result<Value, AccountError> {
    if action == "refresh" {
        let mut inner = state.0.lock().await;
        let (Some(server), Some(token)) = (
            inner.saved.server.clone(),
            inner.saved.session_token.clone(),
        ) else {
            return Err(error("signed_out", "sign in first"));
        };
        inner.campaigns = AccountClient::new(&server).campaigns(&token).await?;
        let current = inner.saved.campaign_id.clone();
        let still_there = current
            .as_ref()
            .is_some_and(|id| inner.campaigns.iter().any(|c| &c.id == id));
        if !still_there && current.is_some() {
            match inner.campaigns.first().map(|c| c.id.clone()) {
                Some(next) => switch_to(&app, &sessions, &mut inner, &next).await?,
                None => {
                    teardown(&app, &sessions).await;
                    inner.saved.campaign_id = None;
                    persist(&app, &inner.saved);
                    notify_changed(&app);
                }
            }
        } else {
            notify_changed(&app);
        }
        return Ok(status_json(&inner.saved, &inner.campaigns));
    }
    let (path, body, id_at) = match action.as_str() {
        "join" => (
            "/api/campaigns/join",
            serde_json::json!({ "code": value.trim() }),
            "/membership/campaignId",
        ),
        "create" => (
            "/api/campaigns",
            serde_json::json!({ "name": value.trim() }),
            "/campaign/id",
        ),
        _ => return Err(error("bad_action", "unknown campaign action")),
    };
    if value.trim().is_empty() {
        return Err(error("invalid_input", "that is empty"));
    }
    let mut inner = state.0.lock().await;
    let (Some(server), Some(token)) = (
        inner.saved.server.clone(),
        inner.saved.session_token.clone(),
    ) else {
        return Err(error("signed_out", "sign in first"));
    };
    let client = AccountClient::new(&server);
    let response = client.relay(&token, "POST", path, Some(body)).await?;
    inner.campaigns = client.campaigns(&token).await?;
    let id = response
        .pointer(id_at)
        .and_then(Value::as_str)
        .map(str::to_string);
    match id {
        Some(id) => switch_to(&app, &sessions, &mut inner, &id).await?,
        None => notify_changed(&app),
    }
    Ok(status_json(&inner.saved, &inner.campaigns))
}

/// Changes the player's name (`PATCH /api/auth/me`) and updates what the app shows. The server does
/// the validation (not blank, at most 80 characters) and tells live tables the new name.
#[tauri::command]
pub async fn account_rename(
    app: AppHandle,
    state: State<'_, AccountState>,
    name: String,
) -> Result<Value, AccountError> {
    let mut inner = state.0.lock().await;
    let (Some(server), Some(token)) = (
        inner.saved.server.clone(),
        inner.saved.session_token.clone(),
    ) else {
        return Err(error("signed_out", "sign in first"));
    };
    let response = AccountClient::new(&server)
        .relay(
            &token,
            "PATCH",
            "/api/auth/me",
            Some(serde_json::json!({ "displayName": name })),
        )
        .await?;
    if let Some(new_name) = response
        .pointer("/user/displayName")
        .and_then(Value::as_str)
    {
        inner.saved.display_name = Some(new_name.to_string());
        persist(&app, &inner.saved);
    }
    notify_changed(&app);
    Ok(status_json(&inner.saved, &inner.campaigns))
}

/// Sets (or, with `None`, clears) the player's own portrait: an uploaded picture's `avatar:<id>` or an
/// `emblem:<name>`. The server validates the value.
#[tauri::command]
pub async fn account_set_avatar(
    app: AppHandle,
    state: State<'_, AccountState>,
    avatar: Option<String>,
) -> Result<Value, AccountError> {
    let mut inner = state.0.lock().await;
    let (Some(server), Some(token)) = (
        inner.saved.server.clone(),
        inner.saved.session_token.clone(),
    ) else {
        return Err(error("signed_out", "sign in first"));
    };
    let response = AccountClient::new(&server)
        .relay(
            &token,
            "PATCH",
            "/api/auth/me",
            Some(serde_json::json!({ "avatarUrl": avatar })),
        )
        .await?;
    inner.saved.avatar_url = response
        .pointer("/user/avatarUrl")
        .and_then(Value::as_str)
        .map(str::to_string);
    persist(&app, &inner.saved);
    notify_changed(&app);
    Ok(status_json(&inner.saved, &inner.campaigns))
}

#[tauri::command]
pub async fn account_sign_out(
    app: AppHandle,
    state: State<'_, AccountState>,
    sessions: State<'_, SessionState>,
) -> Result<Value, AccountError> {
    let mut inner = state.0.lock().await;
    if let (Some(server), Some(token)) = (&inner.saved.server, &inner.saved.session_token) {
        AccountClient::new(server).logout(token).await;
    }
    let server = inner.saved.server.clone();
    teardown(&app, &sessions).await;
    inner.saved = Saved {
        server,
        ..Saved::default()
    };
    inner.campaigns.clear();
    if let Some(dir) = data_dir(&app) {
        Saved::clear(&dir);
        // Keep the server address so the next sign-in only needs credentials.
        let _ = inner.saved.save(&dir);
    }
    notify_changed(&app);
    Ok(status_json(&inner.saved, &inner.campaigns))
}

async fn teardown(app: &AppHandle, sessions: &SessionState) {
    let voice = app
        .state::<rust_livekit::SharedClient>()
        .lock()
        .unwrap()
        .take();
    if let Some(voice) = voice {
        let _ = voice.disconnect().await;
    }
    let _ = end_session(app.clone(), sessions).await;
    crate::status_commands::reset(app);
}

/// The server revoked this session (or aged it out): forget the token, keep the server address.
pub fn on_revoked(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AccountState>();
        let mut inner = state.0.lock().await;
        inner.saved.session_token = None;
        inner.saved.campaign_id = None;
        inner.campaigns.clear();
        persist(&app, &inner.saved);
        drop(inner);
        teardown(&app, &app.state::<SessionState>()).await;
        notify_changed(&app);
    });
}

/// On launch: read what was saved and, if there is a session and a campaign, go live with no window
/// open. An expired token is dropped so the panel shows the sign-in form instead of a dead session.
pub fn resume(app: &AppHandle) {
    let Some(dir) = data_dir(app) else { return };
    let saved = Saved::load(&dir);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AccountState>();
        let mut inner = state.0.lock().await;
        inner.saved = saved.clone();
        let (Some(server), Some(token), Some(campaign_id)) =
            (saved.server, saved.session_token, saved.campaign_id)
        else {
            return;
        };
        let client = AccountClient::new(&server);
        match client.campaigns(&token).await {
            Ok(campaigns) if campaigns.iter().any(|c| c.id == campaign_id) => {
                inner.campaigns = campaigns;
                let _ = go_live(
                    &app,
                    &app.state::<SessionState>(),
                    &server,
                    &token,
                    &campaign_id,
                )
                .await;
            }
            Ok(_) => {
                inner.saved.campaign_id = None;
                persist(&app, &inner.saved);
            }
            Err(err) if err.code == "unreachable" => {
                // Offline at launch: keep the session; the sync client retries on its own.
                let _ = go_live(
                    &app,
                    &app.state::<SessionState>(),
                    &server,
                    &token,
                    &campaign_id,
                )
                .await;
            }
            Err(_) => {
                inner.saved.session_token = None;
                persist(&app, &inner.saved);
            }
        }
        drop(inner);
        notify_changed(&app);
    });
}

/// The actions the server's recording endpoint accepts.
const RECORDING_ACTIONS: [&str; 4] = ["start", "pause", "resume", "stop"];

/// DM-only on the server (a player gets `forbidden`); the panel only offers it to the DM.
#[tauri::command]
pub async fn recording_control(
    state: State<'_, AccountState>,
    action: String,
) -> Result<(), AccountError> {
    if !RECORDING_ACTIONS.contains(&action.as_str()) {
        return Err(error("bad_action", "unknown recording action"));
    }
    let (server, token, campaign) = {
        let inner = state.0.lock().await;
        (
            inner.saved.server.clone(),
            inner.saved.session_token.clone(),
            inner.saved.campaign_id.clone(),
        )
    };
    let (Some(server), Some(token), Some(campaign)) = (server, token, campaign) else {
        return Err(error("signed_out", "sign in and pick a campaign first"));
    };
    AccountClient::new(&server)
        .recording_action(&token, &campaign, &action)
        .await
}

impl AccountState {
    /// The signed-in `(server, token, campaign)`, or an error asking to sign in.
    pub async fn credentials(&self) -> Result<(String, String, String), AccountError> {
        credentials(self).await
    }

    /// The server last signed in to (kept after sign-out), if any.
    pub async fn server(&self) -> Option<String> {
        self.0.lock().await.saved.server.clone()
    }

    /// This player's id, for frames that name a user.
    pub async fn user_id(&self) -> Option<String> {
        self.0.lock().await.saved.user_id.clone()
    }
}

/// Reads the signed-in `(server, token, campaign)`, or says to sign in.
async fn credentials(state: &AccountState) -> Result<(String, String, String), AccountError> {
    let inner = state.0.lock().await;
    match (
        &inner.saved.server,
        &inner.saved.session_token,
        &inner.saved.campaign_id,
    ) {
        (Some(s), Some(t), Some(c)) => Ok((s.clone(), t.clone(), c.clone())),
        _ => Err(error("signed_out", "sign in and pick a campaign first")),
    }
}

/// A panel's REST call (handouts, loot, schedule, the DM's sound library), made by Rust because the
/// webview may not reach the network. See [`crate::account::relay_path`] for what is allowed.
#[tauri::command]
pub async fn campaign_api(
    state: State<'_, AccountState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, AccountError> {
    if !["GET", "POST", "PUT", "PATCH", "DELETE"].contains(&method.as_str()) {
        return Err(error("bad_method", "unsupported method"));
    }
    let (server, token, campaign) = credentials(&state).await?;
    let full = relay_path(&campaign, &path)?;
    AccountClient::new(&server)
        .relay(&token, &method, &full, body)
        .await
}

/// Asking to join a campaign, and the DM's side of it. Works with no campaign chosen (the list of open
/// tables is for someone who is in none); the paths are fixed by [`crate::account::join_call`].
#[tauri::command]
pub async fn join_api(
    state: State<'_, AccountState>,
    action: String,
    campaign_id: Option<String>,
    request_id: Option<String>,
    message: Option<String>,
    flag: Option<bool>,
) -> Result<Value, AccountError> {
    let (method, path, body) = crate::account::join_call(
        &action,
        campaign_id.as_deref(),
        request_id.as_deref(),
        message.as_deref(),
        flag,
    )?;
    let (server, token) = {
        let inner = state.0.lock().await;
        match (&inner.saved.server, &inner.saved.session_token) {
            (Some(s), Some(t)) => (s.clone(), t.clone()),
            _ => return Err(error("signed_out", "sign in first")),
        }
    };
    AccountClient::new(&server)
        .relay(&token, method, &path, body)
        .await
}

/// Searches the campaign's recorded history (transcripts and the summaries the caller may see).
#[tauri::command]
pub async fn records_search(
    state: State<'_, AccountState>,
    query: String,
) -> Result<Value, AccountError> {
    let (server, token, campaign) = credentials(&state).await?;
    let path = crate::account::records_search_path(&campaign, &query)?;
    AccountClient::new(&server)
        .relay(&token, "GET", &path, None)
        .await
}

/// D&D Beyond sync for one of the player's characters: `status`, `link` (with a sheet address),
/// `sync` or `unlink`. The server does the work; this only keeps the paths fixed.
#[tauri::command]
pub async fn ddb_api(
    state: State<'_, AccountState>,
    action: String,
    character_id: Option<String>,
    url: Option<String>,
) -> Result<Value, AccountError> {
    let (server, token, campaign) = if action == "status" {
        let (s, t, _) = credentials(&state)
            .await
            .map_err(|_| error("signed_out", "sign in first"))?;
        (s, t, String::new())
    } else {
        credentials(&state).await?
    };
    let (method, path, body) =
        crate::account::ddb_call(&action, &campaign, character_id.as_deref(), url.as_deref())?;
    AccountClient::new(&server)
        .relay(&token, method, path, body)
        .await
}

/// Uploads a picture (a pasted screenshot, a map) as a new handout. `data` is the file, base64;
/// the server checks what it really is and how big it may be.
#[tauri::command]
pub async fn handout_upload(
    state: State<'_, AccountState>,
    title: String,
    kind: String,
    name: String,
    data: String,
) -> Result<Value, AccountError> {
    use base64::Engine;
    let (server, token, campaign) = credentials(&state).await?;
    let path = crate::account::handout_upload_path(&campaign, &title, &kind, &name)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| error("invalid_input", "that picture could not be read"))?;
    if bytes.is_empty() || bytes.len() > crate::account::MAX_UPLOAD_BYTES {
        return Err(error(
            "invalid_input",
            "the picture is empty or too large (12 MB at most)",
        ));
    }
    AccountClient::new(&server)
        .upload(&token, &path, bytes)
        .await
}

/// Adds a picture to a picture handout (`data` is the file, base64; the server checks it).
#[tauri::command]
pub async fn handout_add_image(
    state: State<'_, AccountState>,
    handout_id: String,
    name: String,
    data: String,
) -> Result<Value, AccountError> {
    use base64::Engine;
    let (server, token, campaign) = credentials(&state).await?;
    let path = crate::account::handout_image_path(&campaign, &handout_id, &name)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| error("invalid_input", "that picture could not be read"))?;
    if bytes.is_empty() || bytes.len() > crate::account::MAX_UPLOAD_BYTES {
        return Err(error(
            "invalid_input",
            "the picture is empty or too large (12 MB at most)",
        ));
    }
    AccountClient::new(&server)
        .upload(&token, &path, bytes)
        .await
}

/// A file the server holds, as a `data:` URL the panel can show (its CSP allows `data:` images only).
#[tauri::command]
pub async fn campaign_file(
    state: State<'_, AccountState>,
    path: String,
) -> Result<String, AccountError> {
    use base64::Engine;
    let (server, token, campaign) = credentials(&state).await?;
    let full = relay_path(&campaign, &path)?;
    let (mime, bytes) = AccountClient::new(&server)
        .fetch_file(&token, &full)
        .await?;
    // Pictures show directly; a PDF is read by the handout viewer's own page renderer.
    if !mime.starts_with("image/") && mime != "application/pdf" {
        return Err(error("not_an_image", "that file is not a picture or a PDF"));
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// An avatar id is a UUID; anything else never reaches the server as a path.
fn is_avatar_id(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// The server and session token, for calls that are not about a campaign.
async fn server_credentials(state: &AccountState) -> Result<(String, String), AccountError> {
    let inner = state.0.lock().await;
    match (&inner.saved.server, &inner.saved.session_token) {
        (Some(s), Some(t)) => Ok((s.clone(), t.clone())),
        _ => Err(error("signed_out", "sign in first")),
    }
}

/// Uploads a portrait (already shrunk by the panel; base64) and returns `{ id }`. The server checks
/// it really is a small picture.
#[tauri::command]
pub async fn avatar_upload(
    state: State<'_, AccountState>,
    data: String,
) -> Result<Value, AccountError> {
    use base64::Engine;
    let (server, token) = server_credentials(&state).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|_| error("invalid_input", "that picture could not be read"))?;
    if bytes.is_empty() || bytes.len() > 256 * 1024 {
        return Err(error("invalid_input", "the picture is empty or too large"));
    }
    AccountClient::new(&server)
        .upload(&token, "/api/avatars/upload", bytes)
        .await
}

/// A portrait as a `data:` URL, because the webview may not fetch from the network (its CSP allows
/// images from `data:` only).
#[tauri::command]
pub async fn avatar_image(
    state: State<'_, AccountState>,
    id: String,
) -> Result<String, AccountError> {
    use base64::Engine;
    if !is_avatar_id(&id) {
        return Err(error("bad_path", "that is not a picture id"));
    }
    let (server, token) = server_credentials(&state).await?;
    let (mime, bytes) = AccountClient::new(&server)
        .fetch_file(&token, &format!("/api/avatars/{id}"))
        .await?;
    if !mime.starts_with("image/") {
        return Err(error("not_an_image", "that is not a picture"));
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod avatar_tests {
    use super::is_avatar_id;

    #[test]
    fn only_uuid_shaped_ids_are_fetched() {
        assert!(is_avatar_id("0b1f3a52-6c1e-4d57-9a64-0c2f7d3e8a11"));
        assert!(!is_avatar_id("../../etc/passwd"));
        assert!(!is_avatar_id("0b1f3a52-6c1e-4d57-9a64-0c2f7d3e8a1/"));
        assert!(!is_avatar_id(""));
    }
}

#[cfg(test)]
mod switch_tests {
    use super::switch_blocked;

    #[test]
    fn only_a_dm_with_a_recording_open_is_held_in_their_campaign() {
        assert!(switch_blocked(Some("dm"), true));
        assert!(
            !switch_blocked(Some("dm"), false),
            "no recording, free to go"
        );
        assert!(!switch_blocked(Some("player"), true), "players come and go");
        assert!(!switch_blocked(None, true), "no current campaign");
    }
}

#[cfg(test)]
mod dev_tests {
    use super::{dev_signin_from, require_dev};

    #[test]
    fn dev_mode_is_only_on_for_exactly_one() {
        assert!(dev_signin_from(Some("1")));
        for off in [Some("0"), None, Some("true"), Some("")] {
            assert!(!dev_signin_from(off), "{off:?}");
        }
    }

    #[test]
    fn password_paths_say_dev_only_when_dev_mode_is_off() {
        let err = require_dev(false).unwrap_err();
        assert_eq!(err.code, "dev_only");
        assert_eq!(
            err.message,
            "password sign-in is only available in developer mode"
        );
        assert!(require_dev(true).is_ok());
    }
}

#[cfg(test)]
mod connect_page_tests {
    use super::{connect_page_url, typed_connect_code};

    #[test]
    fn a_typed_short_code_is_sent_in_its_canonical_form() {
        assert_eq!(typed_connect_code(" abcd-2345 ").unwrap(), "ABCD2345");
        assert_eq!(typed_connect_code("ab cd 2345").unwrap(), "ABCD2345");
    }

    #[test]
    fn any_other_one_time_code_is_sent_as_typed_for_the_server_to_check() {
        // Shaped like `vtt-admin user code` and the SSO callback's code: 43 base64url characters.
        let long = "one-time-code-test-fixture-not-a-real-code";
        assert_eq!(typed_connect_code(&format!("  {long}\n")).unwrap(), long);
        // Not the short alphabet (has an O), so it is not rewritten either.
        assert_eq!(typed_connect_code("abcd-234o").unwrap(), "abcd-234o");
    }

    #[test]
    fn a_long_link_token_is_sent_exactly_as_it_came_in_the_deep_link() {
        let token = "Zm9vYmFyLV9iYXo0NTY3ODkwQUJDREVGR0hJSktMTU4";
        assert_eq!(typed_connect_code(token).unwrap(), token);
    }

    #[test]
    fn empty_or_over_long_input_is_refused() {
        for bad in ["".to_string(), "   ".to_string(), "x".repeat(257)] {
            assert_eq!(typed_connect_code(&bad).unwrap_err().code, "invalid_code");
        }
        assert!(typed_connect_code(&"x".repeat(256)).is_ok());
    }
    use crate::account::percent_encode_component;

    #[test]
    fn builds_the_connect_page_from_server_and_code() {
        assert_eq!(
            connect_page_url("play.example.com", "abcd2345").unwrap(),
            "https://play.example.com/connect?c=ABCD-2345"
        );
    }

    #[test]
    fn a_trailing_slash_on_the_server_is_dropped() {
        assert_eq!(
            connect_page_url("http://localhost:3000/", "ABCD-2345").unwrap(),
            "http://localhost:3000/connect?c=ABCD-2345"
        );
    }

    #[test]
    fn a_code_of_the_wrong_shape_is_rejected() {
        for bad in [
            "",
            "ABCD",
            "ABCD-2345&x=1",
            "ABCD-2345#frag",
            "ABCD-234O",
            "../../x",
        ] {
            let err = connect_page_url("play.example.com", bad).unwrap_err();
            assert_eq!(err.code, "invalid_code", "{bad:?}");
        }
    }

    #[test]
    fn encoding_leaves_no_way_to_add_a_parameter_or_fragment() {
        let encoded = percent_encode_component("a&b#c d/?=");
        assert!(!encoded.contains(['&', '#', ' ', '/', '?', '=']));
        assert_eq!(encoded, "a%26b%23c%20d%2F%3F%3D");
        assert_eq!(percent_encode_component("ABCD-2345"), "ABCD-2345");
    }
}

#[cfg(test)]
mod home_tests {
    use super::home_page_url;

    #[test]
    fn builds_only_the_root_page_of_an_http_server() {
        assert_eq!(
            home_page_url(" play.example.com/ ").unwrap(),
            "https://play.example.com/"
        );
        assert_eq!(
            home_page_url("http://localhost:3000").unwrap(),
            "http://localhost:3000/"
        );
    }

    #[test]
    fn refuses_other_schemes_junk_and_paths() {
        for bad in [
            "",
            "ftp://x.example",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "a b",
            "user@host",
            "https://",
            "https://play.example.com/admin",
            "play.example.com/connect?c=ABCD-2345",
        ] {
            assert!(home_page_url(bad).is_err(), "{bad}");
        }
    }
}
