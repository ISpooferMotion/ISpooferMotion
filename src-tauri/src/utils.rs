use log::warn;
use reqwest::Response;
use std::path::Path;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
// We keep a proxy client cached so we aren't spinning up new clients and killing connection pooling
static PROXY_CLIENT: OnceLock<std::sync::RwLock<(Option<String>, reqwest::Client)>> =
    OnceLock::new();

fn build_client(proxy_url: Option<&str>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        // 15 seconds seems to be the sweet spot for timeout without being too aggressive
        .timeout(std::time::Duration::from_secs(15))
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .pool_max_idle_per_host(32);

    if let Some(url) = proxy_url {
        if !url.trim().is_empty() {
            if let Ok(proxy) = reqwest::Proxy::all(url.trim()) {
                builder = builder.proxy(proxy);
            }
        }
    }
    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

pub fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| build_client(None))
}

pub fn get_http_client_with_proxy(proxy_url: Option<&str>) -> reqwest::Client {
    let lock = PROXY_CLIENT.get_or_init(|| std::sync::RwLock::new((None, build_client(None))));

    if let Ok(read_guard) = lock.read() {
        if read_guard.0.as_deref() == proxy_url {
            return read_guard.1.clone();
        }
    }

    if let Ok(mut write_guard) = lock.write() {
        if write_guard.0.as_deref() == proxy_url {
            return write_guard.1.clone();
        }

        let new_client = build_client(proxy_url);
        write_guard.0 = proxy_url.map(std::string::ToString::to_string);
        write_guard.1 = new_client.clone();
        return new_client;
    }

    build_client(proxy_url)
}

// Try to guess how long we need to wait before trying an API again.
// Handles both Discord's x-ratelimit-reset and standard retry-after.
#[must_use]
pub fn extract_retry_after(response: &reqwest::Response) -> Option<u64> {
    if let Some(reset) = response.headers().get("x-ratelimit-reset") {
        if let Ok(reset_str) = reset.to_str() {
            if let Ok(reset_secs) = reset_str.parse::<u64>() {
                if let Ok(now) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                {
                    let now_secs = now.as_secs();
                    if reset_secs > now_secs {
                        return Some((reset_secs - now_secs) * 1000);
                    }
                    return Some(0);
                }
            }
        }
    }
    // Fallback to standard retry-after if the fancy one isn't there
    if let Some(retry) = response.headers().get("retry-after") {
        if let Ok(retry_str) = retry.to_str() {
            if let Ok(retry_secs) = retry_str.parse::<u64>() {
                return Some(retry_secs * 1000);
            }
        }
    }
    None
}

#[must_use]
pub fn build_roblox_cookie_header(cookie_value: &str) -> String {
    let normalized = normalize_roblox_cookie(cookie_value);
    if normalized.is_empty() {
        String::new()
    } else {
        format!(".ROBLOSECURITY={normalized}")
    }
}

// Cleans up a raw roblox cookie string.
// Some users paste in the whole header or include quotes, so we strip all that junk out.
#[must_use]
pub fn normalize_roblox_cookie(cookie_value: &str) -> String {
    let trimmed = cookie_value.trim().trim_matches(|c| c == '\'' || c == '"');

    let prefix = ".ROBLOSECURITY=";
    let normalized = if let Some(idx) = trimmed.find(prefix) {
        // Drop the prefix and stop at the first semicolon if there's extra stuff attached
        let rest = &trimmed[idx + prefix.len()..];
        if let Some(end_idx) = rest.find(';') {
            &rest[..end_idx]
        } else {
            rest
        }
    } else {
        trimmed
    };

    normalized.trim().to_string()
}

// Need to make sure file names don't blow up the OS.
// Replaces invalid characters with underscores.
#[must_use]
pub fn sanitize_filename(filename: &str) -> String {
    let mut safe = String::new();
    for c in filename.chars() {
        if "<>:\"/\\|?*\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0A\x0B\x0C\x0D\x0E\x0F\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1A\x1B\x1C\x1D\x1E\x1F".contains(c) {
            safe.push('_');
        } else {
            safe.push(c);
        }
    }

    // prevent trailing dots or whitespace because windows hates that
    let trimmed = safe.trim_end_matches(|c: char| c == '.' || c.is_whitespace());
    if trimmed.is_empty() {
        "untitled".to_string()
    } else {
        // truncate to a reasonable length
        trimmed.chars().take(180).collect()
    }
}

pub async fn clear_downloads_directory(dir_path: &Path) -> Result<bool, String> {
    if !dir_path.exists() {
        if let Err(e) = tokio::fs::create_dir_all(dir_path).await {
            return Err(format!("Failed to create directory: {e}"));
        }
        return Ok(true);
    }

    match tokio::fs::read_dir(dir_path).await {
        Ok(mut entries) => {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if path.is_file() {
                    let _ = tokio::fs::remove_file(path).await;
                } else if path.is_dir() {
                    let _ = tokio::fs::remove_dir_all(path).await;
                }
            }
            Ok(true)
        }
        Err(e) => {
            warn!("Error reading directory {}: {}", dir_path.display(), e);
            Err(e.to_string())
        }
    }
}

// Sometimes Roblox gives us a new cookie mid-request.
// We want to catch that and tell the frontend so it doesn't log the user out.
pub fn check_for_roblosecurity_update(app: &AppHandle, resp: &Response, original_cookie: &str) {
    for val in &resp.headers().get_all(reqwest::header::SET_COOKIE) {
        if let Ok(cookie_str) = val.to_str() {
            if cookie_str.starts_with(".ROBLOSECURITY=") {
                let parts: Vec<&str> = cookie_str.split(';').collect();
                let new_cookie = parts[0].strip_prefix(".ROBLOSECURITY=").unwrap_or("");
                let original_val =
                    original_cookie.strip_prefix(".ROBLOSECURITY=").unwrap_or(original_cookie);
                if !new_cookie.is_empty() && new_cookie != original_val {
                    let _ = app.emit(
                        "roblosecurity-updated",
                        serde_json::json!({
                            "oldCookie": original_val,
                            "newCookie": new_cookie
                        }),
                    );
                }
            }
        }
    }
}
