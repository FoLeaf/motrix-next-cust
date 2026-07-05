//! Notification activation routing for completed downloads.
//!
//! Tokens intentionally do not contain paths, URLs, or credentials.  Windows
//! toast activation may carry only the token; the target path stays in memory.

use super::monitor::TaskEvent;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

const OPEN_TARGET_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const OPEN_TARGET_LIMIT: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationActivationAction {
    Open,
    Dir,
}

impl NotificationActivationAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Dir => "dir",
        }
    }
}

#[derive(Debug, Clone)]
struct OpenTargetEntry {
    token: String,
    gid: String,
    path: String,
    dir: String,
    created_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ActivationDispatch {
    OpenPath(String),
    RevealItem(String),
}

#[derive(Default)]
pub struct NotificationActivationState {
    entries: Mutex<VecDeque<OpenTargetEntry>>,
}

impl NotificationActivationState {
    pub fn new() -> Self {
        Self::default()
    }
}

pub fn register_open_target_for_event(app: &tauri::AppHandle, event: &TaskEvent) -> Option<String> {
    let target = resolve_open_target_for_event(event)?;
    let token = generate_token();
    let entry = OpenTargetEntry {
        token: token.clone(),
        gid: event.gid.clone(),
        path: target,
        dir: event.dir.clone(),
        created_at: Instant::now(),
    };
    if let Some(state) = app.try_state::<NotificationActivationState>() {
        let mut entries = state
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        prune_entries(&mut entries);
        entries.push_back(entry);
        while entries.len() > OPEN_TARGET_LIMIT {
            entries.pop_front();
        }
        log::debug!("notification_activation:registered gid={}", event.gid);
        Some(token)
    } else {
        None
    }
}

pub fn resolve_open_target_for_event(event: &TaskEvent) -> Option<String> {
    resolve_open_target(event)
}

pub fn build_activation_url(token: &str, action: NotificationActivationAction) -> String {
    format!(
        "motrixnextopt://open-download/{}/{}",
        action.as_str(),
        urlencoding::encode(token)
    )
}

pub fn try_handle_activation_url(app: &tauri::AppHandle, raw_url: &str) -> bool {
    let Ok(url) = url::Url::parse(raw_url) else {
        return false;
    };
    if url.scheme() != "motrixnextopt" || url.host_str() != Some("open-download") {
        return false;
    }
    let token = parse_activation_token(&url);
    let Some(token) = token else {
        return true;
    };
    let action = parse_activation_action(&url);

    match find_open_target(app, &token) {
        Some(entry) => {
            let dispatch = dispatch_for_action(&entry, action);
            log::info!(
                "notification_activation:activate gid={} action={}",
                entry.gid,
                action.as_str()
            );
            let result = match dispatch {
                ActivationDispatch::OpenPath(path) => {
                    crate::commands::fs::open_path_normalized(app.clone(), path)
                }
                ActivationDispatch::RevealItem(path) => crate::commands::fs::show_item_in_dir(path),
            };
            if let Err(e) = result {
                log::warn!(
                    "notification_activation:activate-failed gid={} action={} error={e}",
                    entry.gid,
                    action.as_str()
                );
            }
        }
        None => {
            log::warn!("notification_activation:token-missing-or-expired");
        }
    }
    true
}

fn find_open_target(app: &tauri::AppHandle, token: &str) -> Option<OpenTargetEntry> {
    let state = app.try_state::<NotificationActivationState>()?;
    let mut entries = state
        .entries
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    prune_entries(&mut entries);
    find_open_target_entry(&entries, token)
}

fn find_open_target_entry(
    entries: &VecDeque<OpenTargetEntry>,
    token: &str,
) -> Option<OpenTargetEntry> {
    entries.iter().find(|entry| entry.token == token).cloned()
}

fn dispatch_for_action(
    entry: &OpenTargetEntry,
    action: NotificationActivationAction,
) -> ActivationDispatch {
    let target = if Path::new(&entry.path).exists() {
        entry.path.as_str()
    } else {
        entry.dir.as_str()
    };

    match action {
        NotificationActivationAction::Open => ActivationDispatch::OpenPath(target.to_string()),
        NotificationActivationAction::Dir => {
            if Path::new(target).is_file() {
                ActivationDispatch::RevealItem(target.to_string())
            } else {
                ActivationDispatch::OpenPath(target.to_string())
            }
        }
    }
}

fn parse_activation_token(url: &url::Url) -> Option<String> {
    let mut path_segments = url.path_segments()?;
    let _action = path_segments.next();
    if let Some(token) = path_segments.next().filter(|value| !value.is_empty()) {
        return urlencoding::decode(token)
            .ok()
            .map(|value| value.to_string());
    }

    url.query_pairs()
        .find_map(|(key, value)| (key == "token").then(|| value.to_string()))
}

fn parse_activation_action(url: &url::Url) -> NotificationActivationAction {
    if let Some(action) = url.path_segments().and_then(|mut segments| segments.next()) {
        return match action {
            "dir" => NotificationActivationAction::Dir,
            _ => NotificationActivationAction::Open,
        };
    }

    url.query_pairs()
        .find_map(|(key, value)| {
            (key == "action").then(|| match value.as_ref() {
                "dir" => NotificationActivationAction::Dir,
                _ => NotificationActivationAction::Open,
            })
        })
        .unwrap_or(NotificationActivationAction::Open)
}

fn prune_entries(entries: &mut VecDeque<OpenTargetEntry>) {
    let now = Instant::now();
    entries.retain(|entry| now.duration_since(entry.created_at) <= OPEN_TARGET_TTL);
}

fn resolve_open_target(event: &TaskEvent) -> Option<String> {
    let dir = event.dir.trim();
    if dir.is_empty() {
        return None;
    }

    if event.is_bt && event.files.len() > 1 && !event.name.trim().is_empty() {
        return Some(join_path(dir, &event.name));
    }

    event
        .files
        .iter()
        .find(|file| file.selected != "false" && !file.path.trim().is_empty())
        .map(|file| normalize_task_path(dir, &file.path))
        .or_else(|| Some(dir.to_string()))
}

fn normalize_task_path(dir: &str, path: &str) -> String {
    let task_path = PathBuf::from(path);
    if task_path.is_absolute() {
        path.replace('\\', "/")
    } else {
        join_path(dir, path)
    }
}

fn join_path(dir: &str, child: &str) -> String {
    Path::new(dir)
        .join(child)
        .to_string_lossy()
        .replace('\\', "/")
}

fn generate_token() -> String {
    format!(
        "{}{}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::monitor::TaskEventFile;
    use std::collections::VecDeque;
    use std::time::Instant;

    fn event(files: Vec<TaskEventFile>) -> TaskEvent {
        TaskEvent {
            gid: "g1".to_string(),
            name: "file.zip".to_string(),
            status: "complete".to_string(),
            error_code: None,
            error_message: None,
            dir: "C:/Downloads".to_string(),
            total_length: "1".to_string(),
            completed_length: "1".to_string(),
            info_hash: None,
            magnet_link: None,
            ed2k_link: None,
            is_bt: false,
            is_ed2k: false,
            sharing_kind: None,
            files,
            announce_list: Vec::new(),
        }
    }

    #[test]
    fn resolves_single_file_target() {
        let target = resolve_open_target(&event(vec![TaskEventFile {
            path: "file.zip".to_string(),
            length: "1".to_string(),
            selected: "true".to_string(),
            uris: Vec::new(),
        }]));

        assert_eq!(target.as_deref(), Some("C:/Downloads/file.zip"));
    }

    #[test]
    fn resolves_bt_multi_file_root() {
        let mut ev = event(vec![
            TaskEventFile {
                path: "a.mkv".to_string(),
                length: "1".to_string(),
                selected: "true".to_string(),
                uris: Vec::new(),
            },
            TaskEventFile {
                path: "b.mkv".to_string(),
                length: "1".to_string(),
                selected: "true".to_string(),
                uris: Vec::new(),
            },
        ]);
        ev.is_bt = true;
        ev.name = "Torrent".to_string();

        assert_eq!(
            resolve_open_target(&ev).as_deref(),
            Some("C:/Downloads/Torrent")
        );
    }

    #[test]
    fn activation_url_carries_action_without_target_details() {
        let open = build_activation_url("abc123", NotificationActivationAction::Open);
        let dir = build_activation_url("abc123", NotificationActivationAction::Dir);

        assert_eq!(open, "motrixnextopt://open-download/open/abc123");
        assert_eq!(dir, "motrixnextopt://open-download/dir/abc123");
        assert!(!open.contains('&'));
        assert!(!dir.contains('&'));
        assert!(!open.contains("C:/Downloads"));
        assert!(!dir.contains("file.zip"));
    }

    #[test]
    fn activation_action_defaults_to_open() {
        let no_action = url::Url::parse("motrixnextopt://open-download?token=abc").unwrap();
        let unknown =
            url::Url::parse("motrixnextopt://open-download?token=abc&action=delete").unwrap();
        let dir_query =
            url::Url::parse("motrixnextopt://open-download?token=abc&action=dir").unwrap();
        let open_path = url::Url::parse("motrixnextopt://open-download/open/abc").unwrap();
        let dir_path = url::Url::parse("motrixnextopt://open-download/dir/abc").unwrap();

        assert_eq!(
            parse_activation_action(&no_action),
            NotificationActivationAction::Open
        );
        assert_eq!(
            parse_activation_action(&unknown),
            NotificationActivationAction::Open
        );
        assert_eq!(
            parse_activation_action(&dir_query),
            NotificationActivationAction::Dir
        );
        assert_eq!(
            parse_activation_action(&open_path),
            NotificationActivationAction::Open
        );
        assert_eq!(
            parse_activation_action(&dir_path),
            NotificationActivationAction::Dir
        );
    }

    #[test]
    fn activation_token_supports_path_and_legacy_query_forms() {
        let path = url::Url::parse("motrixnextopt://open-download/dir/abc123").unwrap();
        let escaped = url::Url::parse("motrixnextopt://open-download/open/a%20b").unwrap();
        let query =
            url::Url::parse("motrixnextopt://open-download?token=abc123&action=dir").unwrap();

        assert_eq!(parse_activation_token(&path).as_deref(), Some("abc123"));
        assert_eq!(parse_activation_token(&escaped).as_deref(), Some("a b"));
        assert_eq!(parse_activation_token(&query).as_deref(), Some("abc123"));
    }

    #[test]
    fn token_lookup_does_not_consume_entry() {
        let mut entries = VecDeque::new();
        entries.push_back(OpenTargetEntry {
            token: "abc".to_string(),
            gid: "g1".to_string(),
            path: "C:/Downloads/file.zip".to_string(),
            dir: "C:/Downloads".to_string(),
            created_at: Instant::now(),
        });

        assert!(find_open_target_entry(&entries, "abc").is_some());
        assert!(find_open_target_entry(&entries, "abc").is_some());
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn dir_action_opens_download_dir_when_file_is_missing() {
        let entry = OpenTargetEntry {
            token: "abc".to_string(),
            gid: "g1".to_string(),
            path: "Z:/definitely/missing/file.zip".to_string(),
            dir: "C:/Downloads".to_string(),
            created_at: Instant::now(),
        };

        assert_eq!(
            dispatch_for_action(&entry, NotificationActivationAction::Dir),
            ActivationDispatch::OpenPath("C:/Downloads".to_string())
        );
    }

    #[test]
    fn dir_action_reveals_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file.zip");
        std::fs::write(&file, b"data").unwrap();
        let entry = OpenTargetEntry {
            token: "abc".to_string(),
            gid: "g1".to_string(),
            path: file.to_string_lossy().to_string(),
            dir: dir.path().to_string_lossy().to_string(),
            created_at: Instant::now(),
        };

        assert_eq!(
            dispatch_for_action(&entry, NotificationActivationAction::Dir),
            ActivationDispatch::RevealItem(file.to_string_lossy().to_string())
        );
    }
}
