pub mod cookies;
pub mod validation;

use crate::utils::check_for_roblosecurity_update;
pub use cookies::{
    get_cookie_from_browser_profiles, get_cookie_from_roblox_studio_inner, profile_cookie_entry,
};
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, USER_AGENT};
use tauri::AppHandle;
pub use validation::{
    fetch_csrf_token_internal, force_refresh_csrf_token, ApiKeyOwnerDetectResult, AuthResponse,
    RobloxGroup, RobloxUserInfo, ROBLOX_USER_AGENT,
};

#[tauri::command]
#[specta::specta]
pub async fn get_cookie_from_roblox_studio(
    user_id: Option<String>,
) -> crate::error::Result<Option<String>> {
    tokio::task::spawn_blocking(move || get_cookie_from_roblox_studio_inner(user_id))
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Task failed: {e}")))?
}

#[tauri::command]
#[specta::specta]
pub async fn get_cookie_from_auto_detect(
    user_id: Option<String>,
) -> crate::error::Result<Option<String>> {
    tokio::task::spawn_blocking(move || {
        if let Some(cookie) = get_cookie_from_roblox_studio_inner(user_id)? {
            return Ok(Some(cookie));
        }
        Ok(get_cookie_from_browser_profiles())
    })
    .await
    .map_err(|e| crate::error::AppError::Custom(format!("Task failed: {e}")))?
}

#[tauri::command]
#[specta::specta]
pub async fn delete_saved_roblox_profile_cookie(user_id: String) -> crate::error::Result<bool> {
    let entry = profile_cookie_entry(&user_id)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(true),
        Err(e) => Err(crate::error::AppError::Custom(format!(
            "Failed to delete saved profile cookie: {e}"
        ))),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_csrf_token(app: AppHandle, cookie: String) -> crate::error::Result<String> {
    fetch_csrf_token_internal(Some(app), cookie).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_authenticated_user_id(
    app: AppHandle,
    cookie: String,
) -> crate::error::Result<String> {
    let url = "https://users.roblox.com/v1/users/authenticated";
    let cookie_header_str = if cookie.starts_with(".ROBLOSECURITY=") {
        cookie.clone()
    } else {
        format!(".ROBLOSECURITY={cookie}")
    };

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;

    let mut headers = HeaderMap::new();
    headers.insert(COOKIE, HeaderValue::from_str(&cookie_header_str)?);
    headers.insert(USER_AGENT, HeaderValue::from_static(ROBLOX_USER_AGENT));

    let res = client
        .get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Network error: {e}")))?;

    check_for_roblosecurity_update(&app, &res, &cookie_header_str);

    if !res.status().is_success() {
        return Err(format!("Failed to get authenticated user ID ({})", res.status()).into());
    }
    let data: AuthResponse = res
        .json()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Invalid JSON: {e}")))?;
    Ok(data.id.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn get_roblox_user_info(user_id: String) -> crate::error::Result<RobloxUserInfo> {
    let trimmed = user_id.trim();
    if !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid user_id".into());
    }
    let url = format!("https://users.roblox.com/v1/users/{trimmed}");
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;
    let res = client
        .get(&url)
        .header("User-Agent", ROBLOX_USER_AGENT)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Network error: {e}")))?;

    if !res.status().is_success() {
        return Err(format!("Failed to get user info ({})", res.status()).into());
    }
    let data: RobloxUserInfo = res
        .json()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Invalid JSON: {e}")))?;
    Ok(data)
}

#[tauri::command]
#[specta::specta]
pub async fn get_roblox_user_avatar(user_id: String) -> crate::error::Result<String> {
    let trimmed = user_id.trim();
    if !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid user_id".into());
    }
    let url = format!(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={trimmed}&size=150x150&format=Png&isCircular=true"
    );
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;
    let res = client
        .get(&url)
        .header("User-Agent", ROBLOX_USER_AGENT)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Network error: {e}")))?;

    if !res.status().is_success() {
        return Err(format!("Failed to get avatar thumbnail ({})", res.status()).into());
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Invalid JSON: {e}")))?;

    let image_url = json["data"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|item| item["imageUrl"].as_str())
        .ok_or_else(|| crate::error::AppError::Custom("No avatar image URL found".to_string()))?
        .to_string();

    Ok(image_url)
}

#[tauri::command]
#[specta::specta]
pub async fn get_manageable_groups(
    app: AppHandle,
    cookie: String,
) -> crate::error::Result<Vec<RobloxGroup>> {
    let url = "https://develop.roblox.com/v1/user/groups/canmanage";
    let cookie_header_str = if cookie.starts_with(".ROBLOSECURITY=") {
        cookie.clone()
    } else {
        format!(".ROBLOSECURITY={cookie}")
    };

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;

    let mut headers = HeaderMap::new();
    headers.insert(COOKIE, HeaderValue::from_str(&cookie_header_str)?);
    headers.insert(USER_AGENT, HeaderValue::from_static(ROBLOX_USER_AGENT));

    let res = client
        .get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Network error: {e}")))?;

    check_for_roblosecurity_update(&app, &res, &cookie_header_str);

    if !res.status().is_success() {
        return Err(format!("Failed to get manageable groups ({})", res.status()).into());
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Invalid JSON: {e}")))?;

    let groups = json["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let id = item["id"].as_i64()?;
                    let name = item["name"].as_str()?.to_string();
                    Some(RobloxGroup { id, name })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(groups)
}

#[tauri::command]
#[specta::specta]
pub async fn get_group_icon(group_id: String) -> crate::error::Result<String> {
    let trimmed = group_id.trim();
    if !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid group_id".into());
    }
    let url = format!(
        "https://thumbnails.roblox.com/v1/groups/icons?groupIds={trimmed}&size=150x150&format=Png&isCircular=true"
    );
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;
    let res = client
        .get(&url)
        .header("User-Agent", ROBLOX_USER_AGENT)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Network error: {e}")))?;

    if !res.status().is_success() {
        return Err(format!("Failed to get group icon ({})", res.status()).into());
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Invalid JSON: {e}")))?;

    let image_url = json["data"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|item| item["imageUrl"].as_str())
        .ok_or_else(|| crate::error::AppError::Custom("No group icon URL found".to_string()))?
        .to_string();

    Ok(image_url)
}

#[tauri::command]
#[specta::specta]
pub async fn detect_opencloud_api_key_owner(
    key: String,
) -> crate::error::Result<ApiKeyOwnerDetectResult> {
    let key = key.trim();
    if key.is_empty() {
        return Ok(ApiKeyOwnerDetectResult {
            ok: false,
            owner_user_id: None,
            message: "API key is required to detect owner.".to_string(),
        });
    }

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;

    let payload = serde_json::json!({
        "assetType": "Audio",
        "displayName": "ownership-probe",
        "description": "probe",
        "creationContext": { "creator": { "userId": "1" } }
    });

    let part = reqwest::multipart::Part::bytes(vec![0])
        .file_name("probe.ogg")
        .mime_str("audio/ogg")
        .map_err(|e| crate::error::AppError::Custom(format!("MIME error: {e}")))?;

    let form = reqwest::multipart::Form::new()
        .text("request", serde_json::to_string(&payload).unwrap_or_default())
        .part("fileContent", part);

    let res = client
        .post("https://apis.roblox.com/assets/v1/assets")
        .header("x-api-key", key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Network error: {e}")))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(ApiKeyOwnerDetectResult {
            ok: false,
            owner_user_id: None,
            message: "API key is invalid or unauthorized.".to_string(),
        });
    }

    let re = Regex::new(r"(?i)User\s+(\d+)\s+is\s+unauthorized")
        .map_err(|e| crate::error::AppError::Custom(format!("Regex error: {e}")))?;
    if let Some(caps) = re.captures(&text) {
        if let Some(owner) = caps.get(1) {
            return Ok(ApiKeyOwnerDetectResult {
                ok: true,
                owner_user_id: Some(owner.as_str().to_string()),
                message: format!("Detected API key owner: user {}.", owner.as_str()),
            });
        }
    }

    Ok(ApiKeyOwnerDetectResult {
        ok: false,
        owner_user_id: None,
        message: "Could not detect owner from response.".to_string(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn validate_opencloud_api_key(key: String) -> crate::error::Result<bool> {
    let result = detect_opencloud_api_key_owner(key).await?;

    Ok(result.ok)
}

#[tauri::command]
#[specta::specta]
pub async fn get_auth_metadata() -> crate::error::Result<crate::commands::discord::AnyValue> {
    let url = "https://auth.roblox.com/v2/metadata";
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;

    let res = client
        .get(url)
        .header("User-Agent", ROBLOX_USER_AGENT)
        .send()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Network error: {e}")))?;

    if !res.status().is_success() {
        return Err(format!("Failed to get auth metadata ({})", res.status()).into());
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| crate::error::AppError::Custom(format!("Invalid JSON: {e}")))?;

    Ok(crate::commands::discord::AnyValue(json))
}
