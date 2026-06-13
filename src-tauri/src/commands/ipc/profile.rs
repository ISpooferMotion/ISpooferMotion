use super::{build_roblox_cookie_header, AppHandle, ProfileRequest, COOKIE, USER_AGENT};
use crate::commands::discord::AnyValue;
use serde_json::Value;

#[tauri::command]
#[specta::specta]
pub async fn get_roblox_profile(
    app: AppHandle,
    context: ProfileRequest,
) -> crate::error::Result<AnyValue> {
    let auto_detect = context.auto_detect.unwrap_or(false);
    let mut cookie = context.cookie.unwrap_or_default();
    let group_id = context.group_id.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    if cookie.is_empty() && auto_detect {
        match crate::commands::auth::get_cookie_from_auto_detect(None).await {
            Ok(Some(c)) => cookie = c,
            _ => return Ok(AnyValue(Value::Null)),
        }
    }
    if cookie.is_empty() {
        return Ok(AnyValue(Value::Null));
    }

    let cookie_header = build_roblox_cookie_header(&cookie);
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;

    let user_resp = client
        .get("https://users.roblox.com/v1/users/authenticated")
        .header(COOKIE, &cookie_header)
        .header(USER_AGENT, "RobloxStudio/WinInet")
        .send()
        .await?;

    crate::utils::check_for_roblosecurity_update(&app, &user_resp, &cookie_header);

    if !user_resp.status().is_success() {
        return Ok(AnyValue(Value::Null));
    }

    let user_data: Value = user_resp.json().await?;
    let user_id = user_data.get("id").and_then(serde_json::Value::as_u64);
    let username = user_data
        .get("name")
        .or(user_data.get("displayName"))
        .and_then(|n| n.as_str())
        .unwrap_or("Unknown");

    let Some(user_id) = user_id else {
        return Ok(AnyValue(Value::Null));
    };

    let avatar_resp = client.get(format!(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={user_id}&size=150x150&format=Png&isCircular=true"
    ))
    .send().await;

    let avatar_url = if let Ok(resp) = avatar_resp {
        let data: Value = resp.json().await.unwrap_or(Value::Null);
        data.get("data")
            .and_then(|d| d.as_array())
            .and_then(|arr| arr.first())
            .and_then(|item| item.get("imageUrl"))
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        String::new()
    };

    let mut group_info = Value::Null;
    if let Some(gid) = &group_id {
        if let Ok(g_resp) =
            client.get(format!("https://groups.roblox.com/v1/groups/{gid}")).send().await
        {
            if let Ok(g_data) = g_resp.json::<Value>().await {
                let g_name = g_data.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown Group");

                let g_icon_url = if let Ok(icon_resp) = client.get(format!(
                    "https://thumbnails.roblox.com/v1/groups/icons?groupIds={gid}&size=150x150&format=Png&isCircular=true"
                )).send().await {
                    let icon_data: Value = icon_resp.json().await.unwrap_or(Value::Null);
                    icon_data.get("data").and_then(|d| d.as_array()).and_then(|arr| arr.first())
                        .and_then(|item| item.get("imageUrl")).and_then(|u| u.as_str())
                        .unwrap_or("").to_string()
                } else {
                    String::new()
                };

                group_info = serde_json::json!({
                    "id": gid,
                    "name": g_name,
                    "iconUrl": g_icon_url
                });
            }
        }
    }

    Ok(AnyValue(serde_json::json!({
        "user": {
            "id": user_id,
            "name": username,
            "avatarUrl": avatar_url
        },
        "group": group_info
    })))
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_audio_quota(
    app: AppHandle,
    cookie: Option<String>,
    auto_detect: Option<bool>,
    context: Option<AnyValue>,
) -> crate::error::Result<AnyValue> {
    let mut cookie_val = cookie.unwrap_or_default();

    if cookie_val.is_empty() {
        if let Some(ctx) = &context {
            cookie_val = ctx.0.get("cookie").and_then(|c| c.as_str()).unwrap_or("").to_string();
            if cookie_val.is_empty()
                && ctx.0.get("autoDetect").and_then(serde_json::Value::as_bool).unwrap_or(false)
            {
                match crate::commands::auth::get_cookie_from_auto_detect(None).await {
                    Ok(Some(c)) => cookie_val = c,
                    _ => return Ok(AnyValue(serde_json::json!({"error": "No cookie provided"}))),
                }
            }
        }
    }

    if cookie_val.is_empty() && auto_detect.unwrap_or(false) {
        match crate::commands::auth::get_cookie_from_auto_detect(None).await {
            Ok(Some(c)) => cookie_val = c,
            _ => return Ok(AnyValue(serde_json::json!({"error": "No cookie provided"}))),
        }
    }

    if cookie_val.is_empty() {
        return Ok(AnyValue(serde_json::json!({"error": "No cookie provided"})));
    }

    let cookie_header = build_roblox_cookie_header(&cookie_val);
    if cookie_header.is_empty() {
        return Ok(AnyValue(serde_json::json!({"error": "Invalid ROBLOSECURITY cookie format"})));
    }

    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build()?;

    let resp = client.get("https://publish.roblox.com/v1/asset-quotas?resourceType=RateLimitUpload&assetType=Audio")
        .header(COOKIE, &cookie_header)
        .header(USER_AGENT, "RobloxStudio/WinInet")
        .send().await?;

    crate::utils::check_for_roblosecurity_update(&app, &resp, &cookie_header);

    if !resp.status().is_success() {
        return Ok(AnyValue(
            serde_json::json!({"error": format!("Failed to fetch quota: {}", resp.status())}),
        ));
    }

    let data: Value = resp.json().await?;
    Ok(AnyValue(data))
}
