//! Rust-side browser-extension intake for lightweight mode.
//!
//! The frontend remains the authoritative path for complex add-task flows.
//! This module only accepts the narrow silent auto-submit contract where Rust
//! can safely create a normal URI task without waking the WebView.

use crate::aria2::client::Aria2State;
use crate::commands;
use crate::error::AppError;
use crate::history::HistoryDbState;
use crate::services::config::{DownloadDefaults, DownloadDefaultsState, RuntimeConfigState};
use crate::services::external_input::ExternalRequestHeader;
use crate::services::http_api::AddRequest;
use crate::services::notification::{
    send_app_notification, send_task_start_notification_from_names,
};
use serde_json::{Map, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex;

const MAX_BROWSER_REQUEST_HEADERS: usize = 32;
const MAX_HEADER_VALUE_LENGTH: usize = 8192;
const ENGINE_READY_RETRIES: u32 = 5;
const ENGINE_READY_BASE_DELAY_MS: u64 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntakeDecision {
    AcceptedQueued,
    FallbackToFrontend { reason: FallbackReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FallbackReason {
    PreferenceDisabled,
    UnsupportedUrl,
    TorrentUrl,
    FileCategoryEnabled,
    UserAgentRulesEnabled,
    MissingDownloadDir,
    InvalidProxy,
    StateUnavailable,
}

pub struct IntakeEngineStartState(pub Arc<Mutex<()>>);

impl IntakeEngineStartState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(())))
    }
}

pub async fn try_enqueue_direct(app: AppHandle, req: AddRequest) -> IntakeDecision {
    let effective_url = effective_url(&req).to_string();
    let Ok(parsed_url) = url::Url::parse(&effective_url) else {
        return fallback(FallbackReason::UnsupportedUrl);
    };

    if !matches!(parsed_url.scheme(), "http" | "https" | "ftp") {
        return fallback(FallbackReason::UnsupportedUrl);
    }
    if parsed_url.path().to_ascii_lowercase().ends_with(".torrent") {
        return fallback(FallbackReason::TorrentUrl);
    }

    let defaults = match download_defaults(&app).await {
        Ok(defaults) => defaults,
        Err(e) => {
            log::warn!("extension_intake:defaults-unavailable error={e}");
            return fallback(FallbackReason::StateUnavailable);
        }
    };

    if !(defaults.auto_submit_from_extension && defaults.silent_auto_submit_from_extension) {
        return fallback(FallbackReason::PreferenceDisabled);
    }
    if defaults.has_file_categories() {
        return fallback(FallbackReason::FileCategoryEnabled);
    }
    if defaults.has_user_agent_rules() {
        return fallback(FallbackReason::UserAgentRulesEnabled);
    }
    if defaults.dir.trim().is_empty() {
        return fallback(FallbackReason::MissingDownloadDir);
    }
    if defaults.download_proxy_enabled() && !is_valid_aria2_proxy_url(&defaults.proxy.server) {
        return fallback(FallbackReason::InvalidProxy);
    }

    let options = match build_direct_add_uri_options(&req, &defaults) {
        Ok(options) => options,
        Err(DirectBuildError::MissingDownloadDir) => {
            return fallback(FallbackReason::MissingDownloadDir)
        }
        Err(DirectBuildError::InvalidProxy) => return fallback(FallbackReason::InvalidProxy),
    };

    let log_url = summarize_url_for_log(effective_url.as_str());
    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = submit_direct_uri(app_for_task, effective_url, options).await {
            log::warn!("extension_intake:submit-failed error={e}");
        }
    });

    log::info!(
        "extension_intake:accepted url={} has_cookie={} header_count={}",
        log_url,
        req.cookie.as_ref().is_some_and(|value| !value.is_empty()),
        req.request_headers.len()
    );
    IntakeDecision::AcceptedQueued
}

fn fallback(reason: FallbackReason) -> IntakeDecision {
    log::debug!("extension_intake:fallback reason={reason:?}");
    IntakeDecision::FallbackToFrontend { reason }
}

async fn submit_direct_uri(app: AppHandle, url: String, options: Value) -> Result<(), AppError> {
    if let Err(e) = ensure_engine_ready_for_intake(&app).await {
        let _ = send_app_notification(
            &app,
            "Download Engine Failed",
            "Motrix Next Opt could not start the download engine.",
        );
        return Err(e);
    }

    let aria2 = app
        .try_state::<Aria2State>()
        .ok_or_else(|| AppError::Engine("Aria2State not managed".into()))?;
    let gid = match aria2.0.add_uri(vec![url.clone()], options).await {
        Ok(gid) => gid,
        Err(e) => {
            let _ = send_app_notification(
                &app,
                "Download Failed",
                "Motrix Next Opt could not create the download task.",
            );
            return Err(e);
        }
    };

    let added_at = chrono::Utc::now().to_rfc3339();
    if let Some(db) = app.try_state::<HistoryDbState>() {
        if let Err(e) = db.0.record_task_birth(&gid, &added_at).await {
            log::warn!("extension_intake:birth-write-failed gid={gid} error={e}");
        }
    }

    let name = resolve_submitted_task_name(&url);
    let runtime_config = match app.try_state::<RuntimeConfigState>() {
        Some(state) => state.snapshot().await,
        None => crate::services::config::RuntimeConfig::default(),
    };
    let _ = send_task_start_notification_from_names(&app, &[name], &runtime_config);

    log::info!(
        "extension_intake:submitted gid={} url={}",
        gid,
        summarize_url_for_log(url.as_str())
    );
    Ok(())
}

pub async fn ensure_engine_ready_for_intake(app: &AppHandle) -> Result<(), AppError> {
    update_engine_credentials(app).await?;
    if engine_responds(app).await {
        return Ok(());
    }

    let Some(state) = app.try_state::<IntakeEngineStartState>() else {
        return Err(AppError::Engine(
            "IntakeEngineStartState not managed".into(),
        ));
    };
    let _guard = state.0.lock().await;

    update_engine_credentials(app).await?;
    if engine_responds(app).await {
        return Ok(());
    }

    let app_for_start = app.clone();
    tokio::task::spawn_blocking(move || {
        let config = commands::config::get_system_config(app_for_start.clone())?;
        crate::engine::start_engine(&app_for_start, &config).map_err(AppError::Engine)
    })
    .await
    .map_err(|e| AppError::Engine(e.to_string()))??;

    update_engine_credentials(app).await?;
    for attempt in 0..ENGINE_READY_RETRIES {
        if engine_responds(app).await {
            if let Err(e) = crate::services::on_engine_ready(app).await {
                log::warn!("extension_intake:on-engine-ready-failed error={e}");
            }
            return Ok(());
        }
        let delay = std::cmp::min(ENGINE_READY_BASE_DELAY_MS * 2u64.pow(attempt), 3000);
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }

    Err(AppError::Engine(
        "download engine did not become ready".into(),
    ))
}

async fn update_engine_credentials(app: &AppHandle) -> Result<(), AppError> {
    let (port, secret) = crate::services::read_engine_credentials_from_app(app)?;
    if let Some(aria2) = app.try_state::<Aria2State>() {
        aria2.0.update_credentials(port, secret).await;
    }
    Ok(())
}

async fn engine_responds(app: &AppHandle) -> bool {
    let Some(aria2) = app.try_state::<Aria2State>() else {
        return false;
    };
    aria2.0.get_version().await.is_ok()
}

async fn download_defaults(app: &AppHandle) -> Result<DownloadDefaults, AppError> {
    if let Some(state) = app.try_state::<DownloadDefaultsState>() {
        let current = state.snapshot().await;
        if !current.dir.trim().is_empty() {
            return Ok(current);
        }
    }

    let store = app
        .store("config.json")
        .map_err(|e| AppError::Store(format!("Failed to open config.json: {e}")))?;
    let prefs = store
        .get("preferences")
        .ok_or_else(|| AppError::Store("No preferences key in config store".into()))?;

    if let Some(state) = app.try_state::<DownloadDefaultsState>() {
        state
            .refresh_from_json(&prefs)
            .await
            .map_err(AppError::Store)?;
        return Ok(state.snapshot().await);
    }

    serde_json::from_value::<DownloadDefaults>(prefs).map_err(AppError::from)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectBuildError {
    MissingDownloadDir,
    InvalidProxy,
}

pub fn build_direct_add_uri_options(
    req: &AddRequest,
    defaults: &DownloadDefaults,
) -> Result<Value, DirectBuildError> {
    if defaults.dir.trim().is_empty() {
        return Err(DirectBuildError::MissingDownloadDir);
    }

    let mut options = Map::new();
    options.insert(
        "dir".to_string(),
        Value::String(defaults.dir.trim().to_string()),
    );
    options.insert(
        "split".to_string(),
        Value::String(defaults.split.max(1).to_string()),
    );

    if let Some(out) = req
        .filename
        .as_deref()
        .and_then(commands::aria2::sanitize_out_option)
    {
        options.insert("out".to_string(), Value::String(out));
    }

    let user_agent = sanitize_single_header_value(req.user_agent.as_deref())
        .or_else(|| sanitize_single_header_value(Some(defaults.user_agent.as_str())));
    if let Some(value) = user_agent {
        options.insert("user-agent".to_string(), Value::String(value));
    }
    if let Some(value) = sanitize_single_header_value(req.referer.as_deref()) {
        options.insert("referer".to_string(), Value::String(value));
    }

    let mut header_lines: Vec<Value> = sanitize_browser_request_headers(&req.request_headers)
        .into_iter()
        .map(|header| Value::String(format!("{}: {}", header.name, header.value)))
        .collect();
    if let Some(cookie) = sanitize_single_header_value(req.cookie.as_deref()) {
        header_lines.push(Value::String(format!("Cookie: {cookie}")));
    }
    if !header_lines.is_empty() {
        options.insert("header".to_string(), Value::Array(header_lines));
    }

    if defaults.download_proxy_enabled() {
        let proxy = defaults.proxy.server.trim();
        if !is_valid_aria2_proxy_url(proxy) {
            return Err(DirectBuildError::InvalidProxy);
        }
        options.insert("all-proxy".to_string(), Value::String(proxy.to_string()));
        if !defaults.proxy.username.trim().is_empty() {
            options.insert(
                "all-proxy-user".to_string(),
                Value::String(defaults.proxy.username.trim().to_string()),
            );
        }
        if !defaults.proxy.password.is_empty() {
            options.insert(
                "all-proxy-passwd".to_string(),
                Value::String(defaults.proxy.password.clone()),
            );
        }
        if !defaults.proxy.bypass.trim().is_empty() {
            options.insert(
                "no-proxy".to_string(),
                Value::String(defaults.proxy.bypass.trim().to_string()),
            );
        }
    }

    Ok(Value::Object(options))
}

fn effective_url(req: &AddRequest) -> &str {
    req.final_url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&req.url)
}

fn sanitize_single_header_value(value: Option<&str>) -> Option<String> {
    let value = value?;
    if value.len() > MAX_HEADER_VALUE_LENGTH || has_illegal_control_chars(value) {
        return None;
    }
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SanitizedRequestHeader {
    pub name: String,
    pub value: String,
}

fn sanitize_browser_request_headers(
    headers: &[ExternalRequestHeader],
) -> Vec<SanitizedRequestHeader> {
    let mut result = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for header in headers {
        if result.len() >= MAX_BROWSER_REQUEST_HEADERS {
            break;
        }
        let raw_name = header.name.trim();
        let normalized = raw_name.to_ascii_lowercase();
        if raw_name.is_empty()
            || !is_http_token(raw_name)
            || is_forbidden_browser_header_name(&normalized)
            || !seen.insert(normalized.clone())
        {
            continue;
        }
        let Some(value) = sanitize_single_header_value(Some(header.value.as_str())) else {
            continue;
        };
        let Some(name) = canonical_browser_header_name(&normalized) else {
            continue;
        };
        result.push(SanitizedRequestHeader {
            name: name.to_string(),
            value,
        });
    }

    result
}

fn has_illegal_control_chars(value: &str) -> bool {
    value.chars().any(|ch| {
        let code = ch as u32;
        ch == '\r' || ch == '\n' || (code < 32 && ch != '\t')
    })
}

fn is_http_token(value: &str) -> bool {
    value.chars().all(|ch| {
        ch.is_ascii_alphanumeric()
            || matches!(
                ch,
                '!' | '#'
                    | '$'
                    | '%'
                    | '&'
                    | '\''
                    | '*'
                    | '+'
                    | '-'
                    | '.'
                    | '^'
                    | '_'
                    | '`'
                    | '|'
                    | '~'
            )
    })
}

fn is_forbidden_browser_header_name(name: &str) -> bool {
    matches!(
        name,
        "authorization"
            | "connection"
            | "content-length"
            | "cookie"
            | "host"
            | "range"
            | "referer"
            | "referrer"
            | "transfer-encoding"
            | "user-agent"
    ) || name.starts_with("proxy-")
        || name.starts_with("if-")
        || canonical_browser_header_name(name).is_none()
}

fn canonical_browser_header_name(name: &str) -> Option<&'static str> {
    Some(match name {
        "accept" => "Accept",
        "accept-language" => "Accept-Language",
        "accept-encoding" => "Accept-Encoding",
        "sec-ch-ua" => "Sec-CH-UA",
        "sec-ch-ua-mobile" => "Sec-CH-UA-Mobile",
        "sec-ch-ua-platform" => "Sec-CH-UA-Platform",
        "sec-fetch-dest" => "Sec-Fetch-Dest",
        "sec-fetch-mode" => "Sec-Fetch-Mode",
        "sec-fetch-site" => "Sec-Fetch-Site",
        "sec-fetch-user" => "Sec-Fetch-User",
        "upgrade-insecure-requests" => "Upgrade-Insecure-Requests",
        "dnt" => "DNT",
        "origin" => "Origin",
        _ => return None,
    })
}

fn is_valid_aria2_proxy_url(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("socks") {
        return false;
    }
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("ftp://")
    {
        return url::Url::parse(trimmed).is_ok();
    }
    if trimmed.contains("://") {
        return false;
    }
    url::Url::parse(format!("http://{trimmed}").as_str()).is_ok()
}

fn resolve_submitted_task_name(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(segment) = parsed.path_segments().and_then(|segments| segments.last()) {
            let decoded = urlencoding::decode(segment)
                .map(|value| value.to_string())
                .unwrap_or_else(|_| segment.to_string());
            if !decoded.trim().is_empty() {
                return decoded;
            }
        }
    }
    summarize_url_for_log(url)
}

fn summarize_url_for_log(value: &str) -> String {
    if let Ok(url) = url::Url::parse(value) {
        return format!(
            "scheme={} host={} path_len={}",
            url.scheme(),
            url.host_str().unwrap_or("none"),
            url.path().len()
        );
    }
    format!("invalid length={}", value.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(url: &str) -> AddRequest {
        AddRequest {
            url: url.to_string(),
            final_url: None,
            referer: None,
            cookie: None,
            user_agent: None,
            request_headers: Vec::new(),
            filename: None,
        }
    }

    fn defaults() -> DownloadDefaults {
        DownloadDefaults {
            dir: "C:/Downloads".to_string(),
            split: 16,
            user_agent: "DefaultUA".to_string(),
            auto_submit_from_extension: true,
            silent_auto_submit_from_extension: true,
            file_category_enabled: false,
            file_categories: Vec::new(),
            user_agent_rules: Vec::new(),
            proxy: Default::default(),
            task_notification: true,
            notify_on_start: true,
            notify_on_complete: true,
        }
    }

    #[test]
    fn build_options_forwards_safe_browser_context() {
        let mut request = req("https://example.com/file.zip");
        request.filename = Some("../file.zip".to_string());
        request.referer = Some("https://example.com/page".to_string());
        request.cookie = Some("sid=abc".to_string());
        request.user_agent = Some("BrowserUA".to_string());
        request.request_headers = vec![
            ExternalRequestHeader {
                name: "Accept".to_string(),
                value: "application/octet-stream".to_string(),
            },
            ExternalRequestHeader {
                name: "Host".to_string(),
                value: "evil.test".to_string(),
            },
        ];

        let options = build_direct_add_uri_options(&request, &defaults()).unwrap();
        let object = options.as_object().unwrap();
        assert_eq!(object["dir"], "C:/Downloads");
        assert_eq!(object["split"], "16");
        assert_eq!(object["out"], "file.zip");
        assert_eq!(object["user-agent"], "BrowserUA");
        assert_eq!(object["referer"], "https://example.com/page");
        let headers = object["header"].as_array().unwrap();
        assert_eq!(headers.len(), 2);
        assert!(headers
            .iter()
            .any(|h| h == &Value::String("Accept: application/octet-stream".to_string())));
        assert!(headers
            .iter()
            .any(|h| h == &Value::String("Cookie: sid=abc".to_string())));
    }

    #[test]
    fn drops_unsafe_headers() {
        let headers = sanitize_browser_request_headers(&[
            ExternalRequestHeader {
                name: "Cookie".to_string(),
                value: "sid=abc".to_string(),
            },
            ExternalRequestHeader {
                name: "Accept".to_string(),
                value: "ok\r\nbad".to_string(),
            },
            ExternalRequestHeader {
                name: "Origin".to_string(),
                value: "https://example.com".to_string(),
            },
        ]);

        assert_eq!(
            headers,
            vec![SanitizedRequestHeader {
                name: "Origin".to_string(),
                value: "https://example.com".to_string()
            }]
        );
    }

    #[test]
    fn rejects_socks_proxy() {
        assert!(!is_valid_aria2_proxy_url("socks5://127.0.0.1:1080"));
        assert!(is_valid_aria2_proxy_url("http://127.0.0.1:8080"));
        assert!(is_valid_aria2_proxy_url("127.0.0.1:8080"));
    }
}
