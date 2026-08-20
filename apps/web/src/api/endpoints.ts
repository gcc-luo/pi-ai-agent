import { isTauri } from "../utils/platform.js";

let apiBase = "/api";
let webSocketBase: string | undefined;

export function authToken(): string | undefined {
  const token = import.meta.env.VITE_PI_WEB_UI_AUTH_TOKEN;
  return typeof token === "string" && token ? token : undefined;
}

export function authHeaders(): Record<string, string> {
  const token = authToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function initializeBackendEndpoint(): Promise<void> {
  if (!isTauri()) return;

  const { invoke } = await import("@tauri-apps/api/core");
  const port = await invoke<number>("get_server_port");
  const httpOrigin = `http://127.0.0.1:${port}`;
  apiBase = `${httpOrigin}/api`;
  webSocketBase = `ws://127.0.0.1:${port}`;

  await waitForBackend(`${httpOrigin}/healthz`);
}

export function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

export function webSocketUrl(path: string): string {
  let url: string;
  if (webSocketBase) url = `${webSocketBase}${path}`;
  else {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    url = `${protocol}://${location.host}${path}`;
  }
  return url;
}

async function waitForBackend(healthUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { cache: "no-store" });
      if (response.ok) {
        const body = (await response.json()) as { ok?: boolean };
        if (body.ok === true) return;
      }
      lastError = new Error(`health check failed: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`后端服务启动超时${detail}`);
}
