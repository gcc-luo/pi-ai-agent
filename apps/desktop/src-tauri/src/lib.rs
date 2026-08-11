#[cfg(not(target_os = "windows"))]
use flate2::read::GzDecoder;
#[cfg(not(target_os = "windows"))]
use std::fs::File;
#[cfg(target_os = "windows")]
use std::{ffi::OsString, os::windows::process::CommandExt, process::Command};
use std::{
    fs, io,
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU16, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
        Mutex,
    },
    time::Duration,
};
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct ManagedServerProcess {
    child: CommandChild,
    terminated: Receiver<()>,
}

#[derive(Default)]
struct ServerProcess(Mutex<Option<ManagedServerProcess>>);

#[derive(Default)]
struct ServerPort(AtomicU16);

#[derive(Default)]
struct ServerStartupError(Mutex<Option<String>>);

const EXTERNAL_SERVER_PORT_ENV: &str = "PI_DESKTOP_SERVER_PORT";
const SIDECAR_STOP_TIMEOUT: Duration = Duration::from_secs(10);

trait StoppableProcess {
    fn stop(self, timeout: Duration) -> Result<(), String>;
}

impl StoppableProcess for ManagedServerProcess {
    fn stop(self, timeout: Duration) -> Result<(), String> {
        let pid = self.child.pid();
        let kill_error = self.child.kill().err().map(|error| error.to_string());

        match self.terminated.recv_timeout(timeout) {
            Ok(()) => Ok(()),
            Err(RecvTimeoutError::Timeout) => Err(kill_error.map_or_else(
                || format!("timed out waiting for server sidecar pid={pid} to exit"),
                |error| format!("failed to stop server sidecar pid={pid}: {error}"),
            )),
            Err(RecvTimeoutError::Disconnected) => Err(kill_error.map_or_else(
                || format!("lost server sidecar pid={pid} termination signal"),
                |error| format!("failed to stop server sidecar pid={pid}: {error}"),
            )),
        }
    }
}

fn stop_server_process<P: StoppableProcess>(
    process: &Mutex<Option<P>>,
    timeout: Duration,
) -> Result<(), String> {
    let process = process
        .lock()
        .map_err(|_| "server process lock poisoned".to_owned())?
        .take();

    match process {
        Some(process) => process.stop(timeout),
        None => Ok(()),
    }
}

#[tauri::command]
fn get_server_port(
    port: tauri::State<'_, ServerPort>,
    startup_error: tauri::State<'_, ServerStartupError>,
) -> Result<u16, String> {
    wait_for_server_port(&port, &startup_error, 350, Duration::from_millis(100))
}

#[tauri::command]
async fn prepare_for_update(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        let process = app.state::<ServerProcess>();
        stop_server_process(&process.0, SIDECAR_STOP_TIMEOUT)
    })
    .await
    .map_err(|error| format!("failed to join sidecar cleanup task: {error}"))?
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
        .invoke_handler(tauri::generate_handler![
            get_server_port,
            prepare_for_update
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let external_port =
                parse_external_server_port(std::env::var(EXTERNAL_SERVER_PORT_ENV).ok().as_deref())
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
                    if let Ok(mut startup_error) = app_handle.state::<ServerStartupError>().0.lock()
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
            if let Err(error) =
                stop_server_process(&app_handle.state::<ServerProcess>().0, SIDECAR_STOP_TIMEOUT)
            {
                log::warn!("Failed to stop server sidecar during exit: {error}");
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
    #[cfg(target_os = "windows")]
    let bundled_shell_bin_dir = optional_bundled_shell_path(prepare_bundled_shell_runtime(app));
    let server_entry = runtime_dir.join("dist/index.js");
    let server_port = find_available_port()?;
    app.state::<ServerPort>()
        .0
        .store(server_port, Ordering::SeqCst);

    match shell.sidecar("pi-node") {
        Ok(cmd) => {
            log::info!("Starting server with bundled Node.js runtime");
            let command = cmd
                .arg(server_entry.to_string_lossy().to_string())
                .env(
                    "PI_BUNDLED_RUNTIME_DIR",
                    runtime_dir.to_string_lossy().to_string(),
                )
                .env("HOST", "127.0.0.1")
                .env("PORT", server_port.to_string());
            #[cfg(target_os = "windows")]
            let command = if let Some(bundled_shell_bin_dir) = bundled_shell_bin_dir {
                command.env("PATH", prepend_windows_path(&bundled_shell_bin_dir)?)
            } else {
                command
            };
            let (mut events, child) = command
                .spawn()
                .map_err(|e| format!("Failed to start server sidecar: {e}"))?;
            log::info!("Server sidecar started with pid={}", child.pid());
            let (termination_sender, termination_receiver) = mpsc::channel();
            app.state::<ServerProcess>()
                .0
                .lock()
                .map_err(|_| "server process lock poisoned")?
                .replace(ManagedServerProcess {
                    child,
                    terminated: termination_receiver,
                });

            std::thread::spawn(move || {
                tauri::async_runtime::block_on(async move {
                    while let Some(event) = events.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                log::info!(
                                    "[server] {}",
                                    String::from_utf8_lossy(&line).trim_end()
                                );
                            }
                            CommandEvent::Stderr(line) => {
                                log::error!(
                                    "[server] {}",
                                    String::from_utf8_lossy(&line).trim_end()
                                );
                            }
                            CommandEvent::Error(error) => {
                                log::error!("Server sidecar error: {error}");
                            }
                            CommandEvent::Terminated(payload) => {
                                log::info!(
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
                    let _ = termination_sender.send(());
                });
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
fn prepare_bundled_shell_runtime(
    app: &tauri::AppHandle,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;
    let archive_path = resource_dir.join("portable-git.exe");
    let expected_checksum = fs::read_to_string(resource_dir.join("portable-git.sha256"))?
        .trim()
        .to_owned();
    let cache_dir = app.path().app_cache_dir()?;
    let runtime_dir = cache_dir.join("bundled-shell");
    let bash_path = runtime_dir.join("bin").join("bash.exe");
    let marker_path = runtime_dir.join(".runtime-version");

    if fs::read_to_string(&marker_path)
        .map(|value| value.trim() == expected_checksum)
        .unwrap_or(false)
        && bash_path.is_file()
    {
        return Ok(runtime_dir.join("bin"));
    }

    fs::create_dir_all(&cache_dir)?;
    let staging_dir = cache_dir.join("bundled-shell-staging");
    remove_dir_if_exists(&staging_dir)?;
    fs::create_dir_all(&staging_dir)?;

    let output_argument = format!("-o{}", staging_dir.to_string_lossy());
    let status = Command::new(&archive_path)
        .creation_flags(windows_tar_creation_flags())
        .args(["-y", output_argument.as_str()])
        .status()?;
    if !status.success() {
        return Err(format!("PortableGit extraction failed with status {status}").into());
    }
    if !staging_dir.join("bin").join("bash.exe").is_file() {
        return Err("PortableGit extraction did not provide bin\\bash.exe".into());
    }
    fs::write(staging_dir.join(".runtime-version"), expected_checksum)?;

    remove_dir_if_exists(&runtime_dir)?;
    fs::rename(&staging_dir, &runtime_dir)?;
    Ok(runtime_dir.join("bin"))
}

#[cfg(target_os = "windows")]
fn optional_bundled_shell_path(
    result: Result<PathBuf, Box<dyn std::error::Error>>,
) -> Option<PathBuf> {
    match result {
        Ok(path) => Some(path),
        Err(error) => {
            log::error!(
                "Bundled Shell runtime is unavailable; starting the server with the system PATH: {error}"
            );
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn prepend_windows_path(directory: &Path) -> io::Result<OsString> {
    let mut entries = vec![directory.to_path_buf()];
    if let Some(current_path) = std::env::var_os("PATH") {
        entries.extend(std::env::split_paths(&current_path));
    }
    std::env::join_paths(entries).map_err(io::Error::other)
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
fn extract_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let mut command = Command::new("tar.exe");
    command.creation_flags(windows_tar_creation_flags()).args([
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
fn extract_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
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
    use super::{
        parse_external_server_port, stop_server_process, wait_for_server_port, ServerPort,
        ServerStartupError, StoppableProcess,
    };
    use std::sync::atomic::Ordering;
    use std::sync::Mutex;
    use std::time::Duration;

    struct FakeProcess(Result<(), String>);

    impl StoppableProcess for FakeProcess {
        fn stop(self, _timeout: Duration) -> Result<(), String> {
            self.0
        }
    }

    #[test]
    fn stopping_a_missing_or_already_stopped_sidecar_is_idempotent() {
        let process = Mutex::<Option<FakeProcess>>::new(None);

        assert_eq!(
            stop_server_process(&process, Duration::from_millis(1)),
            Ok(())
        );
        assert_eq!(
            stop_server_process(&process, Duration::from_millis(1)),
            Ok(())
        );
    }

    #[test]
    fn sidecar_stop_failures_prevent_update_preparation() {
        let process = Mutex::new(Some(FakeProcess(Err("sidecar did not exit".into()))));

        assert_eq!(
            stop_server_process(&process, Duration::from_millis(1)),
            Err("sidecar did not exit".into())
        );
        assert!(process.lock().expect("process lock poisoned").is_none());
    }

    #[test]
    fn sidecar_is_removed_from_state_after_a_successful_stop() {
        let process = Mutex::new(Some(FakeProcess(Ok(()))));

        assert_eq!(
            stop_server_process(&process, Duration::from_millis(1)),
            Ok(())
        );
        assert!(process.lock().expect("process lock poisoned").is_none());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_tar_command_hides_its_console_window() {
        assert_eq!(super::windows_tar_creation_flags(), 0x0800_0000);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn bundled_shell_path_precedes_the_user_path() {
        let shell_dir = std::path::Path::new(r"C:\\PI-AI-Agent\\bundled-shell\\bin");
        let path = super::prepend_windows_path(shell_dir).expect("PATH should be joinable");
        let first = std::env::split_paths(&path)
            .next()
            .expect("PATH should contain the bundled shell");

        assert_eq!(first, shell_dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn bundled_shell_preparation_failure_degrades_to_the_original_path() {
        let result = Err::<std::path::PathBuf, _>("empty PortableGit archive".into());

        assert!(super::optional_bundled_shell_path(result).is_none());
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
