#![allow(clippy::too_many_lines)]
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, specta::Type)]
pub struct FetchAssetsRequest {
    #[serde(rename = "creatorType")]
    pub creator_type: Option<String>,
    #[serde(rename = "creatorId")]
    pub creator_id: String,
    #[serde(rename = "assetTypes")]
    pub asset_types: Option<Vec<String>>,
    pub cookie: String,
    pub limit: Option<u32>,
    #[serde(rename = "maxPages")]
    pub max_pages: Option<u32>,
}

#[derive(Serialize, Clone, specta::Type)]
pub struct AssetExplorerItem {
    #[specta(type = f64)]
    pub id: u64,
    pub name: String,
    pub r#type: String,
    pub created: Option<String>,
    pub updated: Option<String>,
    #[serde(rename = "thumbnailUrl")]
    pub thumbnail_url: Option<String>,
    #[serde(rename = "creatorType")]
    pub creator_type: String,
    #[serde(rename = "creatorId")]
    pub creator_id: String,
    #[serde(rename = "isModerated")]
    pub is_moderated: bool,
}

#[derive(Serialize, specta::Type)]
pub struct FetchAssetsResponse {
    #[specta(type = u32)]
    pub total: usize,
    pub items: Vec<AssetExplorerItem>,
}

// normalize legacy or weird asset type names so the roblox api actually understands them
fn map_asset_types(types: Option<Vec<String>>) -> String {
    let mut mapped = Vec::new();
    let default_types = vec![
        "Animation".to_string(),
        "Audio".to_string(),
        "Image".to_string(),
        "Model".to_string(),
    ];
    let input_types = types.unwrap_or(default_types);

    for t in input_types {
        let normalized = match t.as_str() {
            "Images" | "Decal" => "Image",
            other => other,
        };
        if !mapped.contains(&normalized.to_string()) {
            mapped.push(normalized.to_string());
        }
    }
    mapped.join(",")
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_assets(
    app: tauri::AppHandle,
    query: FetchAssetsRequest,
) -> crate::error::Result<FetchAssetsResponse> {
    let creator_type = query.creator_type.unwrap_or_else(|| "User".to_string());
    let is_group = creator_type.eq_ignore_ascii_case("group");
    let limit = query.limit.unwrap_or(50).min(100);
    let max_pages = query.max_pages.unwrap_or(3).min(50);
    let asset_types_str = map_asset_types(query.asset_types);

    let client = crate::utils::get_http_client();
    let mut items = Vec::new();
    let mut cursor: Option<String> = None;
    let mut pages = 0;

    let cookie_header = crate::utils::build_roblox_cookie_header(&query.cookie);

    while pages < max_pages {
        let mut url = if is_group {
            format!(
                "https://inventory.roblox.com/v2/groups/{}/inventory?assetTypes={}&limit={}",
                query.creator_id, asset_types_str, limit
            )
        } else {
            format!(
                "https://inventory.roblox.com/v2/users/{}/inventory?assetTypes={}&limit={}",
                query.creator_id, asset_types_str, limit
            )
        };

        if let Some(c) = &cursor {
            url.push_str("&cursor=");
            url.push_str(c);
        }

        let mut headers = HeaderMap::new();
        headers.insert(COOKIE, HeaderValue::from_str(&cookie_header)?);
        headers.insert(USER_AGENT, HeaderValue::from_static("ISpooferMotion/AssetExplorer"));

        let resp = match client.get(&url).headers(headers).send().await {
            Ok(r) => r,
            Err(e) => return Err(format!("Inventory fetch failed: {e}").into()),
        };

        crate::utils::check_for_roblosecurity_update(&app, &resp, &cookie_header);

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();

            // 403 means private inventory or no access. this is pretty common now since roblox made inventories private by default
            if status.as_u16() == 403 {
                return Err("Inventory access denied (403). The target user's inventory is private or this account does not have permission to view it. This is expected behavior per Roblox's January 2026 inventory privacy changes.".into());
            }
            return Err(format!("Inventory fetch failed ({status}): {text}").into());
        }

        let data: Value = match resp.json().await {
            Ok(d) => d,
            Err(e) => return Err(format!("Failed to parse JSON: {e}").into()),
        };

        if let Some(page_items) = data.get("data").and_then(|d| d.as_array()) {
            for item in page_items {
                items.push(item.clone());
            }
        }

        cursor = data
            .get("nextPageCursor")
            .and_then(|c| c.as_str())
            .map(std::string::ToString::to_string);
        pages += 1;

        if cursor.is_none() {
            break;
        }
    }

    let mut asset_ids_set = std::collections::HashSet::new();
    for item in &items {
        if let Some(id) = item.get("assetId").and_then(serde_json::Value::as_u64) {
            asset_ids_set.insert(id);
        }
    }
    let asset_ids: Vec<u64> = asset_ids_set.into_iter().collect();

    let mut thumbnails = std::collections::HashMap::new();
    if !asset_ids.is_empty() {
        // the thumbnail api yells at us if we ask for too many at once, so chunk it to 100 max
        let chunks: Vec<Vec<u64>> = asset_ids.chunks(100).map(<[u64]>::to_vec).collect();
        let futures = chunks.into_iter().map(|chunk| {
            async move {
                let ids_str = chunk
                    .iter()
                    .map(std::string::ToString::to_string)
                    .collect::<Vec<String>>()
                    .join(",");
                let url = format!(
                    "https://thumbnails.roblox.com/v1/assets?assetIds={ids_str}&size=100x100&format=Png"
                );
                let client = crate::utils::get_http_client();
                if let Ok(resp) =
                    client.get(&url).header(USER_AGENT, "ISpooferMotion/AssetExplorer").send().await
                {
                    if let Ok(data) = resp.json::<Value>().await {
                        if let Some(thumb_data) = data.get("data").and_then(|d| d.as_array()) {
                            let mut map = std::collections::HashMap::new();
                            for t in thumb_data {
                                if let Some(target_id) =
                                    t.get("targetId").and_then(serde_json::Value::as_u64)
                                {
                                    if let Some(image_url) = t.get("imageUrl").and_then(|u| u.as_str())
                                    {
                                        map.insert(target_id, image_url.to_string());
                                    }
                                }
                            }
                            return map;
                        }
                    }
                }
                std::collections::HashMap::new()
            }
        });

        use futures::StreamExt;
        let mut stream = futures::stream::iter(futures).buffer_unordered(10);
        while let Some(map) = stream.next().await {
            thumbnails.extend(map);
        }
    }

    let mut enriched = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for item in items {
        let Some(asset_id) = item.get("assetId").and_then(serde_json::Value::as_u64) else {
            continue;
        };

        if seen_ids.contains(&asset_id) {
            continue;
        }

        let is_moderated =
            item.get("isModerated").and_then(serde_json::Value::as_bool).unwrap_or(false)
                || item.get("moderationStatus").and_then(|s| s.as_str()) == Some("Moderated");

        if is_moderated {
            continue;
        }

        seen_ids.insert(asset_id);

        let name = item
            .get("name")
            .or_else(|| item.get("assetName"))
            .and_then(|n| n.as_str())
            .unwrap_or("Unknown")
            .to_string();

        let r#type = item
            .get("assetType")
            .or_else(|| item.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("Unknown")
            .to_string();

        let created =
            item.get("created").and_then(|c| c.as_str()).map(std::string::ToString::to_string);
        let updated =
            item.get("updated").and_then(|u| u.as_str()).map(std::string::ToString::to_string);
        let thumbnail_url = thumbnails.get(&asset_id).cloned();

        enriched.push(AssetExplorerItem {
            id: asset_id,
            name,
            r#type,
            created,
            updated,
            thumbnail_url,
            creator_type: creator_type.clone(),
            creator_id: query.creator_id.clone(),
            is_moderated: false,
        });
    }

    Ok(FetchAssetsResponse { total: enriched.len(), items: enriched })
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_roblox_thumbnail(asset_id: String) -> crate::error::Result<Option<String>> {
    let client = crate::utils::get_http_client();
    let url = format!(
        "https://thumbnails.roblox.com/v1/assets?assetIds={asset_id}&size=420x420&format=Png&isCircular=false"
    );

    let resp = client.get(&url).header(USER_AGENT, "ISpooferMotion/AssetExplorer").send().await?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let data: Value = resp.json().await?;

    if let Some(thumb_data) = data.get("data").and_then(|d| d.as_array()) {
        if let Some(first) = thumb_data.first() {
            if let Some(image_url) = first.get("imageUrl").and_then(|u| u.as_str()) {
                return Ok(Some(image_url.to_string()));
            }
        }
    }

    Ok(None)
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_animation_xml(
    app: tauri::AppHandle,
    asset_id: String,
    cookie: Option<String>,
) -> crate::error::Result<Option<String>> {
    let url = format!("https://assetdelivery.roblox.com/v1/asset/?id={asset_id}");

    let client = crate::utils::get_http_client();
    let mut req = client.get(&url).header(USER_AGENT, "ISpooferMotion/AnimPreview");

    let mut actual_cookie_header = None;
    if let Some(cookie_val) = &cookie {
        let cookie_header = if cookie_val.starts_with(".ROBLOSECURITY=") {
            cookie_val.clone()
        } else {
            format!(".ROBLOSECURITY={cookie_val}")
        };
        actual_cookie_header = Some(cookie_header.clone());
        req = req.header(COOKIE, cookie_header);
    }

    let resp = req.send().await?;

    if let Some(c) = actual_cookie_header {
        crate::utils::check_for_roblosecurity_update(&app, &resp, &c);
    }

    if !resp.status().is_success() {
        return Ok(None);
    }

    let bytes = resp.bytes().await?;

    // the api sometimes returns binary xml instead of plain text, so we gotta parse it and serialize it back to string
    if bytes.starts_with(b"<roblox!") {
        let dom = match rbx_binary::from_reader(bytes.as_ref()) {
            Ok(d) => d,
            Err(e) => {
                return Err(crate::error::AppError::Custom(format!("Binary parse error: {e}")))
            }
        };
        let mut out = Vec::new();
        if let Err(e) = rbx_xml::to_writer_default(&mut out, &dom, dom.root().children()) {
            return Err(crate::error::AppError::Custom(format!("XML serialize error: {e}")));
        }
        let xml_str = String::from_utf8_lossy(&out).to_string();
        Ok(Some(xml_str))
    } else if bytes.starts_with(b"<roblox") {
        let xml_str = String::from_utf8_lossy(&bytes).to_string();
        Ok(Some(xml_str))
    } else {
        Ok(None)
    }
}
