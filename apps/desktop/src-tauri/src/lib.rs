
use tauri_plugin_shell::ShellExt;

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
            cmd.spawn().map_err(|e| format!("Failed to start server sidecar: {e}"))?;
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
