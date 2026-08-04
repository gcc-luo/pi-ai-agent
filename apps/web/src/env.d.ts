/// <reference types="vite/client" />

// Tauri globals (available only when running in Tauri WebView)
interface Window {
  __TAURI_INTERNALS__?: unknown;
}
