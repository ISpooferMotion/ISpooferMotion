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
            if valid_bytes.starts_with(b"OggS")
                || valid_bytes.starts_with(b"ID3")
                || valid_bytes.starts_with(&[0xff, 0xfb])
                || valid_bytes.starts_with(b"RIFF")
            {
                Ok(())
            } else {
                Err("Downloaded audio was not a recognized audio file.".into())
            }
        }
        "image" => {
            if valid_bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                || valid_bytes.starts_with(&[0xff, 0xd8, 0xff])
                || valid_bytes.starts_with(b"GIF87a")
                || valid_bytes.starts_with(b"GIF89a")
            {
                Ok(())
            } else {
                Err("Downloaded image was not a recognized image file.".into())
            }
        }
        _ => Ok(()),
    }
}
