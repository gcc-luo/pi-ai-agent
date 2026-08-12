import type { PluginDto, PluginStatus } from "@pi-web-ui/shared";
import type { BrowserSessionManager } from "../browser/browser-session-manager.js";
import type { ComputerSessionManager } from "../computer/computer-session-manager.js";
import type { PluginRepository } from "../db/repositories/plugin.js";

export const BROWSER_PLUGIN_ID = "browser-use";
export const COMPUTER_PLUGIN_ID = "computer-use";

interface PluginManifest {
  id: string;
  name: string;
  icon: string;
  version: string;
  description: string;
  source: string;
  builtin: boolean;
  official: boolean;
  defaultEnabled: boolean;
  tools: string[];
  skills: string[];
  capabilities: string[];
  permissions: string[];
  supportedPlatforms: string[];
}

const MANIFESTS: PluginManifest[] = [
  {
    id: BROWSER_PLUGIN_ID,
    name: "Browser Use",
    icon: "🌐",
    version: "1.0.0",
    description: "通过 Playwright 操作网页、浏览器标签页与本地 Web 项目。",
    source: "Pi Web UI",
    builtin: true,
    official: true,
    defaultEnabled: true,
    tools: [
      "browser_open", "browser_navigate", "browser_snapshot", "browser_click",
      "browser_fill", "browser_upload", "browser_select", "browser_press", "browser_hover",
      "browser_scroll", "browser_wait", "browser_tabs", "browser_screenshot",
      "browser_console_errors", "browser_network_errors", "browser_close",
    ],
    skills: ["优先使用页面快照和语义定位；页面变化后重新获取快照。"],
    capabilities: ["网页导航", "语义交互", "标签页管理", "截图与下载", "页面诊断"],
    permissions: [
      "访问网页", "点击网页元素", "填写网页表单", "上传和下载文件",
      "生成截图", "读取控制台和网络错误",
    ],
    supportedPlatforms: ["win32", "darwin", "linux"],
  },
  {
    id: COMPUTER_PLUGIN_ID,
    name: "Computer Use",
    icon: "🖥️",
    version: "1.1.0",
    description: "通过窗口信息、桌面截图和坐标操作控制 macOS、Windows 与 Linux 本地应用。",
    source: "Pi Web UI",
    builtin: true,
    official: true,
    defaultEnabled: true,
    tools: [
      "computer_screenshot", "computer_list_windows", "computer_focus_window",
      "computer_click", "computer_double_click", "computer_type", "computer_key",
      "computer_scroll", "computer_drag", "computer_wait",
      "computer_get_cursor_position",
    ],
    skills: ["操作前先查看窗口或截图，关键操作后重新截图确认。"],
    capabilities: ["窗口管理", "桌面截图", "鼠标控制", "键盘控制"],
    permissions: [
      "查看屏幕", "控制鼠标", "控制键盘", "切换窗口",
      "操作本地应用", "生成截图",
    ],
    supportedPlatforms: ["win32", "darwin", "linux"],
  },
];

export class PluginManager {
  private readonly manifests = new Map(MANIFESTS.map((manifest) => [manifest.id, manifest]));

  constructor(
    private readonly repository: PluginRepository,
    private readonly browser: BrowserSessionManager,
    private readonly computer: ComputerSessionManager,
  ) {
    for (const manifest of MANIFESTS) {
      repository.ensure(manifest.id, manifest.defaultEnabled);
    }
  }

  list(): PluginDto[] {
    return MANIFESTS.map((manifest) => this.toDto(manifest));
  }

  find(pluginId: string): PluginDto | null {
    const manifest = this.manifests.get(pluginId);
    return manifest ? this.toDto(manifest) : null;
  }

  enabledAvailable(): PluginDto[] {
    return this.list().filter((plugin) => plugin.enabled && plugin.status !== "unavailable");
  }

  activeForSession(sessionId: string): string[] {
    const selected = this.repository.selectedForSession(sessionId);
    return selected.filter((pluginId) => {
      const plugin = this.find(pluginId);
      return plugin?.enabled && plugin.status !== "unavailable";
    });
  }

  setSessionPlugins(sessionId: string, pluginIds: string[]): string[] {
    const unique = [...new Set(pluginIds)];
    for (const pluginId of unique) {
      const plugin = this.find(pluginId);
      if (!plugin) throw new Error(`未知插件：${pluginId}`);
      if (!plugin.enabled) throw new Error(`插件未全局启用：${plugin.name}`);
      if (plugin.status === "unavailable") throw new Error(`插件当前不可用：${plugin.name}`);
    }
    this.repository.setSelectedForSession(sessionId, unique);
    return unique;
  }

  setEnabled(pluginId: string, enabled: boolean, settings?: Record<string, unknown>): PluginDto {
    const manifest = this.manifests.get(pluginId);
    if (!manifest) throw new Error("plugin not found");
    this.repository.update(pluginId, { enabled, settings, lastError: enabled ? undefined : null });
    return this.toDto(manifest);
  }

  sessionsSelecting(pluginId: string): string[] {
    return this.repository.sessionsSelecting(pluginId);
  }

  async closeSessionPlugin(sessionId: string, pluginId: string): Promise<void> {
    if (pluginId === BROWSER_PLUGIN_ID) await this.browser.close(sessionId);
    if (pluginId === COMPUTER_PLUGIN_ID) this.computer.closeSession(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    await Promise.allSettled([
      this.browser.close(sessionId),
      Promise.resolve(this.computer.closeSession(sessionId)),
    ]);
  }

  async disableRuntime(pluginId: string): Promise<void> {
    if (pluginId === BROWSER_PLUGIN_ID) await this.browser.shutdown();
    if (pluginId === COMPUTER_PLUGIN_ID) await this.computer.shutdown();
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([this.browser.shutdown(), this.computer.shutdown()]);
  }

  private toDto(manifest: PluginManifest): PluginDto {
    const setting = this.repository.find(manifest.id);
    if (!setting) throw new Error(`plugin settings missing: ${manifest.id}`);
    const runtime = this.runtimeStatus(manifest.id);
    const platformAvailable = manifest.supportedPlatforms.includes(process.platform);
    const enabled = setting.enabled;
    const status: PluginStatus = !enabled
      ? "disabled"
      : !platformAvailable
        ? "unavailable"
        : runtime.status === "enabled" && setting.lastError
          ? "error"
          : runtime.status;
    const platformError = platformAvailable
      ? null
      : `当前平台 ${process.platform} 不受支持`;
    return {
      ...manifest,
      enabled,
      status,
      settings: setting.settings,
      error: platformError ?? runtime.error ?? setting.lastError,
      updatedAt: setting.updatedAt,
    };
  }

  private runtimeStatus(pluginId: string): { status: PluginStatus; error: string | null } {
    if (pluginId === BROWSER_PLUGIN_ID) return this.browser.runtimeStatus();
    if (pluginId === COMPUTER_PLUGIN_ID) return this.computer.runtimeStatus();
    return { status: "unavailable", error: "插件运行时未注册" };
  }
}
