#[cfg(not(target_os = "windows"))]
use flate2::read::GzDecoder;
use std::{
    fs, io,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU16, Ordering},
    sync::Mutex,
    time::Duration,
};
#[cfg(not(target_os = "windows"))]
use std::fs::File;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

#[derive(Default)]
struct ServerProcess(Mutex<Option<CommandChild>>);

#[derive(Default)]
struct ServerPort(AtomicU16);

#[derive(Default)]
struct ServerStartupError(Mutex<Option<String>>);

const EXTERNAL_SERVER_PORT_ENV: &str = "PI_DESKTOP_SERVER_PORT";

#[tauri::command]
fn get_server_port(
    port: tauri::State<'_, ServerPort>,
    startup_error: tauri::State<'_, ServerStartupError>,
) -> Result<u16, String> {
    wait_for_server_port(
        &port,
        &startup_error,
        350,
        Duration::from_millis(100),
    )
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerProcess::default())
        .manage(ServerPort::default())
        .manage(ServerStartupError::default())
        .invoke_handler(tauri::generate_handler![get_server_port])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let external_port = parse_external_server_port(
                std::env::var(EXTERNAL_SERVER_PORT_ENV).ok().as_deref(),
            )
            .map_err(io::Error::other)?;

            if let Some(port) = external_port {
                log::info!("Using external development server on port={port}");
                app_handle
                    .state::<ServerPort>()
                    .0
                    .store(port, Ordering::SeqCst);
                return Ok(());
            }

            tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = start_server_sidecar(&app_handle) {
                    let message = format!("Failed to start server sidecar: {error}");
                    log::error!("{message}");
                    if let Ok(mut startup_error) = app_handle
                        .state::<ServerStartupError>()
                        .0
                        .lock()
                    {
                        *startup_error = Some(message);
                    }
                }
            });
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

fn parse_external_server_port(value: Option<&str>) -> Result<Option<u16>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let port = value
        .parse::<u16>()
        .map_err(|_| format!("{EXTERNAL_SERVER_PORT_ENV} must be a port from 1 to 65535"))?;
    if port == 0 {
        return Err(format!(
            "{EXTERNAL_SERVER_PORT_ENV} must be a port from 1 to 65535"
        ));
    }
    Ok(Some(port))
}

fn start_server_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
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

fn prepare_server_runtime(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
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

    // Use system tar on Windows to avoid long-path issues with the Rust tar crate.
    // The Rust tar crate silently skips files whose paths exceed the 260-char
    // MAX_PATH limit, which causes the dist/ directory to be incomplete.
    extract_archive(&archive_path, &staging_dir)?;
    fs::write(staging_dir.join(".runtime-version"), &expected_checksum)?;

    remove_dir_if_exists(&runtime_dir)?;
    fs::rename(&staging_dir, &runtime_dir)?;
    Ok(runtime_dir)
}

#[cfg(target_os = "windows")]
fn windows_tar_creation_flags() -> u32 {
    0x0800_0000 // CREATE_NO_WINDOW
}

fn wait_for_server_port(
    port: &ServerPort,
    startup_error: &ServerStartupError,
    attempts: usize,
    retry_delay: Duration,
) -> Result<u16, String> {
    for _ in 0..attempts {
        match port.0.load(Ordering::SeqCst) {
            0 => {}
            value => return Ok(value),
        }
        if let Some(error) = startup_error
            .0
            .lock()
            .map_err(|_| "server startup state lock poisoned".to_owned())?
            .clone()
        {
            return Err(error);
        }
        std::thread::sleep(retry_delay);
    }

    Err("server startup timed out".to_owned())
}

#[cfg(target_os = "windows")]
fn extract_archive(
    archive_path: &Path,
    dest_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    let mut command = Command::new("tar.exe");
    command
        .creation_flags(windows_tar_creation_flags())
        .args([
            "-xzf",
            &archive_path.to_string_lossy(),
            "-C",
            &dest_dir.to_string_lossy(),
        ]);
    let status = command.status()?;
    if !status.success() {
        return Err(format!("tar.exe exited with status {}", status).into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn extract_archive(
    archive_path: &Path,
    dest_dir: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let archive_file = File::open(archive_path)?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest_dir)?;
    Ok(())
}

fn remove_dir_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_external_server_port, wait_for_server_port, ServerPort, ServerStartupError};
    use std::sync::atomic::Ordering;
    use std::time::Duration;

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_tar_command_hides_its_console_window() {
        assert_eq!(super::windows_tar_creation_flags(), 0x0800_0000);
    }

    #[test]
    fn waits_for_the_background_server_to_publish_its_port() {
        let port = ServerPort::default();
        let startup_error = ServerStartupError::default();

        std::thread::scope(|scope| {
            scope.spawn(|| {
                std::thread::sleep(Duration::from_millis(5));
                port.0.store(43123, Ordering::SeqCst);
            });

            assert_eq!(
                wait_for_server_port(&port, &startup_error, 10, Duration::from_millis(5)),
                Ok(43123),
            );
        });
    }

    #[test]
    fn uses_the_external_server_port_configured_for_desktop_development() {
        assert_eq!(parse_external_server_port(Some("8080")), Ok(Some(8080)));
        assert_eq!(parse_external_server_port(None), Ok(None));
    }

    #[test]
    fn rejects_an_invalid_external_server_port() {
        assert!(parse_external_server_port(Some("0")).is_err());
        assert!(parse_external_server_port(Some("not-a-port")).is_err());
    }
}
