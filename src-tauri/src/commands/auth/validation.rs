use crate::utils::check_for_roblosecurity_update;
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub const ROBLOX_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Serialize, Deserialize, Debug, specta::Type)]
pub struct AuthResponse {
    #[specta(type = f64)]
    pub id: i64,
}

pub async fn force_refresh_csrf_token(cookie: String) -> crate::error::Result<String> {
    fetch_csrf_token_internal(None, cookie).await
}

pub async fn fetch_csrf_token_internal(
    app: Option<AppHandle>,
    cookie: String,
) -> crate::error::Result<String> {
    let url = "https://auth.roblox.com/v2/logout";
    let cookie_header_str = if cookie.starts_with(".ROBLOSECURITY=") {
        cookie.clone()
    } else {
        format!(".ROBLOSECURITY={cookie}")
    };

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;

    let mut headers = HeaderMap::new();
    headers.insert(COOKIE, HeaderValue::from_str(&cookie_header_str)?);
    headers.insert(USER_AGENT, HeaderValue::from_static(ROBLOX_USER_AGENT));

    let res = client.post(url).headers(headers).send().await.map_err(|e| {
        crate::error::AppError::Custom(format!("Network error fetching CSRF token: {e}"))
    })?;

    if let Some(app) = app {
        check_for_roblosecurity_update(&app, &res, &cookie_header_str);
    }

    if let Some(token) = res.headers().get("x-csrf-token") {
        Ok(token.to_str().unwrap_or("").to_string())
    } else {
        Err(crate::error::AppError::Custom("No X-CSRF-TOKEN in response header.".to_string()))
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
pub struct RobloxUserInfo {
    #[specta(type = f64)]
    pub id: i64,
    pub name: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
pub struct RobloxGroup {
    #[specta(type = f64)]
    pub id: i64,
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, specta::Type)]
pub struct ApiKeyOwnerDetectResult {
    pub ok: bool,
    #[serde(rename = "ownerUserId")]
    pub owner_user_id: Option<String>,
    pub message: String,
}
