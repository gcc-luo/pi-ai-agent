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

/** Product state only. Page observation and interaction belongs to the Pi extension. */
export class BrowserSessionManager {
  private readonly pending = new Map<
    string,
    Map<string, { risk: "normal" | "sensitive"; browser: boolean }>
  >();
  private readonly states = new Map<string, BrowserCapabilityDto>();
  constructor(
    private readonly options: {
      logger: FastifyBaseLogger;
      sessionRoot: string;
    },
  ) {}

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
    this.pending.delete(sessionId);
    if (!this.states.has(sessionId)) return;
    const identity = browserIdentity(this.options.sessionRoot, sessionId);
    try {
      await run(
        browserBinary(),
        [
          "--namespace",
          identity.namespace,
          "--session",
          identity.session,
          "close",
        ],
        {
          env: {
            ...process.env,
            ...browserEnvironment(this.options.sessionRoot, sessionId),
          },
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        },
      );
      this.states.delete(sessionId);
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

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.states.keys()].map((id) => this.close(id)),
    );
  }
}
