// sanity check the first few bytes of a download to make sure we didn't just save an html error page
pub async fn validate_downloaded_payload(
    file_path: &str,
    asset_type: Option<&str>,
) -> Result<(), String> {
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::open(file_path)
        .await
        .map_err(|error| format!("Could not open downloaded asset for validation: {error}"))?;
    let mut bytes = [0u8; 256];
    let n = file.read(&mut bytes).await.unwrap_or(0);
    if n == 0 {
        return Err("Downloaded asset was empty.".into());
    }
    let valid_bytes = &bytes[..n];

    let trimmed_start =
        valid_bytes.iter().position(|byte| !byte.is_ascii_whitespace()).unwrap_or(0);
    let head = &valid_bytes[trimmed_start..];
    let head_text = String::from_utf8_lossy(head).to_ascii_lowercase();
    if head_text.starts_with("<!doctype html")
        || head_text.starts_with("<html")
        || head_text.starts_with("{\"errors\"")
        || head_text.starts_with("{\"error\"")
    {
        return Err("Downloaded asset response was an error page, not usable asset content.".into());
    }

    match asset_type.unwrap_or_default().to_ascii_lowercase().as_str() {
        "audio" => {
            if head.starts_with(b"OggS")
                || head.starts_with(b"ID3")
                || (head.len() >= 2 && head[0] == 0xff && (head[1] & 0xe0) == 0xe0)
                || head.starts_with(b"RIFF")
                || head.starts_with(b"fLaC")
            {
                Ok(())
            } else {
                Err("Downloaded audio was not a recognized audio file.".into())
            }
        }
        "image" => {
            if head.starts_with(b"\x89PNG\r\n\x1a\n")
                || head.starts_with(&[0xff, 0xd8, 0xff])
                || head.starts_with(b"GIF87a")
                || head.starts_with(b"GIF89a")
            {
                Ok(())
            } else {
                Err("Downloaded image was not a recognized image file.".into())
            }
        }
        "video" => Ok(()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn validation_accepts_valid_video() -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join("ispoofer-valid-video.mp4");
        tokio::fs::write(&path, b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom").await?;
        let path_string = path.to_string_lossy().to_string();
        let result = validate_downloaded_payload(&path_string, Some("video")).await;
        let _ = tokio::fs::remove_file(path).await;
        assert!(result.is_ok());
        Ok(())
    }
}
