use keyring::Entry;
use reqwest::Response;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

const REPORT_AUTH_SERVICE: &str = "ISpooferMotion.DiscordReportAuth";
const REPORT_AUTH_ACCOUNT: &str = "default";
static RUNTIME_LOGIN_TOKEN: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static RUNTIME_DISCORD_AUTH: OnceLock<Mutex<Option<Value>>> = OnceLock::new();
static CACHED_API_URL: std::sync::OnceLock<String> = std::sync::OnceLock::new();

async fn report_api_url() -> crate::error::Result<String> {
    if let Some(url) = CACHED_API_URL.get() {
        return Ok(url.clone());
    }

    let prod_url = "https://ispoofermotion.com";

    let mut configured = prod_url.to_string();

    #[cfg(debug_assertions)]
    {
        let dev_url = "http://localhost:3000";
        let fallback_url = "http://127.0.0.1:3000";
        // if we're in debug mode, try hitting the dev server first, then fallback to local or prod
        if crate::utils::get_http_client().get(format!("{dev_url}/api/cache")).send().await.is_ok()
        {
            configured = dev_url.to_string();
        } else if crate::utils::get_http_client()
            .get(format!("{fallback_url}/api/cache"))
            .send()
            .await
            .is_ok()
        {
            configured = fallback_url.to_string();
        }
    }

    let _ = CACHED_API_URL.set(configured.clone());
    Ok(configured)
}

fn validate_token(value: &str, label: &str) -> crate::error::Result<()> {
    if value.len() < 24
        || value.len() > 160
        || !value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!("Invalid {label}.").into());
    }
    Ok(())
}

fn validate_login_token(value: &str) -> crate::error::Result<()> {
    if value.is_empty() {
        return Err("Missing Discord login token.".into());
    }
    if value.len() > 4096 || !value.chars().all(|ch| ch.is_ascii_graphic()) {
        return Err("Invalid Discord login token.".into());
    }
    Ok(())
}

fn runtime_login_token() -> &'static Mutex<Option<String>> {
    RUNTIME_LOGIN_TOKEN.get_or_init(|| Mutex::new(None))
}

fn runtime_discord_auth() -> &'static Mutex<Option<Value>> {
    RUNTIME_DISCORD_AUTH.get_or_init(|| Mutex::new(None))
}

fn set_runtime_login_token(token: &str) {
    if let Ok(mut stored) = runtime_login_token().lock() {
        *stored = Some(token.to_string());
    }
}

fn set_runtime_discord_auth(auth: &Value) {
    if let Ok(mut stored) = runtime_discord_auth().lock() {
        *stored = Some(auth.clone());
    }
    if let Some(token) = auth.get("loginToken").and_then(Value::as_str) {
        set_runtime_login_token(token);
    }
}

fn clear_runtime_login_token() {
    if let Ok(mut stored) = runtime_login_token().lock() {
        *stored = None;
    }
    if let Ok(mut stored) = runtime_discord_auth().lock() {
        *stored = None;
    }
}

fn report_auth_entry() -> crate::error::Result<Entry> {
    Entry::new(REPORT_AUTH_SERVICE, REPORT_AUTH_ACCOUNT).map_err(|error| {
        crate::error::AppError::Custom(format!("Failed to open Discord credential store: {error}"))
    })
}

fn stored_login_token() -> crate::error::Result<Option<String>> {
    if let Ok(stored) = runtime_discord_auth().lock() {
        if let Some(token) =
            stored.as_ref().and_then(|auth| auth.get("loginToken")).and_then(Value::as_str)
        {
            return Ok(Some(token.to_string()));
        }
    }

    if let Ok(stored) = runtime_login_token().lock() {
        if let Some(token) = stored.as_ref() {
            return Ok(Some(token.clone()));
        }
    }

    let entry = report_auth_entry()?;
    // try to read the token out of the secure store, if it fails just return none silently
    let Ok(serialized) = entry.get_password() else {
        return Ok(None);
    };
    let Ok(auth) = serde_json::from_str::<Value>(&serialized) else {
        let _ = entry.delete_credential();
        return Ok(None);
    };
    let token = auth.get("loginToken").and_then(Value::as_str).unwrap_or_default();
    if validate_login_token(token).is_err() {
        let _ = entry.delete_credential();
        return Ok(None);
    }
    set_runtime_discord_auth(&auth);
    Ok(Some(token.to_string()))
}

#[tauri::command]
#[specta::specta]
#[must_use]
pub fn clear_discord_report_auth() -> bool {
    clear_runtime_login_token();
    if let Ok(entry) = report_auth_entry() {
        let _ = entry.delete_credential();
    }
    true
}

async fn read_api_response(response: Response, action: &str) -> crate::error::Result<Value> {
    let status = response.status();
    let payload = response.json::<Value>().await?;
    // standard ok response
    if status.is_success() {
        Ok(payload)
    } else {
        // attempt to extract a useful error message from the payload, otherwise give a generic failure message
        let message = payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Discord reporting request failed");
        Err(format!("{action}: {message}").into())
    }
}

#[tauri::command]
#[specta::specta]
pub fn load_discord_report_auth() -> crate::error::Result<AnyValue> {
    if let Ok(stored) = runtime_discord_auth().lock() {
        if let Some(auth) = stored.as_ref() {
            return Ok(AnyValue(auth.clone()));
        }
    }

    let entry = report_auth_entry()?;
    let Ok(serialized) = entry.get_password() else {
        return Ok(AnyValue(Value::Null));
    };
    let Ok(auth) = serde_json::from_str::<Value>(&serialized) else {
        let _ = entry.delete_credential();
        return Ok(AnyValue(Value::Null));
    };
    let token = auth.get("loginToken").and_then(Value::as_str).unwrap_or_default();
    if validate_login_token(token).is_err() {
        let _ = entry.delete_credential();
        return Ok(AnyValue(Value::Null));
    }
    set_runtime_discord_auth(&auth);
    Ok(AnyValue(auth))
}

#[tauri::command]
#[specta::specta]
pub fn save_discord_report_auth(auth: AnyValue) -> crate::error::Result<bool> {
    let auth = auth.0;
    let token = auth.get("loginToken").and_then(Value::as_str).unwrap_or_default();
    validate_login_token(token)?;
    set_runtime_discord_auth(&auth);
    let Ok(serialized) = serde_json::to_string(&auth) else {
        return Ok(false);
    };
    let Ok(entry) = report_auth_entry() else {
        return Ok(false);
    };
    Ok(entry.set_password(&serialized).is_ok())
}

#[tauri::command]
#[specta::specta]
pub async fn discord_reporting_configured() -> bool {
    report_api_url().await.is_ok()
}

#[tauri::command]
#[specta::specta]
pub async fn start_discord_login(
    window: tauri::Window,
    in_app: Option<bool>,
) -> crate::error::Result<AnyValue> {
    let base_url = report_api_url().await?;
    let response =
        crate::utils::get_http_client().post(format!("{base_url}/oauth/start")).send().await?;
    let payload = read_api_response(response, "Could not start Discord login").await?;
    let authorization_url = payload
        .get("authorizationUrl")
        .and_then(Value::as_str)
        .ok_or("Discord login response did not include an authorization URL.")?;
    // make sure the auth url isn't sketchy
    let is_discord = authorization_url.starts_with("https://discord.com/");
    let is_ism = authorization_url.starts_with("https://ispoofermotion.com/")
        || authorization_url.starts_with("http://localhost:")
        || authorization_url.starts_with("http://127.0.0.1:");
    if !is_discord && !is_ism {
        return Err("Discord login response returned an unsafe authorization URL.".into());
    }

    if !in_app.unwrap_or(false) {
        let _ = window.set_focus();
        use tauri_plugin_opener::OpenerExt;
        window
            .opener()
            .open_url(authorization_url, None::<String>)
            .map_err(|err| format!("Could not open Discord login: {err}"))?;
    }
    Ok(AnyValue(payload))
}

#[tauri::command]
#[specta::specta]
pub async fn open_discord_deep_link(
    window: tauri::Window,
    url: String,
) -> crate::error::Result<bool> {
    if !url.starts_with("discord://-/") {
        return Err("Invalid Discord deep link.".into());
    }

    let _ = window.set_focus();
    use tauri_plugin_opener::OpenerExt;
    match window.opener().open_url(url, None::<String>) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn verify_discord_auth(login_token: String) -> crate::error::Result<AnyValue> {
    validate_login_token(&login_token)?;
    let base_url = report_api_url().await?;
    let payload = json!({ "loginToken": login_token });
    let response = crate::utils::get_http_client()
        .post(format!("{base_url}/oauth/verify"))
        .json(&payload)
        .send()
        .await?;
    let result = read_api_response(response, "Could not verify Discord authorization").await;
    if result.is_ok() {
        let token = payload.get("loginToken").and_then(Value::as_str).unwrap_or_default();
        set_runtime_login_token(token);
    }
    result.map(AnyValue)
}

#[tauri::command]
#[specta::specta]
pub async fn poll_discord_login(session_id: String) -> crate::error::Result<AnyValue> {
    validate_token(&session_id, "Discord login session")?;
    let base_url = report_api_url().await?;
    let response = crate::utils::get_http_client()
        .get(format!("{base_url}/oauth/session/{session_id}"))
        .send()
        .await?;
    read_api_response(response, "Could not check Discord login").await.map(AnyValue)
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_discord_announcements() -> crate::error::Result<AnyValue> {
    let base_url = report_api_url().await?;
    let response =
        crate::utils::get_http_client().get(format!("{base_url}/api/announcements")).send().await?;
    read_api_response(response, "Could not fetch announcements").await.map(AnyValue)
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_discord_poll() -> crate::error::Result<AnyValue> {
    let token = stored_login_token()?.unwrap_or_default();
    validate_login_token(&token)?;
    let base_url = report_api_url().await?;
    let response = crate::utils::get_http_client()
        .post(format!("{base_url}/api/polls/active"))
        .json(&json!({ "loginToken": token }))
        .send()
        .await?;
    read_api_response(response, "Could not fetch feature poll").await.map(AnyValue)
}

#[tauri::command]
#[specta::specta]
pub async fn submit_discord_poll_vote(
    poll_id: String,
    option_ids: Vec<String>,
) -> crate::error::Result<AnyValue> {
    let token = stored_login_token()?.unwrap_or_default();
    validate_login_token(&token)?;
    let base_url = report_api_url().await?;
    // toss the vote to our api so it can count it
    let response = crate::utils::get_http_client()
        .post(format!("{base_url}/api/polls/vote"))
        .json(&json!({
            "loginToken": token,
            "pollId": poll_id,
            "optionIds": option_ids,
        }))
        .send()
        .await?;
    read_api_response(response, "Could not submit poll vote").await.map(AnyValue)
}

#[tauri::command]
#[specta::specta]
pub async fn open_discord_poll(
    title: String,
    description: String,
    options: Vec<String>,
    allow_multiple: bool,
    duration_hours: u32,
) -> crate::error::Result<AnyValue> {
    let token = stored_login_token()?.unwrap_or_default();
    validate_login_token(&token)?;
    let base_url = report_api_url().await?;
    let response = crate::utils::get_http_client()
        .post(format!("{base_url}/api/polls/open"))
        .json(&json!({
            "loginToken": token,
            "title": title,
            "description": description,
            "options": options,
            "allowMultiple": allow_multiple,
            "durationHours": duration_hours,
        }))
        .send()
        .await?;
    read_api_response(response, "Could not open poll").await.map(AnyValue)
}

#[tauri::command]
#[specta::specta]
pub async fn close_discord_poll(poll_id: Option<String>) -> crate::error::Result<AnyValue> {
    let token = stored_login_token()?.unwrap_or_default();
    validate_login_token(&token)?;
    let base_url = report_api_url().await?;
    let response = crate::utils::get_http_client()
        .post(format!("{base_url}/api/polls/close"))
        .json(&json!({
            "loginToken": token,
            "pollId": poll_id.unwrap_or_default(),
        }))
        .send()
        .await?;
    read_api_response(response, "Could not close poll").await.map(AnyValue)
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(transparent)]
pub struct AnyValue(#[specta(type = Option<String>)] pub serde_json::Value);
