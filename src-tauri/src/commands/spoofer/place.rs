use super::{
    build_roblox_cookie_header, get_asset_cache, is_valid_numeric_id, set_rate_limit,
    wait_rate_limit, AppHandle, Duration, Manager, RateLimitBucket, Value, COOKIE,
};
use std::collections::HashSet;

#[must_use]
pub fn parse_excluded_id_list(raw: Option<&str>) -> HashSet<String> {
    let mut ids = HashSet::new();
    for candidate in raw
        .unwrap_or_default()
        .split(|character: char| character == ',' || character.is_whitespace())
    {
        let trimmed = candidate.trim();
        if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit()) {
            ids.insert(trimmed.to_string());
        }
    }
    ids
}

pub async fn should_skip_asset_for_spoofing(
    app: AppHandle,
    asset_id: &str,
    cookie: &str,
    skip_owned: bool,
    account_id: Option<&str>,
    group_id: Option<&str>,
    excluded_users: &HashSet<String>,
    excluded_groups: &HashSet<String>,
) -> bool {
    let Ok((creator_type, creator_id)) =
        get_asset_creator_for_asset(app, asset_id.to_string(), cookie.to_string()).await
    else {
        return false;
    };

    if creator_type == "user" && excluded_users.contains(&creator_id) {
        return true;
    }
    if creator_type == "group" && excluded_groups.contains(&creator_id) {
        return true;
    }

    if !skip_owned {
        return false;
    }

    if creator_type == "user" {
        return account_id.is_some_and(|id| id == creator_id);
    }
    if creator_type == "group" {
        return group_id.is_some_and(|id| id == creator_id);
    }

    false
}

pub async fn get_place_ids_for_asset_creator(
    app: AppHandle,
    asset_id: String,
    cookie: String,
    max_place_ids: Option<u32>,
) -> crate::error::Result<Vec<String>> {
    let (creator_type, creator_id) =
        get_asset_creator_for_asset(app.clone(), asset_id, cookie.clone()).await?;

    get_place_id_from_creator(app, creator_type, creator_id, cookie, max_place_ids).await
}

pub async fn get_asset_creator_for_asset(
    app: AppHandle,
    asset_id: String,
    cookie: String,
) -> crate::error::Result<(String, String)> {
    if !is_valid_numeric_id(&asset_id) {
        return Err("Invalid Roblox asset id.".into());
    }

    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err(crate::error::AppError::Custom(
            "Missing or invalid ROBLOSECURITY cookie".into(),
        ));
    }

    let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).build()?;
    let url = format!("https://apis.roblox.com/assets/user-auth/v1/assets/{asset_id}");
    let resp = client
        .get(&url)
        .header(reqwest::header::COOKIE, &cookie_header)
        .header(reqwest::header::USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")
        .header(reqwest::header::ACCEPT, "*/*")
        .header("Origin", "https://create.roblox.com")
        .header("Referer", "https://create.roblox.com/")
        .send()
        .await?;

    crate::utils::check_for_roblosecurity_update(&app, &resp, &cookie_header);

    if !resp.status().is_success() {
        return get_asset_creator_from_economy(&asset_id, &cookie_header).await.ok_or_else(|| {
            crate::error::AppError::Custom(format!(
                "Failed to resolve asset creator: {}",
                resp.status()
            ))
        });
    }

    let data: Value = resp.json().await?;
    let creator = data.get("creationContext").and_then(|ctx| ctx.get("creator"));
    let (creator_type, creator_id) = if let Some(user_id) =
        creator.and_then(|c| c.get("userId")).and_then(value_to_string)
    {
        ("user".to_string(), user_id)
    } else if let Some(group_id) = creator.and_then(|c| c.get("groupId")).and_then(value_to_string)
    {
        ("group".to_string(), group_id)
    } else if let Some(fallback) = get_asset_creator_from_economy(&asset_id, &cookie_header).await {
        fallback
    } else {
        return Err(crate::error::AppError::Custom(
            "Asset creator was not present in Roblox response.".into(),
        ));
    };

    Ok((creator_type, creator_id))
}

async fn get_asset_creator_from_economy(
    asset_id: &str,
    cookie_header: &str,
) -> Option<(String, String)> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().ok()?;
    let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
    let resp = client
        .get(&url)
        .header(reqwest::header::COOKIE, cookie_header)
        .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let data: Value = resp.json().await.ok()?;
    let creator = data.get("Creator")?;
    let creator_id = creator.get("CreatorTargetId").and_then(value_to_string)?;
    let creator_type = creator
        .get("CreatorType")
        .or_else(|| creator.get("creatorType"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();

    if creator_type.contains("group") {
        Some(("group".to_string(), creator_id))
    } else if creator_type.contains("user") {
        Some(("user".to_string(), creator_id))
    } else {
        None
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_u64()
        .map(|number| number.to_string())
        .or_else(|| value.as_str().map(std::string::ToString::to_string))
        .filter(|id| is_valid_numeric_id(id))
}

#[tauri::command]
#[specta::specta]
pub async fn get_place_id_from_creator(
    app: AppHandle,
    creator_type: String,
    creator_id: String,
    cookie: String,
    max_place_ids: Option<u32>,
) -> crate::error::Result<Vec<String>> {
    if !is_valid_numeric_id(&creator_id) {
        return Err("Invalid Roblox creator id.".into());
    }
    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err(crate::error::AppError::Custom(
            "Missing or invalid ROBLOSECURITY cookie".into(),
        ));
    }

    let limit = 50;
    let max_results = max_place_ids.unwrap_or(10).min(100);

    let is_group = creator_type.eq_ignore_ascii_case("group");
    let mut root_places_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut cursor = String::new();
    let client = crate::utils::get_http_client();

    while root_places_set.len() < max_results as usize {
        let mut url = if is_group {
            format!("https://games.roblox.com/v2/groups/{creator_id}/games?limit={limit}")
        } else {
            format!(
                "https://games.roblox.com/v2/users/{creator_id}/games?limit={limit}&sortOrder=Asc"
            )
        };

        if !cursor.is_empty() {
            url.push_str(&format!("&cursor={cursor}"));
        }

        wait_rate_limit(RateLimitBucket::PlaceLookup).await;
        let resp = client
            .get(&url)
            .header(reqwest::header::COOKIE, &cookie_header)
            .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
            .send()
            .await?;

        crate::utils::check_for_roblosecurity_update(&app, &resp, &cookie_header);

        if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let wait_ms = crate::utils::extract_retry_after(&resp).unwrap_or(2_000);
            set_rate_limit(RateLimitBucket::PlaceLookup, Duration::from_millis(wait_ms));
            tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            continue;
        }

        if !resp.status().is_success() {
            return Err(crate::error::AppError::Custom(format!(
                "Failed to get games: {}",
                resp.status()
            )));
        }

        let data: serde_json::Value = resp.json().await?;

        let games = data.get("data").and_then(|d| d.as_array()).ok_or_else(|| {
            crate::error::AppError::Custom("Invalid games response format".into())
        })?;
        if games.is_empty() {
            break;
        }

        for game in games {
            let place_id = game
                .get("rootPlace")
                .and_then(|rp| rp.get("id"))
                .or_else(|| game.get("rootPlaceId"))
                .or_else(|| game.get("placeId"))
                .or_else(|| game.get("id"))
                .and_then(|id| {
                    id.as_u64()
                        .map(|n| n.to_string())
                        .or_else(|| id.as_str().map(std::string::ToString::to_string))
                });

            if let Some(pid) = place_id {
                root_places_set.insert(pid);
            }
            if root_places_set.len() >= max_results as usize {
                break;
            }
        }

        if let Some(next_cursor) = data.get("nextPageCursor").and_then(|c| c.as_str()) {
            cursor = next_cursor.to_string();
        } else {
            break;
        }
    }

    if root_places_set.is_empty() {
        return Err(crate::error::AppError::Custom("No root places found in games".into()));
    }

    Ok(root_places_set.into_iter().collect())
}

#[tauri::command]
#[specta::specta]
pub async fn get_multiple_place_ids(
    app: AppHandle,
    creator_type: String,
    creator_id: String,
    cookie: String,
    max_place_ids: Option<u32>,
) -> crate::error::Result<Vec<String>> {
    get_place_id_from_creator(app, creator_type, creator_id, cookie, max_place_ids).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_universe_id_from_place_id(
    place_id: String,
    cookie: String,
) -> crate::error::Result<String> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    let client = crate::utils::get_http_client();
    let url =
        format!("https://games.roblox.com/v1/games/multiget-place-details?placeIds={place_id}");

    let resp = client.get(&url).header(COOKIE, cookie_header).send().await?;

    if !resp.status().is_success() {
        return Err("Failed to resolve Universe ID".into());
    }

    let data: serde_json::Value = resp.json().await?;
    let universe_id =
        data.as_array().and_then(|arr| arr.first()).and_then(|obj| obj.get("universeId")).and_then(
            |id| {
                id.as_u64().map(|n| n.to_string()).or_else(|| id.as_str().map(ToString::to_string))
            },
        );

    universe_id.ok_or_else(|| "Universe ID not found".into())
}

#[tauri::command]
#[specta::specta]
pub async fn clear_downloads_directory_command(app: AppHandle) -> crate::error::Result<bool> {
    let downloads_dir = app.path().app_data_dir()?.join("downloads");
    crate::utils::clear_downloads_directory(&downloads_dir).await.map_err(Into::into)
}

#[tauri::command]
#[specta::specta]
pub async fn find_asset_by_name(
    cookie: String,
    asset_type: String,
    name: String,
    group_id: Option<String>,
) -> crate::error::Result<Option<String>> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Ok(None);
    }

    let cache_key = format!("{}_{}", asset_type, group_id.as_deref().unwrap_or("user"));
    {
        let cache = get_asset_cache();
        if let Some(items) = cache.get(&cache_key) {
            if let Some(id) = items.value().get(&name) {
                return Ok(Some(id.value().clone()));
            }
        }
    }

    let mut cursor = String::new();
    let mut base_url = format!("https://itemconfiguration.roblox.com/v1/creations/get-assets?assetType={asset_type}&isArchived=false&limit=100");
    if let Some(gid) = &group_id {
        if !is_valid_numeric_id(gid) {
            return Err("Invalid Roblox group id.".into());
        }
        base_url.push_str(&format!("&groupId={gid}"));
    }

    let client = crate::utils::get_http_client();

    loop {
        let mut url = base_url.clone();
        if !cursor.is_empty() {
            url.push_str(&format!("&cursor={cursor}"));
        }

        wait_rate_limit(RateLimitBucket::PlaceLookup).await;
        let resp = client
            .get(&url)
            .header(reqwest::header::COOKIE, &cookie_header)
            .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
            .send()
            .await?;

        if resp.status().as_u16() == 429 {
            let wait_ms = crate::utils::extract_retry_after(&resp).unwrap_or(2000);
            set_rate_limit(RateLimitBucket::PlaceLookup, Duration::from_millis(wait_ms));
            tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            continue;
        }
        if !resp.status().is_success() {
            break;
        }

        let data: serde_json::Value = resp.json().await?;
        let items = data.get("data").and_then(|d| d.as_array()).ok_or("Invalid response format")?;

        let mut found = None;
        {
            let cache = get_asset_cache();
            let entry = cache.entry(cache_key.clone()).or_default();
            for item in items {
                if let (Some(item_name), Some(asset_id)) = (
                    item.get("name").and_then(|n| n.as_str()),
                    item.get("assetId").and_then(|id| {
                        id.as_u64()
                            .map(|n| n.to_string())
                            .or_else(|| id.as_str().map(std::string::ToString::to_string))
                    }),
                ) {
                    entry.value().insert(item_name.to_string(), asset_id.clone());
                    if item_name == name {
                        found = Some(asset_id);
                    }
                }
            }
        }

        if found.is_some() {
            return Ok(found);
        }

        if let Some(next_cursor) = data.get("nextPageCursor").and_then(|c| c.as_str()) {
            cursor = next_cursor.to_string();
        } else {
            break;
        }
    }

    Ok(None)
}
