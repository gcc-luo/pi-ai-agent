use flate2::read::GzDecoder;
use std::{
    fs,
    fs::File,
    io,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU16, Ordering},
    sync::Mutex,
};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Default)]
struct ServerProcess(Mutex<Option<CommandChild>>);

#[derive(Default)]
struct ServerPort(AtomicU16);

#[tauri::command]
fn get_server_port(port: tauri::State<'_, ServerPort>) -> Result<u16, String> {
    match port.0.load(Ordering::SeqCst) {
        0 => Err("server port is not initialized".to_owned()),
        value => Ok(value),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(ServerProcess::default())
        .manage(ServerPort::default())
        .invoke_handler(tauri::generate_handler![get_server_port])
        .setup(|app| {
            start_server_sidecar(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = app_handle
                .state::<ServerProcess>()
                .0
                .lock()
                .expect("server process lock poisoned")
                .take()
            {
                let _ = child.kill();
            }
        }
    });
}

fn start_server_sidecar(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let shell = app.shell();

    let runtime_dir = prepare_server_runtime(app)?;
    let server_entry = runtime_dir.join("dist/index.js");
    let server_port = find_available_port()?;
    app.state::<ServerPort>()
        .0
        .store(server_port, Ordering::SeqCst);

    match shell.sidecar("pi-node") {
        Ok(cmd) => {
            log::info!("Starting server with bundled Node.js runtime");
            let (mut events, child) = cmd
                .arg(server_entry.to_string_lossy().to_string())
                .env(
                    "PI_BUNDLED_RUNTIME_DIR",
                    runtime_dir.to_string_lossy().to_string(),
                )
                .env("HOST", "127.0.0.1")
                .env("PORT", server_port.to_string())
                .spawn()
                .map_err(|e| format!("Failed to start server sidecar: {e}"))?;
            log::info!("Server sidecar started with pid={}", child.pid());
            app.state::<ServerProcess>()
                .0
                .lock()
                .map_err(|_| "server process lock poisoned")?
                .replace(child);

            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[server] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Stderr(line) => {
                            log::error!("[server] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Error(error) => {
                            log::error!("Server sidecar error: {error}");
                        }
                        CommandEvent::Terminated(payload) => {
                            log::error!(
                                "Server sidecar terminated: code={:?}, signal={:?}",
                                payload.code,
                                payload.signal
                            );
                            break;
                        }
                        _ => {
                            log::debug!("Received an unhandled server sidecar event");
                        }
                    }
                }
            });
        }
        Err(_) => {
            log::warn!(
                "Bundled Node.js sidecar not found. \
                 or run `pnpm prepare-sidecar` before `tauri build`."
            );
        }
    }

    Ok(())
}

fn find_available_port() -> io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

fn prepare_server_runtime(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;
    let archive_path = resource_dir.join("server-runtime.tar.gz");
    let expected_checksum = fs::read_to_string(resource_dir.join("server-runtime.sha256"))?
        .trim()
        .to_owned();
    let cache_dir = app.path().app_cache_dir()?;
    let runtime_dir = cache_dir.join("server-runtime");
    let marker_path = runtime_dir.join(".runtime-version");

    if fs::read_to_string(&marker_path)
        .map(|value| value.trim() == expected_checksum)
        .unwrap_or(false)
    {
        return Ok(runtime_dir);
    }

    fs::create_dir_all(&cache_dir)?;
    let staging_dir = cache_dir.join("server-runtime-staging");
    remove_dir_if_exists(&staging_dir)?;
    fs::create_dir_all(&staging_dir)?;

    let archive_file = File::open(archive_path)?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(&staging_dir)?;
    fs::write(staging_dir.join(".runtime-version"), &expected_checksum)?;

    remove_dir_if_exists(&runtime_dir)?;
    fs::rename(&staging_dir, &runtime_dir)?;
    Ok(runtime_dir)
}

fn remove_dir_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}
