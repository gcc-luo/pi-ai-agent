import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import type { FastifyBaseLogger } from "fastify";
import type { BrowserCapabilityDto, PluginStatus } from "@pi-web-ui/shared";
import {
  browserBinary,
  browserEnvironment,
  browserIdentity,
} from "./browser-runtime.js";

const run = promisify(execFile);
type Report = { isError?: boolean; details?: Record<string, unknown> };
type CommandOptions = {
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
};
type CommandRunner = (
  file: string,
  args: string[],
  options: CommandOptions,
) => Promise<{ stdout: string; stderr: string }>;

const defaultCommandRunner: CommandRunner = async (file, args, options) => {
  const result = await run(file, args, options);
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

const MAX_STREAM_PORT = 65_535;

export interface BrowserSessionCloseOptions {
  retainTombstone?: boolean;
}

function parseJsonOutput(output: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error(`无法解析 agent-browser ${label} 响应`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`agent-browser ${label} 响应格式无效`);
  }
  const root = value as Record<string, unknown>;
  if (root.ok === false) {
    throw new Error(typeof root.error === "string" ? root.error : `agent-browser ${label} 失败`);
  }
  return root;
}

function findTabs(value: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(value.tabs)) return value.tabs;
  const data = value.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nestedTabs = (data as Record<string, unknown>).tabs;
    if (Array.isArray(nestedTabs)) return nestedTabs;
  }
  return null;
}

function isBrowserNotRunning(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no (?:active )?(?:browser|tab|page)|browser.*(?:not running|not open|not found)|daemon.*not running|ECONNREFUSED|connection refused/i.test(message);
}

function streamStatus(value: Record<string, unknown>): { enabled: boolean; port: number | null } {
  const data = value.data && typeof value.data === "object" && !Array.isArray(value.data)
    ? value.data as Record<string, unknown>
    : value;
  const enabled = data.enabled === true || data.status === "running";
  const port = typeof data.port === "number" && Number.isInteger(data.port)
    && data.port > 0 && data.port <= MAX_STREAM_PORT
    ? data.port
    : null;
  return { enabled, port };
}

/** Product state only. Page observation and interaction belongs to the Pi extension. */
export class BrowserSessionManager {
  private readonly pending = new Map<
    string,
    Map<string, { risk: "normal" | "sensitive"; browser: boolean }>
  >();
  private readonly states = new Map<string, BrowserCapabilityDto>();
  private readonly panelSessions = new Set<string>();
  private readonly panelBrowserSessions = new Set<string>();
  private readonly panelPorts = new Map<string, number>();
  private readonly panelStarting = new Map<string, Promise<number>>();
  private readonly sessionOperations = new Map<string, Promise<void>>();
  private readonly closingSessions = new Set<string>();
  private readonly terminalSessions = new Set<string>();
  private shuttingDown = false;
  private closeAllDepth = 0;
  private readonly runCommand: CommandRunner;
  constructor(
    private readonly options: {
      logger: FastifyBaseLogger;
      sessionRoot: string;
      runCommand?: CommandRunner;
    },
  ) {
    this.runCommand = options.runCommand ?? defaultCommandRunner;
  }

  /** Start the stream for the same agent-browser session without changing Agent permissions. */
  async ensurePanelSession(sessionId: string): Promise<number> {
    return this.withSessionLock(sessionId, () => this.ensurePanelSessionLocked(sessionId));
  }

  getPanelStreamPort(sessionId: string): number | null {
    return this.panelPorts.get(sessionId) ?? null;
  }

  async navigate(sessionId: string, url: string): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
      await this.ensurePanelSessionLocked(sessionId);
      await this.runForSession(sessionId, ["open", url]);
    });
  }

  async back(sessionId: string): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
      await this.ensurePanelSessionLocked(sessionId);
      await this.runForSession(sessionId, ["back"]);
    });
  }

  async forward(sessionId: string): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
      await this.ensurePanelSessionLocked(sessionId);
      await this.runForSession(sessionId, ["forward"]);
    });
  }

  async reload(sessionId: string): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
      await this.ensurePanelSessionLocked(sessionId);
      await this.runForSession(sessionId, ["reload"]);
    });
  }

  async closePanelSession(sessionId: string): Promise<void> {
    await this.withSessionLock(sessionId, () => this.stopPanelSession(sessionId));
  }

  private async stopPanelSession(sessionId: string): Promise<void> {
    if (!this.panelSessions.has(sessionId)) return;
    await this.runForSession(sessionId, ["stream", "disable"]);
    this.panelSessions.delete(sessionId);
    this.panelPorts.delete(sessionId);
  }

  status(sessionId: string, enabled: boolean): BrowserCapabilityDto {
    if (!enabled)
      return {
        enabled,
        status: "disabled",
        pageCount: 0,
        currentUrl: null,
        error: null,
      };
    return (
      this.states.get(sessionId) ?? {
        enabled,
        status: "closed",
        pageCount: 0,
        currentUrl: null,
        error: null,
      }
    );
  }

  runtimeStatus(): { status: PluginStatus; error: string | null } {
    if (!fs.existsSync(browserBinary()))
      return {
        status: "unavailable",
        error: "agent-browser 可执行文件缺失，请重新安装依赖。",
      };
    const states = [...this.states.values()];
    const error = states.find((state) => state.error)?.error ?? null;
    return {
      status: states.some((state) => state.status === "running")
        ? "running"
        : states.some((state) => state.status === "starting")
          ? "starting"
          : error
            ? "error"
            : "enabled",
      error,
    };
  }

  begin(
    sessionId: string,
    toolCallId: string,
    risk: "normal" | "sensitive",
    browser = true,
  ): void {
    const calls = this.pending.get(sessionId) ?? new Map();
    calls.set(toolCallId, { risk, browser });
    this.pending.set(sessionId, calls);
    if (browser)
      this.states.set(sessionId, {
        ...this.status(sessionId, true),
        status: "starting",
        error: null,
      });
  }

  report(
    sessionId: string,
    toolCallId: string,
    result: Report,
  ): "normal" | "sensitive" | undefined {
    const calls = this.pending.get(sessionId);
    const call = calls?.get(toolCallId);
    if (!call) return undefined;
    calls!.delete(toolCallId);
    if (!call.browser) return call.risk;
    const details = result.details ?? {};
    const data =
      details.data && typeof details.data === "object"
        ? (details.data as Record<string, unknown>)
        : {};
    const previous = this.status(sessionId, true);
    const closed = data.closed === true || data.status === "closed";
    const error = result.isError
      ? typeof details.error === "string"
        ? details.error
        : "浏览器操作失败，请查看工具结果。"
      : null;
    this.states.set(sessionId, {
      enabled: true,
      status: error ? "error" : closed ? "closed" : "running",
      currentUrl: closed
        ? null
        : typeof data.url === "string"
          ? data.url
          : previous.currentUrl,
      pageCount: closed
        ? 0
        : Array.isArray(data.tabs)
          ? data.tabs.length
          : typeof data.url === "string"
            ? Math.max(1, previous.pageCount)
            : previous.pageCount,
      error,
    });
    return call.risk;
  }

  async close(sessionId: string): Promise<void> {
    // Close only this host's default daemon, never a user-owned session or namespace.
    return this.closeSession(sessionId);
  }

  async closeSession(sessionId: string, options: BrowserSessionCloseOptions = {}): Promise<void> {
    this.closingSessions.add(sessionId);
    if (options.retainTombstone) this.terminalSessions.add(sessionId);
    this.pending.delete(sessionId);
    await this.withSessionLock(sessionId, async () => {
      try {
        await this.closeSessionResourcesLocked(sessionId);
      } finally {
        if (!this.terminalSessions.has(sessionId)) this.closingSessions.delete(sessionId);
      }
    });
  }

  /** Permanently forget a purged session after all queued browser operations finish. */
  async forgetSession(sessionId: string): Promise<void> {
    this.closingSessions.add(sessionId);
    // The database row is already gone, so this session must not be reused even
    // if closing its browser daemon fails and cleanup has to be retried later.
    this.terminalSessions.add(sessionId);
    this.pending.delete(sessionId);
    await this.withSessionLock(sessionId, async () => {
      await this.closeSessionResourcesLocked(sessionId);
      this.pending.delete(sessionId);
      this.states.delete(sessionId);
      this.panelSessions.delete(sessionId);
      this.panelBrowserSessions.delete(sessionId);
      this.panelPorts.delete(sessionId);
      this.panelStarting.delete(sessionId);
      this.terminalSessions.delete(sessionId);
      this.closingSessions.delete(sessionId);
    });
  }

  async resumeSession(sessionId: string): Promise<void> {
    if (this.shuttingDown) throw new Error("browser manager is shutting down");
    await this.withSessionLock(sessionId, async () => {
      if (this.shuttingDown) throw new Error("browser manager is shutting down");
      this.terminalSessions.delete(sessionId);
      this.closingSessions.delete(sessionId);
    });
  }

  /** Close current browser resources without preventing future panel sessions. */
  async closeAll(): Promise<void> {
    this.closeAllDepth += 1;
    try {
      await Promise.allSettled(
        [...new Set([
          ...this.states.keys(),
          ...this.panelSessions,
          ...this.panelBrowserSessions,
          ...this.panelStarting.keys(),
          ...this.sessionOperations.keys(),
        ])].map((id) => this.close(id)),
      );
    } finally {
      this.closeAllDepth -= 1;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.closeAll();
  }

  private async startPanelSession(sessionId: string): Promise<number> {
    const prefix = this.commandPrefix(sessionId);
    try {
      const { stdout } = await this.runCommand(
        browserBinary(),
        [...prefix, "tab", "list", "--json"],
        this.commandOptions(sessionId),
      );
      const tabs = findTabs(parseJsonOutput(stdout, "tab list"));
      if (!tabs) throw new Error("agent-browser tab list 响应中缺少 tabs");
      if (tabs.length === 0) {
        // The open command can time out after the daemon has already started.
        this.panelBrowserSessions.add(sessionId);
        await this.runForSession(sessionId, ["open", "about:blank"]);
      }
    } catch (error) {
      if (!isBrowserNotRunning(error)) throw error;
      // Track before opening because a failed response does not prove that the
      // browser daemon failed to start.
      this.panelBrowserSessions.add(sessionId);
      await this.runForSession(sessionId, ["open", "about:blank"]);
    }
    // Mark the daemon as a panel resource before enabling the stream so later
    // session cleanup still releases it if stream startup fails midway.
    this.panelSessions.add(sessionId);
    this.panelBrowserSessions.add(sessionId);

    let status = streamStatus(parseJsonOutput(
      (await this.runCommand(browserBinary(), [...prefix, "stream", "status", "--json"], this.commandOptions(sessionId))).stdout,
      "stream status",
    ));
    if (!status.enabled || status.port === null) {
      await this.runForSession(sessionId, ["stream", "enable"]);
      status = streamStatus(parseJsonOutput(
        (await this.runCommand(browserBinary(), [...prefix, "stream", "status", "--json"], this.commandOptions(sessionId))).stdout,
        "stream status",
      ));
    }
    if (!status.enabled || status.port === null) throw new Error("agent-browser stream 未返回有效的本机端口");
    this.panelPorts.set(sessionId, status.port);
    return status.port;
  }

  private async ensurePanelSessionLocked(sessionId: string): Promise<number> {
    if (
      this.shuttingDown
      || this.closeAllDepth > 0
      || this.closingSessions.has(sessionId)
      || this.terminalSessions.has(sessionId)
    ) {
      throw new Error("browser session is closing");
    }
    const existingPort = this.panelPorts.get(sessionId);
    if (this.panelSessions.has(sessionId) && existingPort !== undefined) return existingPort;

    const starting = this.startPanelSession(sessionId);
    this.panelStarting.set(sessionId, starting);
    try {
      return await starting;
    } finally {
      if (this.panelStarting.get(sessionId) === starting) this.panelStarting.delete(sessionId);
    }
  }

  private async closeSessionResourcesLocked(sessionId: string): Promise<void> {
    const shouldCloseBrowser = this.states.has(sessionId)
      || this.panelSessions.has(sessionId)
      || this.panelBrowserSessions.has(sessionId);
    try {
      await this.stopPanelSession(sessionId);
    } catch (error) {
      // Closing the session daemon below also releases a stream that could not
      // be disabled on its own.
      this.options.logger.warn({ sessionId, err: error }, "browser panel stream cleanup failed");
    }
    if (!shouldCloseBrowser) return;
    try {
      await this.runForSession(sessionId, ["close"]);
      this.states.delete(sessionId);
      this.panelSessions.delete(sessionId);
      this.panelBrowserSessions.delete(sessionId);
      this.panelPorts.delete(sessionId);
    } catch (error) {
      this.options.logger.warn(
        { sessionId, err: error },
        "browser cleanup failed",
      );
      this.states.set(sessionId, {
        ...this.status(sessionId, true),
        status: "error",
        error: "浏览器清理失败，空闲超时将再次回收。",
      });
      throw error;
    }
  }

  private withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionOperations.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const queued = result.then(() => undefined, () => undefined);
    this.sessionOperations.set(sessionId, queued);
    void queued.then(() => {
      if (this.sessionOperations.get(sessionId) === queued) this.sessionOperations.delete(sessionId);
    });
    return result;
  }

  private commandPrefix(sessionId: string): string[] {
    const identity = browserIdentity(this.options.sessionRoot, sessionId);
    return ["--namespace", identity.namespace, "--session", identity.session];
  }

  private commandOptions(sessionId: string): CommandOptions {
    return {
      env: {
        ...process.env,
        ...browserEnvironment(this.options.sessionRoot, sessionId),
      },
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    };
  }

  private async runForSession(sessionId: string, args: string[]): Promise<string> {
    const { stdout } = await this.runCommand(
      browserBinary(),
      [...this.commandPrefix(sessionId), ...args],
      this.commandOptions(sessionId),
    );
    return stdout;
  }
}
