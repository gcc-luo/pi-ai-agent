
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[tauri::command]
fn get_server_port() -> u16 {
    8080
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_server_port])
        .setup(|app| {
            start_server_sidecar(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_server_sidecar(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let shell = app.shell();

    match shell.sidecar("pi-server") {
        Ok(cmd) => {
            log::info!("Starting sidecar server: pi-server");
            let (mut events, child) = cmd
                .spawn()
                .map_err(|e| format!("Failed to start server sidecar: {e}"))?;
            log::info!("Server sidecar started with pid={}", child.pid());

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
                "Server sidecar binary not found. \
                 Ensure the server is running on port 8080, \
                 or run `pnpm prepare-sidecar` before `tauri build`."
            );
        }
    }

    Ok(())
}
