import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { ArtifactItem, PluginStatus } from "@pi-web-ui/shared";
import {
  isComputerPlatformSupported,
  runComputerAction,
} from "./computer-driver.js";

export type ComputerAction =
  | "screenshot"
  | "list_windows"
  | "focus_window"
  | "click"
  | "double_click"
  | "type"
  | "key"
  | "scroll"
  | "drag"
  | "wait"
  | "get_cursor_position";

const INPUT_ACTIONS = new Set<ComputerAction>([
  "click", "double_click", "type", "key", "scroll", "drag",
]);

interface ComputerSessionState {
  sessionId: string;
  targetWindow: string | null;
  lastScreenshot: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  history: Array<{ action: ComputerAction; at: number; success: boolean }>;
  status: "enabled" | "starting" | "running" | "error";
  error: string | null;
}

export interface ComputerActionInput {
  sessionId: string;
  workdir: string;
  action: ComputerAction;
  args?: Record<string, unknown>;
  signal?: AbortSignal;
}

function safeFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 120);
  return cleaned || `desktop-${Date.now()}.png`;
}

function asFiniteNumber(value: unknown, name: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} 必须是有效数字`);
  }
  return value;
}

export function computerRisk(
  action: ComputerAction,
  args: Record<string, unknown>,
): { level: "normal" | "sensitive" | "destructive"; reason: string | null } {
  const intent = typeof args.intent === "string" ? args.intent.toLowerCase() : "";
  const key = typeof args.key === "string" ? args.key.toLowerCase() : "";
  const destructive = /\b(delete|remove|erase|destroy|shutdown|format|overwrite)\b|删除|移除|清空|关机|覆盖|格式化/;
  const sensitive = /\b(send|submit|publish|pay|purchase|transfer|upload|password|permission|save)\b|发送|提交|发布|支付|购买|转账|上传|密码|权限|保存/;
  if (destructive.test(intent) || /alt\+f4|shift\+delete/.test(key)) {
    return { level: "destructive", reason: "该桌面操作可能删除、覆盖或关闭重要内容" };
  }
  if (sensitive.test(intent)) {
    return { level: "sensitive", reason: "该桌面操作可能提交、发送或处理敏感内容" };
  }
  if (action === "key" && /delete|enter/.test(key)) {
    return { level: "sensitive", reason: "该按键可能触发提交或删除" };
  }
  if (INPUT_ACTIONS.has(action) && !intent) {
    return { level: "sensitive", reason: "该桌面输入缺少可审计的操作意图" };
  }
  return { level: "normal", reason: null };
}

export class ComputerSessionManager {
  private readonly sessions = new Map<string, ComputerSessionState>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly sessionGenerations = new Map<string, number>();
  private generation = 0;

  constructor(private readonly log: FastifyBaseLogger) {}

  available(): { available: boolean; error: string | null } {
    return isComputerPlatformSupported()
      ? { available: true, error: null }
      : { available: false, error: `Computer Use 不支持当前平台：${process.platform}` };
  }

  runtimeStatus(): { status: PluginStatus; error: string | null } {
    const availability = this.available();
    if (!availability.available) return { status: "unavailable", error: availability.error };
    const states = [...this.sessions.values()];
    if (states.some((state) => state.status === "starting")) return { status: "starting", error: null };
    if (states.some((state) => state.status === "running")) return { status: "running", error: null };
    const failed = states.find((state) => state.status === "error");
    return failed
      ? { status: "error", error: failed.error }
      : { status: "enabled", error: null };
  }

  sessionStatus(sessionId: string): ComputerSessionState | null {
    return this.sessions.get(sessionId) ?? null;
  }

  async execute(input: ComputerActionInput): Promise<Record<string, unknown>> {
    const generation = this.generation;
    const sessionGeneration = this.sessionGenerations.get(input.sessionId) ?? 0;
    const current = this.queue.catch(() => undefined).then(() => {
      if (
        generation !== this.generation
        || sessionGeneration !== (this.sessionGenerations.get(input.sessionId) ?? 0)
      ) {
        throw new Error("Computer Use 会话已被释放");
      }
      if (input.signal?.aborted) throw new Error("Computer Use 操作已中断");
      const controller = new AbortController();
      const abort = () => controller.abort();
      input.signal?.addEventListener("abort", abort, { once: true });
      this.activeControllers.set(input.sessionId, controller);
      return this.executeUnlocked({ ...input, signal: controller.signal }).finally(() => {
        input.signal?.removeEventListener("abort", abort);
        if (this.activeControllers.get(input.sessionId) === controller) {
          this.activeControllers.delete(input.sessionId);
        }
      });
    });
    this.queue = current;
    return current;
  }

  closeSession(sessionId: string): void {
    this.sessionGenerations.set(
      sessionId,
      (this.sessionGenerations.get(sessionId) ?? 0) + 1,
    );
    this.activeControllers.get(sessionId)?.abort();
    this.sessions.delete(sessionId);
  }

  async shutdown(): Promise<void> {
    this.generation++;
    for (const controller of this.activeControllers.values()) controller.abort();
    this.activeControllers.clear();
    this.sessions.clear();
    await this.queue.catch(() => undefined);
  }

  private async executeUnlocked(input: ComputerActionInput): Promise<Record<string, unknown>> {
    const availability = this.available();
    if (!availability.available) throw new Error(availability.error!);
    const state = this.sessions.get(input.sessionId) ?? {
      sessionId: input.sessionId,
      targetWindow: null,
      lastScreenshot: null,
      screenWidth: null,
      screenHeight: null,
      history: [],
      status: "enabled" as const,
      error: null,
    };
    this.sessions.set(input.sessionId, state);
    state.status = "starting";
    state.error = null;
    const args = { ...(input.args ?? {}) };
    try {
      if (input.signal?.aborted) throw new Error("Computer Use 操作已中断");
      let result: Record<string, unknown>;
      if (input.action === "wait") {
        const timeoutMs = Math.max(0, Math.min(
          asFiniteNumber(args.timeoutMs, "timeoutMs", 1_000),
          30_000,
        ));
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, timeoutMs);
          input.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("Computer Use 操作已中断"));
          }, { once: true });
        });
        result = { ok: true, waitedMs: timeoutMs };
      } else {
        if (input.action === "screenshot") {
          const directory = path.resolve(input.workdir, "computer", "screenshots");
          const root = path.resolve(input.workdir);
          const relative = path.relative(root, directory);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error("Computer Use 产物目录超出工作空间");
          }
          await fs.mkdir(directory, { recursive: true });
          const requested = typeof args.name === "string" && args.name.trim()
            ? args.name.trim()
            : `desktop-${Date.now()}.png`;
          const filename = safeFileName(requested.toLowerCase().endsWith(".png") ? requested : `${requested}.png`);
          args.path = path.join(directory, filename);
        }
        if (input.action === "drag") {
          args.durationMs = Math.max(50, Math.min(
            asFiniteNumber(args.durationMs, "durationMs", 500),
            5_000,
          ));
        }
        if (input.action === "scroll") {
          args.delta = asFiniteNumber(args.delta, "delta", -360);
        }
        if (INPUT_ACTIONS.has(input.action)) {
          if (!state.targetWindow) {
            throw new Error("执行桌面输入前必须先调用 computer_focus_window 绑定目标窗口");
          }
          args.expectedWindowId = state.targetWindow;
        }
        result = await runComputerAction(input.action, args, input.signal);
      }

      if (input.action === "focus_window") {
        const focusedWindowId = result.windowId;
        if (typeof focusedWindowId !== "string" || !focusedWindowId) {
          throw new Error("Computer Use 未返回可绑定的活动窗口 ID");
        }
        state.targetWindow = focusedWindowId;
      }
      const screen = result.screen as { width?: unknown; height?: unknown } | undefined;
      if (typeof screen?.width === "number") state.screenWidth = screen.width;
      if (typeof screen?.height === "number") state.screenHeight = screen.height;
      if (input.action === "screenshot" && typeof result.path === "string") {
        state.lastScreenshot = result.path;
        const artifact: ArtifactItem & { absolutePath: string } = {
          path: path.relative(input.workdir, result.path).replaceAll("\\", "/"),
          name: path.basename(result.path),
          mimeType: "image/png",
          absolutePath: result.path,
        };
        result = { ...result, artifact };
      }
      state.status = "running";
      state.history.push({ action: input.action, at: Date.now(), success: true });
      if (state.history.length > 100) state.history.shift();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.status = "error";
      state.error = message;
      state.history.push({ action: input.action, at: Date.now(), success: false });
      this.log.error({ sessionId: input.sessionId, action: input.action, err: message }, "computer action failed");
      throw error;
    }
  }
}
