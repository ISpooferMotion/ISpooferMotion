use super::is_valid_numeric_id;
use futures::future::join_all;
use reqwest::header::{COOKIE, USER_AGENT};
use std::collections::HashSet;
use tauri::AppHandle;

// checks the standard v1 asset delivery api to see if roblox will just give us the direct url
pub async fn resolve_asset_id_location(
    app: &AppHandle,
    _client: &reqwest::Client,
    asset_id: &str,
    cookie_header: &str,
    place_id: Option<&str>,
) -> crate::error::Result<Option<String>> {
    let resolve_client = crate::utils::get_http_client();
    let asset_url = format!("https://assetdelivery.roblox.com/v1/assetId/{asset_id}");
    let mut req = resolve_client
        .get(&asset_url)
        .header(COOKIE, cookie_header)
        .header(USER_AGENT, "RobloxStudio/WinInet");
    req = crate::commands::spoofer::apply_roblox_game_context(req, place_id, None);

    let resp = req.send().await?;
    crate::utils::check_for_roblosecurity_update(app, &resp, cookie_header);

    if !resp.status().is_success() {
        return Ok(None);
    }

    let data: serde_json::Value = resp.json().await?;
    Ok(data
        .get("locations")
        .and_then(|l| l.as_array())
        .and_then(|l| l.first())
        .and_then(|l| l.get("location"))
        .and_then(|l| l.as_str())
        .map(std::string::ToString::to_string)
        .or_else(|| {
            data.get("location").and_then(|l| l.as_str()).map(std::string::ToString::to_string)
        }))
}

// scrapes the economy api to find alternate cdn links or asset version ids
pub async fn resolve_asset_economy_urls(asset_id: &str, cookie_header: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let client = crate::utils::get_http_client();
    let url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
    let resp = client
        .get(&url)
        .header(COOKIE, cookie_header)
        .header(USER_AGENT, "RobloxStudio/WinInet")
        .send()
        .await;
    let Ok(resp) = resp else {
        return urls;
    };
    if !resp.status().is_success() {
        return urls;
    }
    let Ok(data) = resp.json::<serde_json::Value>().await else {
        return urls;
    };

    if let Some(hash) = data.get("AssetHash").and_then(|h| h.as_str()).filter(|h| !h.is_empty()) {
        urls.push(format!("https://assetdelivery.roblox.com/v1/assetHash/{hash}"));
        for shard in 1u8..=8 {
            urls.push(format!("https://t{shard}.rbxcdn.com/{hash}"));
        }
        urls.push(format!("https://setup.rbxcdn.com/{hash}"));
    }

    if let Some(version_id) = data.get("AssetVersionId").and_then(serde_json::Value::as_u64) {
        urls.push(format!(
            "https://assetdelivery.roblox.com/v1/assetversion?assetVersionId={version_id}"
        ));
    }

    urls
}

pub async fn build_cdn_fallback_urls(asset_id: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let client = crate::utils::get_http_client();
    let hash_url = format!("https://assetdelivery.roblox.com/v1/assetId/{asset_id}");
    let resp = client.get(&hash_url).header(USER_AGENT, "RobloxStudio/WinInet").send().await;
    if let Ok(resp) = resp {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(location) = data
                    .get("locations")
                    .and_then(|l| l.as_array())
                    .and_then(|l| l.first())
                    .and_then(|l| l.get("location"))
                    .and_then(|l| l.as_str())
                {
                    if location.contains("rbxcdn.com") || location.contains("roblox.com") {
                        urls.push(location.to_string());
                    }
                }
            }
        }
    }
    urls
}

#[must_use]
pub fn build_direct_asset_download_urls(
    asset_id: &str,
    asset_type: Option<&str>,
    place_ids: &[String],
) -> Vec<String> {
    let mut urls = Vec::new();
    let expected = expected_asset_type(asset_type);

    for pid in place_ids {
        push_unique_url(
            &mut urls,
            build_asset_download_url(asset_id, false, Some(pid), None, expected, false),
        );
        push_unique_url(
            &mut urls,
            build_asset_download_url(asset_id, true, Some(pid), None, expected, false),
        );
        push_unique_url(
            &mut urls,
            build_asset_download_url(asset_id, false, Some(pid), None, expected, true),
        );
        push_unique_url(
            &mut urls,
            build_asset_download_url(asset_id, false, Some(pid), Some(pid), expected, true),
        );
    }

    push_unique_url(
        &mut urls,
        build_asset_download_url(asset_id, false, None, None, expected, false),
    );
    push_unique_url(
        &mut urls,
        build_asset_download_url(asset_id, true, None, None, expected, false),
    );
    push_unique_url(
        &mut urls,
        build_asset_download_url(asset_id, false, None, None, expected, true),
    );
    if expected.is_some() {
        for pid in place_ids {
            push_unique_url(
                &mut urls,
                build_asset_download_url(asset_id, false, Some(pid), None, None, false),
            );
            push_unique_url(
                &mut urls,
                build_asset_download_url(asset_id, true, Some(pid), None, None, false),
            );
            push_unique_url(
                &mut urls,
                build_asset_download_url(asset_id, false, Some(pid), None, None, true),
            );
            push_unique_url(
                &mut urls,
                build_asset_download_url(asset_id, false, Some(pid), Some(pid), None, true),
            );
        }
        push_unique_url(
            &mut urls,
            build_asset_download_url(asset_id, false, None, None, None, false),
        );
        push_unique_url(
            &mut urls,
            build_asset_download_url(asset_id, true, None, None, None, false),
        );
        push_unique_url(
            &mut urls,
            build_asset_download_url(asset_id, false, None, None, None, true),
        );
    }

    push_unique_url(&mut urls, format!("https://assetgame.roblox.com/asset/?id={asset_id}"));
    push_unique_url(&mut urls, format!("https://assetdelivery.roblox.com/v2/assetId/{asset_id}"));

    urls
}

#[must_use]
pub fn build_asset_download_url(
    asset_id: &str,
    trailing_slash: bool,
    place_id: Option<&str>,
    server_place_id: Option<&str>,
    expected: Option<&str>,
    client_insert: bool,
) -> String {
    let mut url = format!(
        "https://assetdelivery.roblox.com/v1/asset{}?id={}",
        if trailing_slash { "/" } else { "" },
        asset_id
    );
    if let Some(pid) = place_id {
        url.push_str("&placeId=");
        url.push_str(pid);
    }
    if let Some(spid) = server_place_id {
        url.push_str("&serverplaceid=");
        url.push_str(spid);
    }
    if let Some(asset_type) = expected {
        url.push_str("&expectedAssetType=");
        url.push_str(asset_type);
    }
    if client_insert {
        url.push_str("&clientInsert=1");
    }
    url
}

pub async fn build_saved_versions_urls(asset_id: &str, cookie_header: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let client = crate::utils::get_http_client();
    let url = format!("https://develop.roblox.com/v1/assets/{asset_id}/saved-versions");

    let resp = client
        .get(&url)
        .header(reqwest::header::COOKIE, cookie_header)
        .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
        .send()
        .await;

    if let Ok(resp) = resp {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(versions) = data.get("data").and_then(|d| d.as_array()) {
                    for version in versions.iter().rev() {
                        if let Some(version_id) =
                            version.get("assetVersionId").and_then(serde_json::Value::as_u64)
                        {
                            urls.push(format!(
                                "https://assetdelivery.roblox.com/v1/assetversion?assetVersionId={version_id}"
                            ));
                        }
                    }
                }
            }
        }
    }
    urls
}

// tries to find what games this asset is used in, so we can pretend to be a server for that game and bypass copylocks
pub async fn attempt_asset_usage_place_id_discovery(
    asset_id: &str,
    cookie_header: &str,
) -> Vec<String> {
    if !is_valid_numeric_id(asset_id) {
        return Vec::new();
    }

    let client = crate::utils::get_http_client();
    let usage_url =
        format!("https://games.roblox.com/v1/games/asset-to-universe?assetId={asset_id}");
    let Ok(resp) = client
        .get(&usage_url)
        .header(COOKIE, cookie_header)
        .header(USER_AGENT, "RobloxStudio/WinInet")
        .send()
        .await
    else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(data) = resp.json::<serde_json::Value>().await else {
        return Vec::new();
    };

    let mut universe_ids = Vec::new();
    let mut seen_universe_ids = HashSet::new();
    let mut push_universe_id = |value: &serde_json::Value| {
        if let Some(id) = json_numeric_id(value) {
            if seen_universe_ids.insert(id.clone()) {
                universe_ids.push(id);
            }
        }
    };

    if let Some(values) = data.get("universeIds").and_then(serde_json::Value::as_array) {
        for value in values {
            push_universe_id(value);
        }
    }
    if let Some(values) = data.get("data").and_then(serde_json::Value::as_array) {
        for value in values {
            if let Some(universe_id) = value.get("universeId").or_else(|| value.get("id")) {
                push_universe_id(universe_id);
            } else {
                push_universe_id(value);
            }
        }
    }
    if let Some(value) = data.get("universeId") {
        push_universe_id(value);
    }

    if universe_ids.is_empty() {
        return Vec::new();
    }

    let mut place_ids = Vec::new();
    let mut seen_place_ids = HashSet::new();
    for chunk in universe_ids.chunks(50) {
        let games_url =
            format!("https://games.roblox.com/v1/games?universeIds={}", chunk.join(","));
        let Ok(resp) = client
            .get(&games_url)
            .header(COOKIE, cookie_header)
            .header(USER_AGENT, "RobloxStudio/WinInet")
            .send()
            .await
        else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(games) = resp.json::<serde_json::Value>().await else {
            continue;
        };
        let Some(entries) = games.get("data").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for game in entries {
            let root_place_id = game
                .get("rootPlaceId")
                .and_then(json_numeric_id)
                .or_else(|| {
                    game.get("rootPlace")
                        .and_then(|place| place.get("id"))
                        .and_then(json_numeric_id)
                })
                .or_else(|| game.get("placeId").and_then(json_numeric_id));
            if let Some(place_id) = root_place_id {
                if seen_place_ids.insert(place_id.clone()) {
                    place_ids.push(place_id);
                    if place_ids.len() >= 50 {
                        return place_ids;
                    }
                }
            }
        }
    }

    place_ids
}

pub async fn get_groups_for_user(user_id: u64, cookie_header: &str) -> Vec<(u64, Option<u64>)> {
    let client = crate::utils::get_http_client();
    let url = format!("https://groups.roblox.com/v1/users/{user_id}/groups/roles");
    let mut results = Vec::new();

    if let Ok(resp) = client.get(&url).header(reqwest::header::COOKIE, cookie_header).send().await {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(groups) = data.get("data").and_then(|d| d.as_array()) {
                    for entry in groups {
                        if let Some(group) = entry.get("group") {
                            if let Some(group_id) =
                                group.get("id").and_then(serde_json::Value::as_u64)
                            {
                                let owner_id = group
                                    .get("owner")
                                    .and_then(|o| o.get("userId"))
                                    .and_then(serde_json::Value::as_u64);
                                results.push((group_id, owner_id));
                            }
                        }
                    }
                }
            }
        }
    }
    results
}

pub async fn get_friends_for_user(user_id: u64, cookie_header: &str) -> Vec<u64> {
    let client = crate::utils::get_http_client();
    let url = format!("https://friends.roblox.com/v1/users/{user_id}/friends");
    let mut results = Vec::new();

    if let Ok(resp) = client.get(&url).header(reqwest::header::COOKIE, cookie_header).send().await {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(friends) = data.get("data").and_then(|d| d.as_array()) {
                    for friend in friends {
                        if let Some(friend_id) =
                            friend.get("id").and_then(serde_json::Value::as_u64)
                        {
                            results.push(friend_id);
                        }
                    }
                }
            }
        }
    }
    results
}

pub async fn get_games_for_creator(
    creator_type: &str,
    creator_id: u64,
    cookie_header: &str,
) -> Vec<String> {
    let client = crate::utils::get_http_client();
    let mut results: Vec<String> = Vec::new();

    let build_url = |filter: u8| -> String {
        if creator_type == "User" {
            format!("https://games.roblox.com/v2/users/{creator_id}/games?accessFilter={filter}&limit=50")
        } else {
            format!("https://games.roblox.com/v2/groups/{creator_id}/games?accessFilter={filter}&limit=50")
        }
    };

    let fetch_games = |url: String| {
        let client = client.clone();
        let header = cookie_header.to_string();
        async move {
            let mut out: Vec<String> = Vec::new();
            if let Ok(resp) = client.get(&url).header(reqwest::header::COOKIE, header).send().await
            {
                if resp.status().is_success() {
                    if let Ok(data) = resp.json::<serde_json::Value>().await {
                        if let Some(games) = data.get("data").and_then(|d| d.as_array()) {
                            for game in games {
                                if let Some(root_place_id) = game
                                    .get("rootPlace")
                                    .and_then(|p| p.get("id"))
                                    .and_then(serde_json::Value::as_u64)
                                {
                                    out.push(root_place_id.to_string());
                                }
                            }
                        }
                    }
                }
            }
            out
        }
    };

    let public_games = fetch_games(build_url(2)).await;
    for pid in &public_games {
        if !results.contains(pid) {
            results.push(pid.clone());
        }
    }

    if results.is_empty() {
        let private_games = fetch_games(build_url(1)).await;
        for pid in private_games {
            if !results.contains(&pid) {
                results.push(pid);
            }
        }
    }

    results
}

// desperate attempt to find a place id by crawling the asset creator's social graph (groups, friends, games)
pub async fn attempt_social_graph_place_id_discovery(
    asset_id: &str,
    cookie_header: &str,
) -> Vec<String> {
    let mut discovered_place_ids = HashSet::new();
    let client = crate::utils::get_http_client();

    let mut auth_user_id = None;
    if let Ok(resp) = client
        .get("https://users.roblox.com/v1/users/authenticated")
        .header(reqwest::header::COOKIE, cookie_header)
        .send()
        .await
    {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                auth_user_id = data.get("id").and_then(serde_json::Value::as_u64);
            }
        }
    }

    let details_url = format!("https://economy.roblox.com/v2/assets/{asset_id}/details");
    let details_resp = client
        .get(&details_url)
        .header(reqwest::header::COOKIE, cookie_header)
        .header(reqwest::header::USER_AGENT, "RobloxStudio/WinInet")
        .send()
        .await;

    let mut creator_type = String::new();
    let mut creator_id = 0u64;

    if let Ok(resp) = details_resp {
        if resp.status().is_success() {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(creator) = data.get("Creator") {
                    if let (Some(c_type), Some(c_id)) = (
                        creator.get("CreatorType").and_then(|t| t.as_str()),
                        creator.get("CreatorTargetId").and_then(serde_json::Value::as_u64),
                    ) {
                        creator_type = c_type.to_string();
                        creator_id = c_id;
                    }
                }
            }
        }
    }

    if creator_id == 0 {
        return vec![];
    }

    let mut futures = vec![];

    let ct = creator_type.clone();
    let cid = creator_id;
    let ch = cookie_header.to_string();
    futures.push(tokio::spawn(async move { get_games_for_creator(&ct, cid, &ch).await }));

    if let Some(uid) = auth_user_id {
        let ch = cookie_header.to_string();
        futures.push(tokio::spawn(async move { get_games_for_creator("User", uid, &ch).await }));
    }

    if let Some(uid) = auth_user_id {
        let ch = cookie_header.to_string();
        let groups = get_groups_for_user(uid, cookie_header).await;
        for (gid, _) in groups.into_iter().take(5) {
            let ch = ch.clone();
            futures
                .push(tokio::spawn(async move { get_games_for_creator("Group", gid, &ch).await }));
        }
    }

    if creator_type == "User" && creator_id != 1 {
        let groups = get_groups_for_user(creator_id, cookie_header).await;
        let mut seen_owners = HashSet::new();
        if let Some(uid) = auth_user_id {
            seen_owners.insert(uid);
        }
        seen_owners.insert(creator_id);

        for (gid, owner_id) in groups.into_iter().take(8) {
            let ch = cookie_header.to_string();
            futures
                .push(tokio::spawn(async move { get_games_for_creator("Group", gid, &ch).await }));

            if let Some(oid) = owner_id {
                if !seen_owners.contains(&oid) {
                    seen_owners.insert(oid);
                    let ch = cookie_header.to_string();
                    futures.push(tokio::spawn(async move {
                        get_games_for_creator("User", oid, &ch).await
                    }));
                }
            }
        }

        let friends = get_friends_for_user(creator_id, cookie_header).await;
        for fid in friends.into_iter().take(15) {
            if !seen_owners.contains(&fid) {
                seen_owners.insert(fid);
                let ch = cookie_header.to_string();
                futures.push(tokio::spawn(
                    async move { get_games_for_creator("User", fid, &ch).await },
                ));
            }
        }
    }

    let results = join_all(futures).await;
    for places in results.into_iter().flatten() {
        for place in places {
            discovered_place_ids.insert(place);

            if discovered_place_ids.len() >= 50 {
                return discovered_place_ids.into_iter().collect();
            }
        }
    }

    discovered_place_ids.into_iter().collect()
}

// queries the internet archive's wayback machine to see if someone else saved a valid download url for this asset years ago
pub async fn attempt_deep_place_id_discovery(
    app: &AppHandle,
    asset_id: &str,
    _cookie_header: &str,
    friend_limit: u32,
) -> crate::error::Result<Vec<String>> {
    use std::sync::OnceLock;

    let _ = crate::commands::ipc::append_log_entry(
        app,
        "info",
        "spoofer",
        &format!("Wayback Discovery: Searching Wayback Machine for asset {asset_id}..."),
    );

    let client = crate::utils::get_http_client();
    let mut discovered_place_ids: std::collections::HashSet<String> =
        std::collections::HashSet::new();

    let cdx_asset_url = format!(
        "https://web.archive.org/cdx/search/cdx?url=assetdelivery.roblox.com/v1/asset/*id%3D{asset_id}*&output=json&limit={limit}&filter=statuscode:200&fl=original&collapse=urlkey",
        limit = (friend_limit * 5).max(20)
    );
    if let Ok(wb_resp) = client
        .get(&cdx_asset_url)
        .header(reqwest::header::USER_AGENT, "ISpooferMotion")
        .send()
        .await
    {
        if let Ok(wb_data) = wb_resp.json::<Vec<Vec<String>>>().await {
            static CDN_PLACE_RE: OnceLock<regex::Regex> = OnceLock::new();
            let place_re = CDN_PLACE_RE
                .get_or_init(|| regex::Regex::new(r"placeId=(\d+)").expect("invalid regex"));
            let server_re_lock: &OnceLock<regex::Regex> = {
                static SERVER_RE: OnceLock<regex::Regex> = OnceLock::new();
                &SERVER_RE
            };
            let server_re = server_re_lock
                .get_or_init(|| regex::Regex::new(r"serverPlaceId=(\d+)").expect("invalid regex"));

            for row in wb_data.into_iter().skip(1) {
                if let Some(original_url) = row.first() {
                    for re in &[place_re, server_re] {
                        if let Some(cap) = re.captures(original_url) {
                            if let Some(pid) = cap.get(1) {
                                discovered_place_ids.insert(pid.as_str().to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    if discovered_place_ids.is_empty() {
        let wb_games_url = format!(
            "https://web.archive.org/cdx/search/cdx?url=roblox.com/games/*&output=json&limit={}&fl=original&collapse=urlkey",
            friend_limit * 10
        );
        if let Ok(wb_resp) = client
            .get(&wb_games_url)
            .header(reqwest::header::USER_AGENT, "ISpooferMotion")
            .send()
            .await
        {
            if let Ok(wb_data) = wb_resp.json::<Vec<Vec<String>>>().await {
                static GAMES_RE: OnceLock<regex::Regex> = OnceLock::new();
                let re = GAMES_RE.get_or_init(|| {
                    regex::Regex::new(r"roblox\.com/games/(\d+)").expect("invalid regex")
                });
                for row in wb_data.into_iter().skip(1) {
                    if let Some(original_url) = row.first() {
                        if let Some(cap) = re.captures(original_url) {
                            if let Some(pid) = cap.get(1) {
                                discovered_place_ids.insert(pid.as_str().to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(discovered_place_ids.into_iter().collect())
}

fn json_numeric_id(value: &serde_json::Value) -> Option<String> {
    value
        .as_u64()
        .map(|number| number.to_string())
        .or_else(|| value.as_str().map(std::string::ToString::to_string))
        .filter(|id| is_valid_numeric_id(id))
}

#[must_use]
pub fn expected_asset_type(asset_type: Option<&str>) -> Option<&'static str> {
    match asset_type.unwrap_or_default().to_ascii_lowercase().as_str() {
        "audio" => Some("Audio"),
        "plugin" => Some("Plugin"),
        "video" => Some("Video"),
        _ => None,
    }
}

pub fn push_unique_url(urls: &mut Vec<String>, url: String) {
    if !urls.iter().any(|existing| existing == &url) {
        urls.push(url);
    }
}

#[must_use]
pub fn extract_place_id_from_url(url: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    for part in query.split('&') {
        let (key, value) = part.split_once('=')?;
        if (key.eq_ignore_ascii_case("placeId") || key.eq_ignore_ascii_case("serverplaceid"))
            && is_valid_numeric_id(value)
        {
            return Some(value.to_string());
        }
    }
    None
}

pub fn parse_place_ids(raw: Option<&str>) -> Vec<String> {
    let mut ids = Vec::new();
    for candidate in raw
        .unwrap_or_default()
        .split(|character: char| character == ',' || character.is_whitespace())
        .map(str::trim)
    {
        if candidate.is_empty() || !is_valid_numeric_id(candidate) {
            continue;
        }
        if !ids.iter().any(|existing| existing == candidate) {
            ids.push(candidate.to_string());
        }
    }
    ids
}
