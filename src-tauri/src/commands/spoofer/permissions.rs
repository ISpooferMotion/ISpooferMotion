use super::{build_roblox_cookie_header, COOKIE};

#[tauri::command]
#[specta::specta]
pub async fn patch_asset_permissions(
    asset_id: String,
    universe_id: String,
    cookie: String,
    csrf_token: String,
) -> crate::error::Result<bool> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    let client = crate::utils::get_http_client();
    let url =
        format!("https://apis.roblox.com/asset-permissions-api/v1/assets/{asset_id}/permissions");

    let body = serde_json::json!({
        "requests": [
            {
                "subjectType": "Universe",
                "subjectId": universe_id,
                "action": "Use"
            }
        ]
    });

    for attempt in 0..3u8 {
        let res = client
            .patch(&url)
            .header(COOKIE, cookie_header.clone())
            .header("x-csrf-token", &csrf_token)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;
        match res {
            Ok(r) if r.status().is_success() => {
                break;
            }
            Ok(r) if r.status().is_server_error() => {
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
            Ok(r) => {
                return Err(format!("Permission patch failed: {}", r.status()).into());
            }
            Err(e) => {
                return Err(e.into());
            }
        }
    }

    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn set_asset_privacy(
    asset_id: String,
    privacy_status: String,
    cookie: String,
    csrf_token: String,
) -> crate::error::Result<bool> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    let client = crate::utils::get_http_client();
    let url = format!("https://apis.roblox.com/asset-privacy/v1/assets/{asset_id}/privacy");

    let body = serde_json::json!({
        "privacyStatus": privacy_status
    });

    let resp = client
        .post(&url)
        .header(COOKIE, cookie_header)
        .header("x-csrf-token", csrf_token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        return Err(format!(
            "Failed to update asset privacy: {}",
            resp.text().await.unwrap_or_default()
        )
        .into());
    }

    Ok(true)
}
