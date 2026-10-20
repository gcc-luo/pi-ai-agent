use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    hash::{Hash, Hasher},
    sync::{mpsc, Mutex},
    time::Duration,
};

use serde::Serialize;
use tauri::{
    webview::{NewWindowResponse, Webview, WebviewBuilder},
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, Window,
};

const EVAL_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_SCRIPT_BYTES: usize = 64 * 1024;
const MAX_NATIVE_BROWSER_VIEWS: usize = 5;

struct NativeBrowserEntry {
    label: String,
    last_used: u64,
    visible: bool,
}

#[derive(Default)]
struct NativeBrowserRegistry {
    entries: HashMap<String, NativeBrowserEntry>,
    access_counter: u64,
}

#[derive(Default)]
pub struct NativeBrowserViews(Mutex<NativeBrowserRegistry>);

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserViewBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NavigationEvent {
    session_id: String,
    instance_id: String,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NewTabEvent {
    session_id: String,
    source_instance_id: String,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceToolMenuAction {
    session_id: String,
    kind: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceToolMenuDismiss {
    session_id: String,
}

fn view_key(session_id: &str, instance_id: &str) -> String {
    format!("{session_id}:{instance_id}")
}

fn view_label(session_id: &str, instance_id: &str) -> String {
    let mut hasher = DefaultHasher::new();
    view_key(session_id, instance_id).hash(&mut hasher);
    format!("native-browser-{:016x}", hasher.finish())
}

fn validate_identity(session_id: &str, instance_id: &str) -> Result<(), String> {
    let valid = |value: &str| {
        !value.is_empty()
            && value.len() <= 80
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    };
    if !valid(session_id) || !valid(instance_id) {
        return Err("invalid browser view identity".into());
    }
    Ok(())
}

fn validate_url(raw: &str) -> Result<tauri::webview::Url, String> {
    if raw == "about:blank" {
        return tauri::webview::Url::parse(raw).map_err(|error| error.to_string());
    }
    let url = tauri::webview::Url::parse(raw).map_err(|_| "invalid browser URL".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("browser URL must use http, https, or about:blank".into());
    }
    Ok(url)
}

fn get_view<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    views: &NativeBrowserViews,
    session_id: &str,
    instance_id: &str,
) -> Result<Webview<R>, String> {
    validate_identity(session_id, instance_id)?;
    let key = view_key(session_id, instance_id);
    let mut registry = views
        .0
        .lock()
        .map_err(|_| "browser view registry is unavailable".to_owned())?;
    registry.access_counter = registry.access_counter.wrapping_add(1);
    let access_counter = registry.access_counter;
    let entry = registry
        .entries
        .get_mut(&key)
        .ok_or_else(|| "browser view is not open".to_owned())?;
    entry.last_used = access_counter;
    let label = entry.label.clone();
    drop(registry);
    app.get_webview(&label)
        .ok_or_else(|| "browser view is no longer available".to_owned())
}

#[tauri::command]
pub async fn native_browser_open(
    app: tauri::AppHandle,
    views: tauri::State<'_, NativeBrowserViews>,
    session_id: String,
    instance_id: String,
    url: String,
    bounds: BrowserViewBounds,
) -> Result<(), String> {
    validate_identity(&session_id, &instance_id)?;
    let target_url = validate_url(&url)?;
    validate_bounds(bounds)?;
    let key = view_key(&session_id, &instance_id);
    let label = view_label(&session_id, &instance_id);
    let mut registry = views
        .0
        .lock()
        .map_err(|_| "browser view registry is unavailable".to_owned())?;

    if let Some(existing_label) = registry.entries.get(&key).map(|entry| entry.label.clone()) {
        if let Some(view) = app.get_webview(&existing_label) {
            view.set_position(LogicalPosition::new(bounds.x, bounds.y))
                .map_err(|error| error.to_string())?;
            view.set_size(LogicalSize::new(bounds.width, bounds.height))
                .map_err(|error| error.to_string())?;
            if view
                .url()
                .map(|current| current != target_url)
                .unwrap_or(true)
            {
                view.navigate(target_url)
                    .map_err(|error| error.to_string())?;
            }
            view.show().map_err(|error| error.to_string())?;
            registry.access_counter = registry.access_counter.wrapping_add(1);
            let access_counter = registry.access_counter;
            if let Some(entry) = registry.entries.get_mut(&key) {
                entry.last_used = access_counter;
                entry.visible = true;
            }
            return Ok(());
        }
        registry.entries.remove(&key);
    }

    if registry.entries.len() >= MAX_NATIVE_BROWSER_VIEWS {
        let victim_key = registry
            .entries
            .iter()
            .filter(|(_, entry)| !entry.visible)
            .min_by_key(|(_, entry)| (entry.visible, entry.last_used))
            .map(|(entry_key, _)| entry_key.clone());
        let victim_key = victim_key.ok_or_else(|| "all native browser views are active".to_owned())?;
        if let Some(victim) = registry.entries.get(&victim_key) {
            if let Some(view) = app.get_webview(&victim.label) {
                view.close().map_err(|error| error.to_string())?;
            }
        }
        registry.entries.remove(&victim_key);
    }

    let window: Window = app
        .get_window("main")
        .ok_or_else(|| "main application window is unavailable".to_owned())?;
    let event_app = app.clone();
    let event_session = session_id.clone();
    let event_instance = instance_id.clone();
    let popup_app = app.clone();
    let popup_session = session_id.clone();
    let popup_instance = instance_id.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(target_url))
        .focused(false)
        .on_navigation(move |url| {
            if !matches!(url.scheme(), "http" | "https") && url.as_str() != "about:blank" {
                return false;
            }
            let _ = event_app.emit(
                "native-browser-navigation",
                NavigationEvent {
                    session_id: event_session.clone(),
                    instance_id: event_instance.clone(),
                    url: url.to_string(),
                },
            );
            true
        })
        .on_new_window(move |url, _features| {
            if matches!(url.scheme(), "http" | "https") || url.as_str() == "about:blank" {
                let _ = popup_app.emit(
                    "native-browser-new-tab",
                    NewTabEvent {
                        session_id: popup_session.clone(),
                        source_instance_id: popup_instance.clone(),
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        });
    let view = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| error.to_string())?;
    view.show().map_err(|error| error.to_string())?;
    registry.access_counter = registry.access_counter.wrapping_add(1);
    let access_counter = registry.access_counter;
    registry.entries.insert(key, NativeBrowserEntry {
        label,
        last_used: access_counter,
        visible: true,
    });
    Ok(())
}

#[tauri::command]
pub fn native_workspace_tool_menu_open(
    app: tauri::AppHandle,
    session_id: String,
    bounds: BrowserViewBounds,
    data_url: String,
) -> Result<(), String> {
    validate_identity(&session_id, "menu")?;
    validate_bounds(bounds)?;
    if data_url.len() > 64 * 1024 || !data_url.starts_with("data:text/html;charset=utf-8,") {
        return Err("invalid workspace tool menu content".into());
    }
    let target_url = tauri::webview::Url::parse(&data_url)
        .map_err(|_| "invalid workspace tool menu URL".to_owned())?;
    let label = workspace_tool_menu_label(&session_id);
    if let Some(existing) = app.get_webview_window(&label) {
        existing.close().map_err(|error| error.to_string())?;
    }
    let window: Window = app
        .get_window("main")
        .ok_or_else(|| "main application window is unavailable".to_owned())?;
    let parent_position = window
        .inner_position()
        .map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let popup_x = parent_position.x as f64 / scale_factor + bounds.x;
    let popup_y = parent_position.y as f64 / scale_factor + bounds.y;
    let event_app = app.clone();
    let dismiss_session = session_id.clone();
    let event_session = session_id;
    let menu_app = app.clone();
    let menu_label = label.clone();
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(target_url))
        .focused(true)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .position(popup_x, popup_y)
        .inner_size(bounds.width, bounds.height)
        .on_navigation(move |url| {
            if url.scheme() == "data" {
                return true;
            }
            if url.scheme() != "pi-tool-menu" {
                return false;
            }
            let kind = url.host_str().unwrap_or_default();
            if matches!(kind, "files" | "browser" | "terminal") {
                let _ = event_app.emit(
                    "native-workspace-tool-menu-action",
                    WorkspaceToolMenuAction {
                        session_id: event_session.clone(),
                        kind: kind.to_owned(),
                    },
                );
            } else if kind == "dismiss" {
                let _ = event_app.emit(
                    "native-workspace-tool-menu-dismiss",
                    WorkspaceToolMenuDismiss {
                        session_id: event_session.clone(),
                    },
                );
            }
            if let Some(menu) = menu_app.get_webview_window(&menu_label) {
                let _ = menu.close();
            }
            false
        });
    let popup = builder.build().map_err(|error| error.to_string())?;
    let dismiss_app = app.clone();
    let dismiss_label = label.clone();
    popup.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Focused(false)) {
            let _ = dismiss_app.emit(
                "native-workspace-tool-menu-dismiss",
                WorkspaceToolMenuDismiss {
                    session_id: dismiss_session.clone(),
                },
            );
            if let Some(menu) = dismiss_app.get_webview_window(&dismiss_label) {
                let _ = menu.close();
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn native_workspace_tool_menu_close(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    validate_identity(&session_id, "menu")?;
    if let Some(view) = app.get_webview_window(&workspace_tool_menu_label(&session_id)) {
        view.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn workspace_tool_menu_label(session_id: &str) -> String {
    let mut hasher = DefaultHasher::new();
    session_id.hash(&mut hasher);
    format!("native-tool-menu-{:016x}", hasher.finish())
}

#[tauri::command]
pub fn native_browser_set_bounds(
    app: tauri::AppHandle,
    views: tauri::State<'_, NativeBrowserViews>,
    session_id: String,
    instance_id: String,
    bounds: BrowserViewBounds,
) -> Result<(), String> {
    validate_bounds(bounds)?;
    let view = get_view(&app, &views, &session_id, &instance_id)?;
    view.set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| error.to_string())?;
    view.set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn native_browser_set_visible(
    app: tauri::AppHandle,
    views: tauri::State<'_, NativeBrowserViews>,
    session_id: String,
    instance_id: String,
    visible: bool,
) -> Result<(), String> {
    validate_identity(&session_id, &instance_id)?;
    let key = view_key(&session_id, &instance_id);
    let mut registry = views
        .0
        .lock()
        .map_err(|_| "browser view registry is unavailable".to_owned())?;
    if visible {
        registry.access_counter = registry.access_counter.wrapping_add(1);
    }
    let access_counter = registry.access_counter;
    let entry = registry
        .entries
        .get_mut(&key)
        .ok_or_else(|| "browser view is not open".to_owned())?;
    entry.visible = visible;
    if visible {
        entry.last_used = access_counter;
    }
    let view = app
        .get_webview(&entry.label)
        .ok_or_else(|| "browser view is no longer available".to_owned())?;
    drop(registry);
    if visible {
        view.show().map_err(|error| error.to_string())
    } else {
        view.hide().map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn native_browser_navigate(
    app: tauri::AppHandle,
    views: tauri::State<'_, NativeBrowserViews>,
    session_id: String,
    instance_id: String,
    url: String,
) -> Result<(), String> {
    let view = get_view(&app, &views, &session_id, &instance_id)?;
    view.navigate(validate_url(&url)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn native_browser_reload(
    app: tauri::AppHandle,
    views: tauri::State<'_, NativeBrowserViews>,
    session_id: String,
    instance_id: String,
) -> Result<(), String> {
    get_view(&app, &views, &session_id, &instance_id)?
        .reload()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn native_browser_eval(
    app: tauri::AppHandle,
    views: tauri::State<'_, NativeBrowserViews>,
    session_id: String,
    instance_id: String,
    script: String,
) -> Result<String, String> {
    if script.len() > MAX_SCRIPT_BYTES {
        return Err("browser script exceeds the maximum size".into());
    }
    let view = get_view(&app, &views, &session_id, &instance_id)?;
    let (sender, receiver) = mpsc::sync_channel(1);
    view.eval_with_callback(script, move |result| {
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(EVAL_TIMEOUT)
            .map_err(|error| format!("browser evaluation timed out or failed: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn native_browser_close(
    app: tauri::AppHandle,
    views: tauri::State<'_, NativeBrowserViews>,
    session_id: String,
    instance_id: String,
) -> Result<(), String> {
    validate_identity(&session_id, &instance_id)?;
    let key = view_key(&session_id, &instance_id);
    let label = views
        .0
        .lock()
        .map_err(|_| "browser view registry is unavailable".to_owned())?
        .entries
        .remove(&key)
        .map(|entry| entry.label);
    if let Some(label) = label {
        if let Some(view) = app.get_webview(&label) {
            view.close().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn validate_bounds(bounds: BrowserViewBounds) -> Result<(), String> {
    let values = [bounds.x, bounds.y, bounds.width, bounds.height];
    if values.iter().any(|value| !value.is_finite())
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width < 1.0
        || bounds.height < 1.0
        || bounds.width > 16_384.0
        || bounds.height > 16_384.0
    {
        return Err("invalid browser view bounds".into());
    }
    Ok(())
}
