const LOCAL_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "tauri.localhost"]);

/** Match the desktop sidecar CORS policy while leaving protocol handling to URL. */
export function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return LOCAL_ORIGIN_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}
