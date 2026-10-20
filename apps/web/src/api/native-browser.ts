import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../utils/platform.js";
import { authToken, webSocketUrl } from "./endpoints.js";

export interface NativeBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createNativeBrowserSocket(sessionId: string, instanceId: string): WebSocket {
  const token = authToken();
  const protocols = token ? ["pi-web-ui", token] : ["pi-web-ui"];
  return new WebSocket(
    webSocketUrl(`/ws/native-browser/${encodeURIComponent(sessionId)}?instanceId=${encodeURIComponent(instanceId)}`),
    protocols,
  );
}

export async function openNativeBrowserView(
  sessionId: string,
  instanceId: string,
  url: string,
  bounds: NativeBrowserBounds,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("native_browser_open", { sessionId, instanceId, url, bounds });
}

export async function setNativeBrowserBounds(
  sessionId: string,
  instanceId: string,
  bounds: NativeBrowserBounds,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("native_browser_set_bounds", { sessionId, instanceId, bounds });
}

export async function setNativeBrowserVisible(
  sessionId: string,
  instanceId: string,
  visible: boolean,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("native_browser_set_visible", { sessionId, instanceId, visible });
}

export async function navigateNativeBrowser(
  sessionId: string,
  instanceId: string,
  url: string,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("native_browser_navigate", { sessionId, instanceId, url });
}

export async function runNativeBrowserScript<T = unknown>(
  sessionId: string,
  instanceId: string,
  script: string,
): Promise<T> {
  if (!isTauri()) throw new Error("原生浏览器视图仅在桌面端可用");
  const encoded = await invoke<string>("native_browser_eval", {
    sessionId,
    instanceId,
    script,
  });
  try {
    return JSON.parse(encoded) as T;
  } catch {
    return encoded as T;
  }
}

export async function reloadNativeBrowser(
  sessionId: string,
  instanceId: string,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("native_browser_reload", { sessionId, instanceId });
}

export async function closeNativeBrowserView(
  sessionId: string,
  instanceId: string,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("native_browser_close", { sessionId, instanceId });
}

export async function openNativeWorkspaceToolMenu(
  sessionId: string,
  bounds: NativeBrowserBounds,
  html: string,
): Promise<void> {
  if (!isTauri()) return;
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  await invoke("native_workspace_tool_menu_open", { sessionId, bounds, dataUrl });
}

export async function closeNativeWorkspaceToolMenu(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("native_workspace_tool_menu_close", { sessionId });
}
