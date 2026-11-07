//! The panel-facing account commands, and the silent resume on launch. State lives here (not in a
//! panel): a panel only asks and renders. See [`crate::account`] for why HTTP is done in Rust.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::account::{
    data_dir, normalise_server, status_json, AccountClient, AccountError, CampaignItem, Saved,
};
use crate::session::{end_session, start_session, SessionState};

pub const ACCOUNT_ERROR_EVENT: &str = "account:error";

#[derive(Default)]
struct Inner {
    saved: Saved,
    display_name: String,
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
    Ok(status_json(
        &inner.saved,
        &inner.campaigns,
        &inner.display_name,
    ))
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
    inner.display_name = login.display_name;
    inner.saved = Saved {
        server: Some(server.clone()),
        session_token: Some(login.session_token.clone()),
        // A single campaign needs no picker.
        campaign_id: (campaigns.len() == 1).then(|| campaigns[0].id.clone()),
    };
    inner.campaigns = campaigns;
    persist(&app, &inner.saved);

    if let Some(campaign_id) = inner.saved.campaign_id.clone() {
        go_live(&app, &sessions, &server, &login.session_token, &campaign_id).await?;
    }
    Ok(status_json(
        &inner.saved,
        &inner.campaigns,
        &inner.display_name,
    ))
}

#[tauri::command]
pub async fn account_select_campaign(
    app: AppHandle,
    state: State<'_, AccountState>,
    sessions: State<'_, SessionState>,
    campaign_id: String,
) -> Result<Value, AccountError> {
    let mut inner = state.0.lock().await;
    let (Some(server), Some(token)) = (
        inner.saved.server.clone(),
        inner.saved.session_token.clone(),
    ) else {
        return Err(error("signed_out", "sign in first"));
    };
    if !inner.campaigns.iter().any(|c| c.id == campaign_id) {
        return Err(error("unknown_campaign", "you are not in that campaign"));
    }
    inner.saved.campaign_id = Some(campaign_id.clone());
    persist(&app, &inner.saved);
    go_live(&app, &sessions, &server, &token, &campaign_id).await?;
    Ok(status_json(
        &inner.saved,
        &inner.campaigns,
        &inner.display_name,
    ))
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
    inner.display_name.clear();
    if let Some(dir) = data_dir(&app) {
        Saved::clear(&dir);
        // Keep the server address so the next sign-in only needs credentials.
        let _ = inner.saved.save(&dir);
    }
    Ok(status_json(
        &inner.saved,
        &inner.campaigns,
        &inner.display_name,
    ))
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
    });
}
