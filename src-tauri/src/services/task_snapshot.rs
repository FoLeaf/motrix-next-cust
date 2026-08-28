//! Lightweight task snapshots for the browser-extension progress UI.
//!
//! This module intentionally exports a small, sanitized view of aria2 tasks:
//! no URLs, cookies, headers, RPC tokens, or extension tokens are included.

use crate::aria2::client::{Aria2Client, Aria2State};
use crate::aria2::types::{Aria2File, Aria2Task};
use crate::error::AppError;
use crate::history::{HistoryDbState, HistoryRecord};
use serde::Serialize;
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::Manager;

const WAITING_LIMIT: i64 = 1000;
const STOPPED_LIMIT: i64 = 128;
const HISTORY_LIMIT: u32 = 256;
const WAITING_PAGE_SIZE: i64 = 1000;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub totals: TaskSnapshotTotals,
    pub tasks: Vec<TaskSnapshotItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshotTotals {
    pub num_active: u64,
    pub num_waiting: u64,
    pub num_stopped: u64,
    pub num_stopped_total: u64,
    pub download_speed: u64,
    pub upload_speed: u64,
    pub progress: Option<f64>,
    pub has_unknown_size: bool,
    pub has_error: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshotItem {
    pub gid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
    pub name: String,
    pub status: String,
    pub total_length: u64,
    pub completed_length: u64,
    pub progress: Option<f64>,
    pub download_speed: u64,
    pub upload_speed: u64,
    pub eta_seconds: Option<u64>,
    pub dir: String,
    pub target_path: Option<String>,
    pub task_type: String,
}

pub async fn fetch_task_snapshot(app: &tauri::AppHandle) -> Result<TaskSnapshot, AppError> {
    let aria2 = app
        .try_state::<Aria2State>()
        .ok_or_else(|| AppError::Engine("Aria2State not managed".into()))?;
    let client = aria2.0.clone();

    let (stat, active, waiting, stopped) = tokio::try_join!(
        client.get_global_stat(),
        client.tell_active(),
        fetch_waiting_tasks(&client, WAITING_LIMIT),
        client.tell_stopped(0, STOPPED_LIMIT),
    )?;

    let birth_records = load_task_births(app).await;
    let mut tasks = Vec::with_capacity(active.len() + waiting.len() + stopped.len());
    let mut seen_gids = HashSet::new();
    for task in active
        .iter()
        .chain(waiting.iter())
        .chain(stopped.iter())
    {
        if !seen_gids.insert(task.gid.clone()) {
            continue;
        }
        tasks.push(snapshot_item_from_task_with_births(task, &birth_records));
    }

    for record in load_history_records(app).await {
        if seen_gids.contains(&record.gid) {
            continue;
        }
        tasks.push(snapshot_item_from_history_record(&record));
    }
    sort_items_by_added_at_desc(&mut tasks);

    let totals = TaskSnapshotTotals {
        num_active: parse_u64(&stat.num_active),
        num_waiting: parse_u64(&stat.num_waiting),
        num_stopped: parse_u64(&stat.num_stopped),
        num_stopped_total: parse_u64(&stat.num_stopped_total),
        download_speed: parse_u64(&stat.download_speed),
        upload_speed: parse_u64(&stat.upload_speed),
        progress: aggregate_progress(active.iter().chain(waiting.iter())),
        has_unknown_size: active.iter().chain(waiting.iter()).any(has_unknown_size),
        has_error: tasks.iter().any(|task| task.status == "error"),
    };

    Ok(TaskSnapshot { totals, tasks })
}

#[cfg(test)]
pub fn snapshot_item_from_task(task: &Aria2Task) -> TaskSnapshotItem {
    snapshot_item_from_task_with_added_at(task, None)
}

fn snapshot_item_from_task_with_births(
    task: &Aria2Task,
    birth_records: &HashMap<String, String>,
) -> TaskSnapshotItem {
    snapshot_item_from_task_with_added_at(task, birth_records.get(&task.gid).cloned())
}

fn snapshot_item_from_task_with_added_at(
    task: &Aria2Task,
    added_at: Option<String>,
) -> TaskSnapshotItem {
    let total_length = parse_u64(&task.total_length);
    let completed_length = parse_u64(&task.completed_length);
    let download_speed = parse_u64(&task.download_speed);
    TaskSnapshotItem {
        gid: task.gid.clone(),
        added_at,
        name: extract_task_name(task),
        status: task.status.clone(),
        total_length,
        completed_length,
        progress: task_progress(total_length, completed_length, &task.status),
        download_speed,
        upload_speed: parse_u64(&task.upload_speed),
        eta_seconds: eta_seconds(total_length, completed_length, download_speed, &task.status),
        dir: task.dir.clone(),
        target_path: resolve_task_target_path(task),
        task_type: task_type(task).to_string(),
    }
}

pub fn sort_items_by_added_at_desc(items: &mut [TaskSnapshotItem]) {
    items.sort_by(|a, b| {
        parse_rfc3339_millis(b.added_at.as_deref())
            .cmp(&parse_rfc3339_millis(a.added_at.as_deref()))
    });
}

async fn load_history_records(app: &tauri::AppHandle) -> Vec<HistoryRecord> {
    let Some(db_state) = app.try_state::<HistoryDbState>() else {
        return Vec::new();
    };
    match db_state.0.get_records(None, Some(HISTORY_LIMIT)).await {
        Ok(records) => records,
        Err(e) => {
            log::debug!("task_snapshot: history load failed: {e}");
            Vec::new()
        }
    }
}

async fn fetch_waiting_tasks(client: &Aria2Client, max: i64) -> Result<Vec<Aria2Task>, AppError> {
    let mut tasks = Vec::new();
    let mut offset = 0i64;
    loop {
        let page = client
            .tell_waiting(offset, WAITING_PAGE_SIZE)
            .await?;
        let page_len = page.len();
        tasks.extend(page);
        if page_len < WAITING_PAGE_SIZE as usize || tasks.len() as i64 >= max {
            break;
        }
        offset += WAITING_PAGE_SIZE;
    }
    tasks.truncate(max as usize);
    Ok(tasks)
}

fn completed_length_from_history_record(
    record: &HistoryRecord,
    total_length: u64,
    status: &str,
) -> u64 {
    match status {
        "complete" => total_length,
        "active" | "waiting" | "paused" => parse_completed_length_meta(record.meta.as_deref())
            .unwrap_or(0)
            .min(total_length),
        _ => 0,
    }
}

fn parse_completed_length_meta(meta: Option<&str>) -> Option<u64> {
    let value = serde_json::from_str::<serde_json::Value>(meta?).ok()?;
    value
        .get("completedLength")
        .and_then(|entry| entry.as_str())
        .and_then(|raw| raw.parse::<u64>().ok())
}

fn is_live_session_status(status: &str) -> bool {
    matches!(status, "active" | "waiting" | "paused")
}

fn is_metadata_task(task: &Aria2Task) -> bool {
    task.bittorrent.is_some()
        && task
            .bittorrent
            .as_ref()
            .and_then(|bt| bt.info.as_ref())
            .is_none()
        && task.following.is_none()
}

/// Upsert live aria2 session tasks into history so extension snapshots can
/// surface RPC-pushed downloads even when the UI has not written history yet.
pub async fn persist_live_session_tasks(app: &tauri::AppHandle, tasks: &[Aria2Task]) {
    let Some(db_state) = app.try_state::<HistoryDbState>() else {
        return;
    };
    let db = db_state.0.clone();
    let now = chrono::Utc::now().to_rfc3339();

    for task in tasks {
        if !is_live_session_status(&task.status) || is_metadata_task(task) {
            continue;
        }

        let gid = task.gid.clone();
        let record = build_live_history_record(task, None);
        let birth_at = record.added_at.clone().unwrap_or_else(|| now.clone());
        let db = db.clone();
        tokio::spawn(async move {
            if let Err(e) = db.record_task_birth(&gid, &birth_at).await {
                log::debug!("task_snapshot: task_birth write failed for {gid}: {e}");
            }
            if let Err(e) = db.add_record(&record).await {
                log::debug!("task_snapshot: live history upsert failed for {gid}: {e}");
            }
        });
    }
}

pub async fn fetch_waiting_tasks_for_monitor(
    client: &Aria2Client,
) -> Result<Vec<Aria2Task>, AppError> {
    fetch_waiting_tasks(client, WAITING_LIMIT).await
}

pub fn build_live_history_record(task: &Aria2Task, added_at: Option<String>) -> HistoryRecord {
    let total_length = parse_u64(&task.total_length) as i64;
    let completed_length = parse_u64(&task.completed_length);
    let uri = task
        .files
        .first()
        .and_then(|file| file.uris.first())
        .map(|entry| entry.uri.clone())
        .filter(|uri| !uri.is_empty());
    let meta = (completed_length > 0).then(|| {
        serde_json::json!({ "completedLength": completed_length.to_string() }).to_string()
    });

    HistoryRecord {
        id: None,
        gid: task.gid.clone(),
        name: extract_task_name(task),
        uri,
        dir: Some(task.dir.clone()),
        total_length: Some(total_length),
        status: task.status.clone(),
        task_type: Some(task_type(task).to_string()),
        added_at: added_at.or_else(|| Some(chrono::Utc::now().to_rfc3339())),
        created_at: None,
        completed_at: None,
        meta,
    }
}

pub fn resolve_history_target_path(record: &HistoryRecord) -> Option<String> {
    let name = record.name.trim();
    if name.is_empty() {
        return None;
    }
    let dir = record.dir.clone().unwrap_or_default();
    if dir.is_empty() {
        Some(name.to_string())
    } else {
        Some(join_path(&dir, name))
    }
}

fn snapshot_item_from_history_record(record: &HistoryRecord) -> TaskSnapshotItem {
    let total_length = record.total_length.unwrap_or(0).max(0) as u64;
    let status = record.status.clone();
    let completed_length = completed_length_from_history_record(record, total_length, &status);
    let dir = record.dir.clone().unwrap_or_default();
    let target_path = resolve_history_target_path(record);

    TaskSnapshotItem {
        gid: record.gid.clone(),
        added_at: record
            .added_at
            .clone()
            .or_else(|| record.completed_at.clone()),
        name: record.name.clone(),
        status,
        total_length,
        completed_length,
        progress: task_progress(total_length, completed_length, record.status.as_str()),
        download_speed: 0,
        upload_speed: 0,
        eta_seconds: None,
        dir,
        target_path,
        task_type: record
            .task_type
            .clone()
            .unwrap_or_else(|| "uri".to_string()),
    }
}

async fn load_task_births(app: &tauri::AppHandle) -> HashMap<String, String> {
    let Some(db_state) = app.try_state::<HistoryDbState>() else {
        return HashMap::new();
    };
    match db_state.0.clone().load_birth_records().await {
        Ok(records) => records.into_iter().collect(),
        Err(e) => {
            log::debug!("task_snapshot: birth record load failed: {e}");
            HashMap::new()
        }
    }
}

fn parse_rfc3339_millis(value: Option<&str>) -> i64 {
    value
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|time| time.timestamp_millis())
        .unwrap_or(0)
}

pub fn resolve_task_target_path(task: &Aria2Task) -> Option<String> {
    let dir = task.dir.trim();
    if dir.is_empty() {
        return None;
    }

    let selected_files: Vec<&Aria2File> = task
        .files
        .iter()
        .filter(|file| file.selected != "false" && !file.path.trim().is_empty())
        .collect();

    if task.bittorrent.is_some() && selected_files.len() > 1 {
        let name = extract_task_name(task);
        if !name.trim().is_empty() {
            return Some(join_path(dir, &name));
        }
    }

    selected_files
        .first()
        .map(|file| normalize_task_path(dir, &file.path))
        .or_else(|| Some(dir.to_string()))
}

pub fn parse_u64(value: &str) -> u64 {
    value.parse::<u64>().unwrap_or(0)
}

fn task_type(task: &Aria2Task) -> &'static str {
    if task.bittorrent.is_some() {
        "bt"
    } else if task.ed2k.is_some() {
        "ed2k"
    } else {
        "uri"
    }
}

fn extract_task_name(task: &Aria2Task) -> String {
    if let Some(bt) = &task.bittorrent {
        if let Some(info) = &bt.info {
            if !info.name.is_empty() {
                return info.name.clone();
            }
        }
    }
    if let Some(ed2k) = &task.ed2k {
        if let Some(name) = ed2k.name.as_deref().filter(|name| !name.is_empty()) {
            return name.to_string();
        }
    }
    if let Some(first) = task.files.iter().find(|file| !file.path.is_empty()) {
        return basename(&first.path);
    }
    String::new()
}

fn basename(path: &str) -> String {
    let sep = path.rfind('/').or_else(|| path.rfind('\\'));
    sep.map(|idx| path[idx + 1..].to_string())
        .unwrap_or_else(|| path.to_string())
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

fn task_progress(total: u64, completed: u64, status: &str) -> Option<f64> {
    if total == 0 {
        if status == "complete" {
            return Some(100.0);
        }
        return None;
    }
    Some(percent(completed.min(total), total))
}

fn aggregate_progress<'a>(tasks: impl Iterator<Item = &'a Aria2Task>) -> Option<f64> {
    let mut total = 0u64;
    let mut completed = 0u64;
    for task in tasks {
        let task_total = parse_u64(&task.total_length);
        if task_total == 0 {
            continue;
        }
        total = total.saturating_add(task_total);
        completed = completed.saturating_add(parse_u64(&task.completed_length).min(task_total));
    }
    (total > 0).then(|| percent(completed, total))
}

fn has_unknown_size(task: &Aria2Task) -> bool {
    !matches!(task.status.as_str(), "complete" | "error" | "removed")
        && parse_u64(&task.total_length) == 0
}

fn eta_seconds(total: u64, completed: u64, speed: u64, status: &str) -> Option<u64> {
    if speed == 0 || total == 0 || matches!(status, "complete" | "error" | "removed") {
        return None;
    }
    let remaining = total.saturating_sub(completed.min(total));
    (remaining > 0).then(|| remaining.div_ceil(speed))
}

fn percent(completed: u64, total: u64) -> f64 {
    ((completed as f64 / total as f64) * 10000.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::aria2::types::{Aria2BtInfo, Aria2BtName};

    fn task(gid: &str, status: &str, total: &str, completed: &str, speed: &str) -> Aria2Task {
        Aria2Task {
            gid: gid.to_string(),
            status: status.to_string(),
            total_length: total.to_string(),
            completed_length: completed.to_string(),
            upload_length: "0".to_string(),
            download_speed: speed.to_string(),
            upload_speed: "0".to_string(),
            connections: "0".to_string(),
            dir: "C:/Downloads".to_string(),
            files: vec![Aria2File {
                index: "1".to_string(),
                path: "file.zip".to_string(),
                length: total.to_string(),
                completed_length: completed.to_string(),
                selected: "true".to_string(),
                uris: Vec::new(),
            }],
            bittorrent: None,
            ed2k: None,
            info_hash: None,
            num_seeders: None,
            seeder: None,
            bitfield: None,
            error_code: None,
            error_message: None,
            num_pieces: None,
            piece_length: None,
            verified_length: None,
            verify_integrity_pending: None,
            followed_by: None,
            following: None,
            belongs_to: None,
        }
    }

    #[test]
    fn aggregate_progress_is_byte_weighted() {
        let a = task("a", "active", "100", "50", "10");
        let b = task("b", "active", "900", "450", "10");
        assert_eq!(aggregate_progress([&a, &b].into_iter()), Some(50.0));
    }

    #[test]
    fn aggregate_progress_ignores_unknown_size_but_marks_unknown() {
        let known = task("a", "active", "100", "25", "10");
        let unknown = task("b", "active", "0", "0", "10");
        assert_eq!(
            aggregate_progress([&known, &unknown].into_iter()),
            Some(25.0)
        );
        assert!(has_unknown_size(&unknown));
    }

    #[test]
    fn eta_uses_remaining_bytes_and_speed() {
        let item = snapshot_item_from_task(&task("a", "active", "1000", "250", "100"));
        assert_eq!(item.eta_seconds, Some(8));
        assert_eq!(item.progress, Some(25.0));
    }

    #[test]
    fn single_file_target_joins_relative_path_to_dir() {
        let item = snapshot_item_from_task(&task("a", "active", "10", "1", "1"));
        assert_eq!(item.target_path.as_deref(), Some("C:/Downloads/file.zip"));
    }

    #[test]
    fn absolute_file_target_is_preserved() {
        let mut t = task("a", "complete", "10", "10", "0");
        t.files[0].path = "D:/Data/file.zip".to_string();
        assert_eq!(
            resolve_task_target_path(&t).as_deref(),
            Some("D:/Data/file.zip")
        );
    }

    #[test]
    fn bt_multi_file_target_uses_root_name() {
        let mut t = task("bt", "active", "100", "10", "10");
        t.bittorrent = Some(Aria2BtInfo {
            info: Some(Aria2BtName {
                name: "Torrent Root".to_string(),
            }),
            announce_list: None,
            magnet_link: None,
            creation_date: None,
            comment: None,
            mode: Some("multi".to_string()),
        });
        t.files.push(Aria2File {
            index: "2".to_string(),
            path: "b.mkv".to_string(),
            length: "50".to_string(),
            completed_length: "0".to_string(),
            selected: "true".to_string(),
            uris: Vec::new(),
        });

        assert_eq!(
            resolve_task_target_path(&t).as_deref(),
            Some("C:/Downloads/Torrent Root")
        );
    }

    #[test]
    fn snapshot_item_does_not_serialize_file_uris() {
        let mut t = task("a", "active", "10", "1", "1");
        t.files[0].uris = vec![crate::aria2::types::Aria2FileUri {
            uri: "https://example.com/secret?token=abc".to_string(),
            status: "used".to_string(),
        }];
        let value = serde_json::to_string(&snapshot_item_from_task(&t)).unwrap();
        assert!(!value.contains("example.com"));
        assert!(!value.contains("token=abc"));
        assert!(value.contains("file.zip"));
    }

    #[test]
    fn sort_items_by_added_at_desc_places_newest_first() {
        let mut old = snapshot_item_from_task(&task("old", "active", "10", "1", "1"));
        old.added_at = Some("2026-01-01T00:00:00Z".to_string());
        let mut new = snapshot_item_from_task(&task("new", "active", "10", "1", "1"));
        new.added_at = Some("2026-06-01T00:00:00Z".to_string());
        let missing = snapshot_item_from_task(&task("missing", "active", "10", "1", "1"));
        let mut items = vec![old, missing, new];

        sort_items_by_added_at_desc(&mut items);

        let gids: Vec<&str> = items.iter().map(|item| item.gid.as_str()).collect();
        assert_eq!(gids, vec!["new", "old", "missing"]);
    }

    #[test]
    fn history_record_snapshot_preserves_in_progress_bytes_from_meta() {
        let item = snapshot_item_from_history_record(&HistoryRecord {
            id: Some(2),
            gid: "gid-rpc".to_string(),
            name: "rpc-file.zip".to_string(),
            uri: Some("https://example.com/file.zip".to_string()),
            dir: Some("C:/Downloads".to_string()),
            total_length: Some(1000),
            status: "active".to_string(),
            task_type: Some("uri".to_string()),
            added_at: Some("2026-06-01T00:00:00Z".to_string()),
            created_at: None,
            completed_at: None,
            meta: Some(r#"{"completedLength":"250"}"#.to_string()),
        });

        assert_eq!(item.status, "active");
        assert_eq!(item.completed_length, 250);
        assert_eq!(item.progress, Some(25.0));
    }

    #[test]
    fn build_live_history_record_stores_progress_meta_for_active_tasks() {
        let record = build_live_history_record(
            &task("rpc", "active", "1000", "250", "100"),
            Some("2026-06-01T00:00:00Z".to_string()),
        );
        assert_eq!(record.status, "active");
        assert_eq!(record.meta.as_deref(), Some(r#"{"completedLength":"250"}"#));
    }

    #[test]
    fn history_record_snapshot_marks_complete_tasks_as_finished() {
        let item = snapshot_item_from_history_record(&HistoryRecord {
            id: Some(1),
            gid: "gid-history".to_string(),
            name: "archive.zip".to_string(),
            uri: None,
            dir: Some("C:/Downloads".to_string()),
            total_length: Some(1024),
            status: "complete".to_string(),
            task_type: Some("uri".to_string()),
            added_at: Some("2026-06-01T00:00:00Z".to_string()),
            created_at: None,
            completed_at: Some("2026-06-01T01:00:00Z".to_string()),
            meta: None,
        });

        assert_eq!(item.gid, "gid-history");
        assert_eq!(item.status, "complete");
        assert_eq!(item.progress, Some(100.0));
        assert_eq!(
            item.target_path.as_deref(),
            Some("C:/Downloads/archive.zip")
        );
    }

    #[test]
    fn added_at_serializes_as_camel_case() {
        let mut item = snapshot_item_from_task(&task("a", "active", "10", "1", "1"));
        item.added_at = Some("2026-01-01T00:00:00Z".to_string());

        let value = serde_json::to_value(&item).unwrap();

        assert_eq!(value["addedAt"], "2026-01-01T00:00:00Z");
        assert!(value.get("added_at").is_none());
    }
}
