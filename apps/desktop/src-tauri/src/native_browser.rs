use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    hash::{Hash, Hasher},
    sync::{mpsc, Mutex},
    time::Duration,
};

use serde::Serialize;
use tauri::{
    webview::{Webview, WebviewBuilder},
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Window,
};

const EVAL_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_SCRIPT_BYTES: usize = 64 * 1024;

#[derive(Default)]
pub struct NativeBrowserViews(Mutex<HashMap<String, String>>);

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
    let label = views
        .0
        .lock()
        .map_err(|_| "browser view registry is unavailable".to_owned())?
        .get(&key)
        .cloned()
        .ok_or_else(|| "browser view is not open".to_owned())?;
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
    let mut registered = views
        .0
        .lock()
        .map_err(|_| "browser view registry is unavailable".to_owned())?;

    if let Some(existing_label) = registered.get(&key) {
        if let Some(view) = app.get_webview(existing_label) {
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
            return Ok(());
        }
        registered.remove(&key);
    }

    let window: Window = app
        .get_window("main")
        .ok_or_else(|| "main application window is unavailable".to_owned())?;
    let event_app = app.clone();
    let event_session = session_id.clone();
    let event_instance = instance_id.clone();
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
        });
    let view = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| error.to_string())?;
    view.show().map_err(|error| error.to_string())?;
    registered.insert(key, label);
    Ok(())
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
    let view = get_view(&app, &views, &session_id, &instance_id)?;
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
        .remove(&key);
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
