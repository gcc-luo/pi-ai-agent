import { isTauri } from "./utils/platform.js";

export async function createStartupErrorHtml(detail: string): Promise<string> {
  let version: string | null = null;

  if (isTauri()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      version = await getVersion();
    } catch {
      // The startup error page must still render if the version API is unavailable.
    }
  }

  const versionHtml = version
    ? `<p style="color:#aaa">主程序版本：${escapeHtml(version)}</p>`
    : "";

  return `
      <main style="display:grid;place-items:center;height:100vh;padding:24px;background:#202224;color:#f5f5f5;font-family:system-ui,sans-serif">
        <section style="max-width:680px;text-align:center">
          <h1 style="font-size:22px">后端服务无法启动</h1>
          <p style="color:#ff7b7b;line-height:1.6">${escapeHtml(detail)}</p>
          <p style="color:#aaa">请退出应用后重新打开；如果问题持续，请检查服务日志。</p>
          ${versionHtml}
        </section>
      </main>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}
