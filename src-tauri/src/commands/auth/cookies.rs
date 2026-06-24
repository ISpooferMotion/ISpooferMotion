#![allow(clippy::cast_possible_truncation)]
#[cfg(target_os = "windows")]
use aes_gcm::aead::{Aead, KeyInit};
#[cfg(target_os = "windows")]
use aes_gcm::{Aes256Gcm, Key, Nonce};
#[cfg(target_os = "windows")]
use base64::engine::general_purpose::STANDARD;
#[cfg(target_os = "windows")]
use base64::Engine;
use keyring::Entry;
use regex::Regex;
use rusqlite::Connection;
#[cfg(not(target_os = "windows"))]
use std::io::Read;
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::LocalFree;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Security::Credentials::{
    CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Security::Cryptography::{
    CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

#[cfg(target_os = "windows")]
pub const ROBLOX_STUDIO_COOKIE_TARGET: &str =
    "https://www.roblox.com:RobloxStudioAuth.ROBLOSECURITY";
#[cfg(not(target_os = "windows"))]
pub const BROWSER_COOKIE_SCAN_BYTES: u64 = 25 * 1024 * 1024;

pub const PROFILE_COOKIE_SERVICE: &str = "ISpooferMotion.RobloxProfileCookie";

#[must_use]
pub fn extract_roblox_cookie(raw_value: &str) -> Option<String> {
    // regex to rip the actual ROBLOSECURITY token out of whatever raw text we give it
    // kinda messy but it's the most reliable way to find it
    let re = Regex::new(r#"(?i)_\|WARNING:-DO-NOT-SHARE-THIS\.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items\.\|_[^\s"';,]+"#).ok()?;
    re.find(raw_value).map(|m| m.as_str().to_string())
}

#[cfg(not(target_os = "windows"))]
fn read_possible_cookie_file(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file.take(BROWSER_COOKIE_SCAN_BYTES));
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    extract_roblox_cookie(&text)
}

#[cfg(not(target_os = "windows"))]
fn browser_cookie_file_candidates() -> Vec<PathBuf> {
    let home_os = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    let home = match home_os {
        Some(h) => PathBuf::from(h),
        None => return Vec::new(),
    };
    let mut candidates = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let app_support = home.join("Library").join("Application Support");
        let chromium_roots = [
            app_support.join("Google").join("Chrome"),
            app_support.join("Chromium"),
            app_support.join("Microsoft Edge"),
            app_support.join("BraveSoftware").join("Brave-Browser"),
            app_support.join("com.operasoftware.Opera"),
        ];
        // checking the standard profile names, hopefully the user doesn't have like 20 of them
        let profiles = ["Default", "Profile 1", "Profile 2", "Profile 3"];

        for root in chromium_roots {
            for profile in profiles {
                candidates.push(root.join(profile).join("Network").join("Cookies"));
                candidates.push(root.join(profile).join("Cookies"));
            }
        }

        let firefox_profiles = app_support.join("Firefox").join("Profiles");
        if let Ok(entries) = std::fs::read_dir(firefox_profiles) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    candidates.push(path.join("cookies.sqlite"));
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"));
        let chromium_roots = [
            config.join("google-chrome"),
            config.join("chromium"),
            config.join("microsoft-edge"),
            config.join("BraveSoftware").join("Brave-Browser"),
            config.join("opera"),
        ];
        let profiles = ["Default", "Profile 1", "Profile 2", "Profile 3"];

        for root in chromium_roots {
            for profile in profiles {
                candidates.push(root.join(profile).join("Network").join("Cookies"));
                candidates.push(root.join(profile).join("Cookies"));
            }
        }

        let firefox_profiles = home.join(".mozilla").join("firefox");
        if let Ok(entries) = std::fs::read_dir(firefox_profiles) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    candidates.push(path.join("cookies.sqlite"));
                }
            }
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct ChromiumCookieCandidate {
    cookies_path: PathBuf,
    local_state_path: PathBuf,
}

#[cfg(target_os = "windows")]
fn chromium_cookie_candidates() -> Vec<ChromiumCookieCandidate> {
    let home_os = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    let home = match home_os {
        Some(h) => PathBuf::from(h),
        None => return Vec::new(),
    };
    let local = std::env::var_os("LOCALAPPDATA")
        .map_or_else(|| home.join("AppData").join("Local"), PathBuf::from);
    let roaming = std::env::var_os("APPDATA")
        .map_or_else(|| home.join("AppData").join("Roaming"), PathBuf::from);

    let roots = [
        local.join("Google").join("Chrome").join("User Data"),
        local.join("Microsoft").join("Edge").join("User Data"),
        local.join("BraveSoftware").join("Brave-Browser").join("User Data"),
        roaming.join("Opera Software").join("Opera Stable"),
        roaming.join("Opera Software").join("Opera GX Stable"),
    ];

    let mut candidates = Vec::new();
    for root in roots {
        let local_state_path = root.join("Local State");
        if !local_state_path.is_file() {
            continue;
        }

        let mut profile_dirs = vec![root.clone()];
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    profile_dirs.push(path);
                }
            }
        }

        for profile in profile_dirs {
            for cookies_path in [profile.join("Network").join("Cookies"), profile.join("Cookies")] {
                if cookies_path.is_file() {
                    candidates.push(ChromiumCookieCandidate {
                        cookies_path,
                        local_state_path: local_state_path.clone(),
                    });
                }
            }
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
fn decrypt_dpapi(data: &[u8]) -> crate::error::Result<Vec<u8>> {
    // ask windows nicely to decrypt this blob for us
    unsafe {
        let in_blob =
            CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr().cast_mut() };
        let mut out_blob = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = CryptUnprotectData(
            &in_blob,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        );
        if ok == 0 {
            return Err("Windows DPAPI cookie decrypt failed".into());
        }
        let decrypted =
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec();
        LocalFree(out_blob.pbData.cast());
        Ok(decrypted)
    }
}

#[cfg(target_os = "windows")]
fn read_windows_credential_cookie(target: &str) -> Option<String> {
    let mut target_wide = target.encode_utf16().collect::<Vec<_>>();
    target_wide.push(0);

    unsafe {
        let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
        let ok = CredReadW(target_wide.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential);
        if ok == 0 || credential.is_null() {
            return None;
        }

        let credential_ref = &*credential;
        let bytes = std::slice::from_raw_parts(
            credential_ref.CredentialBlob,
            credential_ref.CredentialBlobSize as usize,
        );
        let utf8 = String::from_utf8_lossy(bytes);
        let cookie = extract_roblox_cookie(&utf8).or_else(|| {
            if bytes.len() % 2 != 0 {
                return None;
            }
            let utf16 = bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>();
            String::from_utf16(&utf16).ok().and_then(|text| extract_roblox_cookie(&text))
        });

        CredFree(credential as _);
        cookie
    }
}

#[cfg(target_os = "windows")]
fn chromium_master_key(local_state_path: &Path) -> crate::error::Result<Vec<u8>> {
    let text = std::fs::read_to_string(local_state_path)?;
    let parsed: serde_json::Value = serde_json::from_str(&text)?;
    let encrypted_key = parsed
        .get("os_crypt")
        .and_then(|v| v.get("encrypted_key"))
        .and_then(|v| v.as_str())
        .ok_or("Chromium Local State does not contain an encrypted cookie key")?;
    let mut key_bytes = STANDARD
        .decode(encrypted_key)
        .map_err(|e| crate::error::AppError::Custom(format!("Invalid Chromium cookie key: {e}")))?;
    if key_bytes.starts_with(b"DPAPI") {
        key_bytes.drain(..5);
    }
    decrypt_dpapi(&key_bytes)
}

#[cfg(target_os = "windows")]
fn decrypt_chromium_cookie(encrypted_value: &[u8], master_key: &[u8]) -> Option<String> {
    if encrypted_value.is_empty() {
        return None;
    }

    // chromium uses aes-256-gcm now, indicated by these prefixes
    if encrypted_value.starts_with(b"v10")
        || encrypted_value.starts_with(b"v11")
        || encrypted_value.starts_with(b"v20")
    {
        if encrypted_value.len() <= 15 {
            return None;
        }
        let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(master_key));
        let nonce = Nonce::from_slice(&encrypted_value[3..15]);
        let plaintext = cipher.decrypt(nonce, &encrypted_value[15..]).ok()?;
        return String::from_utf8(plaintext).ok();
    }

    decrypt_dpapi(encrypted_value).ok().and_then(|bytes| String::from_utf8(bytes).ok())
}

struct TempDb(PathBuf);

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

// copy the db to temp dir before reading so we don't run into sqlite file lock issues if the browser is actively open
fn copy_cookie_db(path: &Path) -> Option<TempDb> {
    let temp_path = std::env::temp_dir().join(format!(
        "ispoofermotion-cookies-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_millis()
    ));
    std::fs::copy(path, &temp_path).ok()?;
    Some(TempDb(temp_path))
}

#[cfg(target_os = "windows")]
fn read_chromium_cookie(candidate: &ChromiumCookieCandidate) -> Option<String> {
    let master_key = chromium_master_key(&candidate.local_state_path).ok()?;
    let temp_db = copy_cookie_db(&candidate.cookies_path)?;
    let conn = Connection::open(&temp_db.0).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT value, encrypted_value FROM cookies \
             WHERE host_key LIKE '%roblox.com' AND name = '.ROBLOSECURITY' \
             ORDER BY expires_utc DESC",
        )
        .ok()?;
    let rows = stmt
        .query_map([], |row| {
            let value: String = row.get(0)?;
            let encrypted_value: Vec<u8> = row.get(1)?;
            Ok((value, encrypted_value))
        })
        .ok()?;

    for row in rows.flatten() {
        let (value, encrypted_value) = row;
        if let Some(cookie) = extract_roblox_cookie(&value) {
            return Some(cookie);
        }
        if let Some(decrypted) = decrypt_chromium_cookie(&encrypted_value, &master_key) {
            if let Some(cookie) = extract_roblox_cookie(&decrypted) {
                return Some(cookie);
            }
        }
    }

    None
}

fn firefox_cookie_candidates() -> Vec<PathBuf> {
    let home_os = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    let home = match home_os {
        Some(h) => PathBuf::from(h),
        None => return Vec::new(),
    };
    let profiles = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map_or_else(|| home.join("AppData").join("Roaming"), PathBuf::from)
            .join("Mozilla")
            .join("Firefox")
            .join("Profiles")
    } else if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support").join("Firefox").join("Profiles")
    } else {
        home.join(".mozilla").join("firefox")
    };
    let mut candidates = Vec::new();
    if let Ok(entries) = std::fs::read_dir(profiles) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                candidates.push(path.join("cookies.sqlite"));
            }
        }
    }
    candidates
}

fn read_firefox_cookie(path: &Path) -> Option<String> {
    let temp_db = copy_cookie_db(path)?;
    let conn = Connection::open(&temp_db.0).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT value FROM moz_cookies \
             WHERE host LIKE '%roblox.com' AND name = '.ROBLOSECURITY' \
             ORDER BY expiry DESC",
        )
        .ok()?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).ok()?;
    for value in rows.flatten() {
        if let Some(cookie) = extract_roblox_cookie(&value) {
            return Some(cookie);
        }
    }
    None
}

#[cfg(target_os = "windows")]
pub fn get_cookie_from_browser_profiles() -> Option<String> {
    chromium_cookie_candidates()
        .iter()
        .find_map(read_chromium_cookie)
        .or_else(|| firefox_cookie_candidates().iter().find_map(|path| read_firefox_cookie(path)))
}

#[cfg(not(target_os = "windows"))]
pub fn get_cookie_from_browser_profiles() -> Option<String> {
    firefox_cookie_candidates().iter().find_map(|path| read_firefox_cookie(path)).or_else(|| {
        browser_cookie_file_candidates().into_iter().find_map(|path| {
            if path.is_file() {
                read_possible_cookie_file(&path)
            } else {
                None
            }
        })
    })
}

pub fn get_cookie_from_roblox_studio_inner(
    #[allow(unused_variables)] user_id: Option<String>,
) -> crate::error::Result<Option<String>> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output =
            Command::new("cmdkey").arg("/list").creation_flags(CREATE_NO_WINDOW).output()?;

        let stdout = String::from_utf8_lossy(&output.stdout);

        let requested_user_id =
            user_id.unwrap_or_default().chars().filter(char::is_ascii_digit).collect::<String>();

        let mut targets: Vec<String> = stdout
            .lines()
            .filter_map(|line| {
                if let Some(idx) = line.find("Target: ") {
                    let target_str = line[idx + 8..].trim();
                    if let Some(target) = target_str.strip_prefix("LegacyGeneric:target=") {
                        return Some(target.to_string());
                    }
                }
                None
            })
            .filter(|target| target.contains(ROBLOX_STUDIO_COOKIE_TARGET))
            .collect();

        targets.sort_by(|a, b| {
            let a_includes_user =
                i32::from(!requested_user_id.is_empty() && a.contains(&requested_user_id));
            let b_includes_user =
                i32::from(!requested_user_id.is_empty() && b.contains(&requested_user_id));
            if a_includes_user != b_includes_user {
                return b_includes_user.cmp(&a_includes_user);
            }

            let num_a =
                a.split("ROBLOSECURITY").nth(1).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
            let num_b =
                b.split("ROBLOSECURITY").nth(1).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
            num_b.cmp(&num_a)
        });

        for target in targets {
            if let Some(cookie) = read_windows_credential_cookie(&target) {
                return Ok(Some(cookie));
            }
        }
        return Ok(None);
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let cookie_file = std::path::PathBuf::from(home)
            .join("Library/HTTPStorages/com.Roblox.RobloxStudio.binarycookies");

        if let Ok(bytes) = std::fs::read(&cookie_file) {
            let data = String::from_utf8_lossy(&bytes);
            if let Some(cookie) = extract_roblox_cookie(&data) {
                return Ok(Some(cookie));
            }
        }
        return Ok(None);
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let possible_paths = vec![
            std::path::PathBuf::from(&home).join(".config/roblox-studio/cookies"),
            std::path::PathBuf::from(&home).join(".local/share/roblox-studio/cookies"),
        ];

        for path in possible_paths {
            if let Ok(bytes) = std::fs::read(&path) {
                let data = String::from_utf8_lossy(&bytes);
                if let Some(cookie) = extract_roblox_cookie(&data) {
                    return Ok(Some(cookie));
                }
            }
        }
        return Ok(None);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        return Ok(None);
    }
}

pub fn profile_cookie_entry(user_id: &str) -> crate::error::Result<Entry> {
    let normalized_user_id = user_id.chars().filter(char::is_ascii_digit).collect::<String>();
    if normalized_user_id.is_empty() {
        return Err(crate::error::AppError::Custom("Missing Roblox user id".into()));
    }

    Entry::new(PROFILE_COOKIE_SERVICE, &normalized_user_id).map_err(|e| {
        crate::error::AppError::Custom(format!("Failed to open credential store: {e}"))
    })
}
