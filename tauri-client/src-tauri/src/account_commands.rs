//! The panel-facing account commands, and the silent resume on launch. State lives here (not in a
//! panel): a panel only asks and renders. See [`crate::account`] for why HTTP is done in Rust.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::account::{
    data_dir, normalise_server, relay_path, status_json, AccountClient, AccountError, CampaignItem,
    Saved,
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

/// Starts the live session for `campaign_id`, then joins its voice room. Voice failing is reported
/// but does not undo the session: chat, presence and the consent flow still work.
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

    let client = AccountClient::new(server);
    let voice = match client.voice_token(token, campaign_id).await {
        Ok((url, voice_token)) => crate::commands::connect_voice(app, &url, &voice_token)
            .await
            .map_err(|m| error("voice", &m)),
        Err(err) => Err(err),
    };
    if let Err(err) = voice {
        let _ = app.emit(ACCOUNT_ERROR_EVENT, &err);
    }
    Ok(())
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
    let server = normalise_server(&server).map_err(|m| error("invalid_server", &m))?;
    let client = AccountClient::new(&server);
    let login = client.login(&email, &password).await?;
    let campaigns = client.campaigns(&login.session_token).await?;

    let mut inner = state.0.lock().await;
    inner.saved = Saved {
        server: Some(server.clone()),
        session_token: Some(login.session_token.clone()),
        user_id: Some(login.user_id.clone()),
        display_name: Some(login.display_name.clone()),
        // A single campaign needs no picker.
        campaign_id: (campaigns.len() == 1).then(|| campaigns[0].id.clone()),
    };
    inner.campaigns = campaigns;
    persist(&app, &inner.saved);

    if let Some(campaign_id) = inner.saved.campaign_id.clone() {
        go_live(&app, &sessions, &server, &login.session_token, &campaign_id).await?;
    }
    notify_changed(&app);
    Ok(status_json(&inner.saved, &inner.campaigns))
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
    if let Some(new_name) = response.pointer("/user/displayName").and_then(Value::as_str) {
        inner.saved.display_name = Some(new_name.to_string());
        persist(&app, &inner.saved);
    }
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
    if !mime.starts_with("image/") {
        return Err(error("not_an_image", "that file is not an image"));
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
