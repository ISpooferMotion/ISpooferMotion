use crate::utils::build_roblox_cookie_header;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, COOKIE, ORIGIN, REFERER, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

#[derive(Serialize, Deserialize, Clone, Debug, specta::Type)]
pub struct ResolverAsset {
    #[serde(rename = "assetId")]
    pub asset_id: String,
    pub name: Option<String>,
    pub creator: Option<String>,
    #[serde(rename = "creatorId")]
    pub creator_id: Option<String>,
    #[serde(rename = "creatorType")]
    pub creator_type: Option<String>,
}

#[derive(Serialize, Clone, specta::Type)]
pub struct ResolverProgress {
    #[specta(type = u32)]
    pub resolved: usize,
    #[specta(type = u32)]
    pub total: usize,
    pub message: String,
    pub asset_id: String,
    pub success: Option<bool>,
}

fn emit_resolver_progress(app: &AppHandle, payload: ResolverProgress) {
    let _ = app.emit("resolver-progress", payload);
}

#[derive(Deserialize, Debug, specta::Type)]
struct RobloxCreatorContext {
    pub creator: Option<RobloxCreatorIds>,
}

#[derive(Deserialize, Debug, specta::Type)]
struct RobloxCreatorIds {
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
}

#[derive(Deserialize, Debug, specta::Type)]
struct RobloxAssetAuthResponse {
    #[serde(rename = "creationContext")]
    pub creation_context: Option<RobloxCreatorContext>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    pub name: Option<String>,
}

#[tauri::command]
#[specta::specta]
// try to resolve the original creator of an asset so we can check ownership and permissions later
pub async fn resolve_asset_creators(
    app: AppHandle,
    assets: Vec<ResolverAsset>,
    cookie: String,
) -> crate::error::Result<Vec<ResolverAsset>> {
    let cookie_header = build_roblox_cookie_header(&cookie);
    if cookie_header.is_empty() {
        return Err("Missing or invalid ROBLOSECURITY cookie".into());
    }

    let mut needs_resolution = Vec::new();
    let mut resolved_assets = Vec::new();

    for asset in assets {
        if asset.creator.as_deref() == Some("Unknown") || asset.creator.is_none() {
            needs_resolution.push(asset);
        } else {
            resolved_assets.push(asset);
        }
    }

    let total = needs_resolution.len();
    if total == 0 {
        return Ok(resolved_assets);
    }

    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build()?;

    let cookie_header_value = HeaderValue::from_str(&cookie_header)?;

    // limit concurrent requests so we don't get instantly rate limited by roblox
    let semaphore = Arc::new(Semaphore::new(8));
    let client = Arc::new(client);
    let cookie_header_value = Arc::new(cookie_header_value);
    let app_arc = Arc::new(app);

    let mut tasks = Vec::new();

    for asset in needs_resolution {
        let sem = Arc::clone(&semaphore);
        let cli = Arc::clone(&client);
        let cookie_value = Arc::clone(&cookie_header_value);
        let app_clone = Arc::clone(&app_arc);

        tasks.push(tokio::spawn(async move {
            let mut resolved_asset = asset.clone();
            let Ok(_permit) = sem.acquire().await else {
                return (resolved_asset, "Resolver concurrency limiter closed".to_string(), false);
            };

            let mut headers = HeaderMap::new();
            headers.insert(COOKIE, (*cookie_value).clone());
            headers.insert("Host", HeaderValue::from_static("apis.roblox.com"));
            headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"));
            headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
            headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
            headers.insert(ORIGIN, HeaderValue::from_static("https://create.roblox.com"));
            headers.insert(REFERER, HeaderValue::from_static("https://create.roblox.com/"));

            let url = format!("https://apis.roblox.com/assets/user-auth/v1/assets/{}", asset.asset_id);
            let mut success = false;
            let mut msg = String::new();

            // retry loop for rate limits or random network hiccups
            for attempt in 0..3 {
                if attempt > 0 {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }

                let res = cli.get(&url).headers(headers.clone()).send().await;
                match res {
                    Ok(resp) => {
                        if let Ok(cookie_str) = (*cookie_value).to_str() {
                            crate::utils::check_for_roblosecurity_update(&app_clone, &resp, cookie_str);
                        }

                        if resp.status().as_u16() == 429 {
                            msg = format!("Rate limited, retrying ({}/3)", attempt + 1);
                            emit_resolver_progress(&app_clone, ResolverProgress {
                                resolved: 0, total: 0, message: msg.clone(), asset_id: asset.asset_id.clone(), success: None
                            });
                            continue;
                        }

                        if resp.status().is_success() {
                            if let Ok(data) = resp.json::<RobloxAssetAuthResponse>().await {
                                if let Some(dn) = data.display_name.or(data.name) {
                                    resolved_asset.name = Some(dn);
                                }

                                if let Some(ctx) = data.creation_context {
                                    if let Some(c) = ctx.creator {

                                        if let Some(uid) = c.user_id {
                                            resolved_asset.creator_id = Some(uid.clone());
                                            resolved_asset.creator_type = Some("User".into());
                                            resolved_asset.creator = Some(uid.clone());
                                            success = true;
                                            msg = format!("Found: User {uid}");
                                        } else if let Some(gid) = c.group_id {
                                            resolved_asset.creator_id = Some(gid.clone());
                                            resolved_asset.creator_type = Some("Group".into());
                                            resolved_asset.creator = Some(gid.clone());
                                            success = true;
                                            msg = format!("Found: Group {gid}");
                                        }
                                    }
                                }
                                if !success {
                                    msg = "No creator info in response".to_string();
                                }
                            } else {
                                msg = "Failed to parse API response".to_string();
                            }
                        } else {
                            msg = format!("API returned {}", resp.status());
                        }
                        break;
                    },
                    Err(e) => {
                        msg = format!("Request error: {e}");
                    }
                }
            }

            (resolved_asset, msg, success)
        }));
    }

    let results = futures::future::join_all(tasks).await;
    for (index, (asset, msg, success)) in results.into_iter().flatten().enumerate() {
        emit_resolver_progress(
            &app_arc,
            ResolverProgress {
                resolved: index + 1,
                total,
                message: msg,
                asset_id: asset.asset_id.clone(),
                success: Some(success),
            },
        );
        resolved_assets.push(asset);
    }

    Ok(resolved_assets)
}

#[derive(Deserialize, Debug, specta::Type)]
struct EconomyAssetDetails {
    #[serde(rename = "AssetTypeId")]
    pub asset_type_id: Option<i64>,
}

#[derive(Serialize, Clone, specta::Type)]
pub struct ScriptRefProgress {
    #[specta(type = u32)]
    pub resolved: usize,
    #[specta(type = u32)]
    pub total: usize,
    pub asset_id: String,
    pub resolved_category: Option<String>,
}

fn emit_script_ref_progress(app: &AppHandle, payload: ScriptRefProgress) {
    let _ = app.emit("script-ref-progress", payload);
}

#[tauri::command]
#[specta::specta]
// scrape the economy api to figure out what type of asset a given id actually is
pub async fn resolve_script_references(
    app: AppHandle,
    asset_ids: Vec<String>,
) -> crate::error::Result<HashMap<String, String>> {
    let client = Arc::new(reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?);

    let semaphore = Arc::new(Semaphore::new(6));
    let mut resolved_map = HashMap::new();
    let total = asset_ids.len();

    if total == 0 {
        return Ok(resolved_map);
    }

    let mut tasks = Vec::new();
    let app_arc = Arc::new(app);

    let resolved_count = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    for asset_id in asset_ids {
        let sem = Arc::clone(&semaphore);
        let cli = Arc::clone(&client);
        let app_arc_clone = Arc::clone(&app_arc);
        let count_clone = Arc::clone(&resolved_count);

        tasks.push(tokio::spawn(async move {
            let Ok(_permit) = sem.acquire().await else {
                return (asset_id, None, false);
            };

            let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
            let mut category = None;
            let mut is_false_positive = false;

            for attempt in 0..4 {
                if attempt > 0 {
                    tokio::time::sleep(Duration::from_millis(2000 * attempt)).await;
                }

                if let Ok(resp) = cli.get(&url).send().await {
                    if resp.status().as_u16() == 429 {
                        continue;
                    }
                    if resp.status().as_u16() == 404 {
                        is_false_positive = true;
                        break;
                    }
                    if resp.status().is_success() {
                        if let Ok(data) = resp.json::<EconomyAssetDetails>().await {
                            if let Some(type_id) = data.asset_type_id {
                                category = match type_id {
                                    24 => Some("animation".to_string()),
                                    3 => Some("sound".to_string()),
                                    1 | 11 | 13 | 2 | 21 | 22 | 38 => Some("image".to_string()),
                                    40 | 43 | 17 | 12 => Some("mesh".to_string()),
                                    0 => {
                                        is_false_positive = true;
                                        None
                                    }
                                    _ => None,
                                };
                            }
                        }
                    }
                    break;
                }
            }

            let current_resolved =
                count_clone.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            emit_script_ref_progress(
                &app_arc_clone,
                ScriptRefProgress {
                    resolved: current_resolved,
                    total,
                    asset_id: asset_id.clone(),
                    resolved_category: if is_false_positive {
                        Some("false_positive".to_string())
                    } else {
                        category.clone()
                    },
                },
            );

            (asset_id, category, is_false_positive)
        }));
    }

    let results = futures::future::join_all(tasks).await;
    for res in results.into_iter().flatten() {
        let (asset_id, category, is_false_positive) = res;
        if is_false_positive {
            resolved_map.insert(asset_id, "false_positive".to_string());
        } else if let Some(cat) = category {
            resolved_map.insert(asset_id, cat);
        }
    }

    Ok(resolved_map)
}

#[tauri::command]
#[specta::specta]
pub async fn validate_asset_ids(
    asset_ids: Vec<String>,
) -> crate::error::Result<HashMap<String, String>> {
    let client = Arc::new(reqwest::Client::builder().timeout(Duration::from_secs(5)).build()?);
    let semaphore = Arc::new(Semaphore::new(8));
    let mut result_map: HashMap<String, String> = HashMap::new();

    if asset_ids.is_empty() {
        return Ok(result_map);
    }

    let mut tasks = Vec::new();

    for asset_id in asset_ids {
        let sem = Arc::clone(&semaphore);
        let cli = Arc::clone(&client);
        tasks.push(tokio::spawn(async move {
            let Ok(_permit) = sem.acquire().await else {
                return (asset_id, "unknown".to_string());
            };

            let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");

            for attempt in 0..3 {
                if attempt > 0 {
                    tokio::time::sleep(Duration::from_millis(1500 * attempt)).await;
                }

                if let Ok(resp) = cli.get(&url).send().await {
                    if resp.status().as_u16() == 429 {
                        continue;
                    }
                    if resp.status().as_u16() == 404 {
                        return (asset_id, "false_positive".to_string());
                    }
                    if resp.status().is_success() {
                        if let Ok(data) = resp.json::<EconomyAssetDetails>().await {
                            if let Some(type_id) = data.asset_type_id {
                                let category = match type_id {
                                    24 => "animation",
                                    3 => "sound",
                                    1 | 11 | 13 | 2 | 21 | 22 | 38 => "image",
                                    40 | 43 | 17 | 12 => "mesh",
                                    0 => "false_positive",
                                    _ => "unknown",
                                };
                                return (asset_id, category.to_string());
                            }
                        }
                    }
                    break;
                }
            }

            (asset_id, "unknown".to_string())
        }));
    }

    let results = futures::future::join_all(tasks).await;
    for res in results.into_iter().flatten() {
        let (asset_id, category) = res;
        result_map.insert(asset_id, category);
    }

    Ok(result_map)
}
