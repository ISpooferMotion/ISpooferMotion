use serde::{Serialize, Serializer};

#[derive(thiserror::Error, Debug, specta::Type)]
#[specta(type = String)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Header error: {0}")]
    Header(#[from] reqwest::header::InvalidHeaderValue),

    #[error("{0}")]
    Custom(String),
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Custom(s.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Custom(s)
    }
}

fn redact_user_paths(message: &str) -> String {
    use std::sync::OnceLock;

    type RedactPair = (regex::Regex, &'static str);
    static REDACT_RES: OnceLock<Vec<RedactPair>> = OnceLock::new();

    let regexes = REDACT_RES.get_or_init(|| {
        vec![
            (
                regex::Regex::new(r"(?i)C:\\Users\\[^\\\s]+(?:\\[^\s]*)*").expect("invalid regex"),
                "[REDACTED_PATH]",
            ),
            (
                regex::Regex::new(r"(?i)/Users/[^/\s]+(?:/[^\s]*)*").expect("invalid regex"),
                "[REDACTED_PATH]",
            ),
            (
                regex::Regex::new(r"(?i)/home/[^/\s]+(?:/[^\s]*)*").expect("invalid regex"),
                "[REDACTED_PATH]",
            ),
        ]
    });

    let mut msg = message.to_string();
    for (regex, replacement) in regexes {
        msg = regex.replace_all(&msg, *replacement).into_owned();
    }
    msg
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&redact_user_paths(&self.to_string()))
    }
}

pub type Result<T, E = AppError> = core::result::Result<T, E>;

#[cfg(test)]
mod tests {
    use super::redact_user_paths;

    #[test]
    fn redacts_windows_mac_and_linux_home_segments() {
        let input = r"C:\Users\alice\app /Users/bob/app /home/carol/app";
        let redacted = redact_user_paths(input);
        assert!(!redacted.contains("alice"));
        assert!(!redacted.contains("bob"));
        assert!(!redacted.contains("carol"));
        assert_eq!(redacted.matches("[REDACTED_PATH]").count(), 3);
    }
}
