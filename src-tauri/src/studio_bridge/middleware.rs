use crate::studio_bridge::get_persistent_api_key;
use crate::studio_bridge::PLUGIN_API_KEY;
use axum::{
    extract::Request,
    http::{Method, StatusCode},
    middleware::Next,
    response::Response,
};

pub async fn require_json_for_post(req: Request, next: Next) -> Result<Response, StatusCode> {
    if req.method() == Method::POST {
        let has_body = req
            .headers()
            .get(axum::http::header::CONTENT_LENGTH)
            .and_then(|val| val.to_str().ok())
            .and_then(|val| val.parse::<u64>().ok())
            .is_some_and(|len| len > 0)
            || req.headers().contains_key(axum::http::header::TRANSFER_ENCODING);
        let is_json = req
            .headers()
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|val| val.to_str().ok())
            .is_some_and(|val| val.starts_with("application/json"));
        if has_body && !is_json {
            return Err(StatusCode::UNSUPPORTED_MEDIA_TYPE);
        }
    }
    Ok(next.run(req).await)
}

#[must_use]
pub fn is_public_bridge_path(path: &str) -> bool {
    path == "/health"
        || path == "/discover-key"
        || path == "/confirm-pairing"
        || path == "/studio-health"
        || path == "/auth/discord"
        || path == "/cloud-theme/sync-now"
}

pub fn api_key_matches(req: &Request, expected_key: &str) -> bool {
    use subtle::ConstantTimeEq;
    let auth_header = req
        .headers()
        .get("x-api-key")
        .or_else(|| req.headers().get(axum::http::header::AUTHORIZATION))
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .trim();
    let token = auth_header.strip_prefix("Bearer ").unwrap_or(auth_header);
    token.as_bytes().ct_eq(expected_key.as_bytes()).into()
}

pub async fn require_auth(req: Request, next: Next) -> Result<Response, StatusCode> {
    let path = req.uri().path();
    if is_public_bridge_path(path) {
        return Ok(next.run(req).await);
    }
    let expected_key = PLUGIN_API_KEY.get_or_init(get_persistent_api_key);
    if !api_key_matches(&req, expected_key.trim()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(next.run(req).await)
}
