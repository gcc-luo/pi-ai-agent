import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/authorization/authorization-service.js";
import type { AuthorizationInput } from "../../src/authorization/authorization-service.js";
import { BrowserSessionManager } from "../../src/browser/browser-session-manager.js";
import { pluginsRoutes } from "../../src/routes/plugins.js";

async function fixture(options: {
  mode?: "risk_based" | "approve_each" | "full_access";
  approve?: boolean;
  browserEnabled?: boolean;
  waitForDisconnect?: boolean;
} = {}) {
  const app = Fastify();
  let responseRaw: import("node:http").ServerResponse | undefined;
  app.addHook("onRequest", (req, reply, done) => {
    responseRaw = reply.raw;
    done();
  });
  const permission = vi.fn((input: AuthorizationInput) => {
    if (options.waitForDisconnect && input.signal) {
      return new Promise<boolean>((resolve) => {
        input.signal!.addEventListener("abort", () => resolve(false), { once: true });
      });
    }
    return Promise.resolve(options.approve ?? false);
  });
  const authorizationService = new AuthorizationService({
    getMode: async () => options.mode ?? "risk_based",
    request: permission,
  });
  const authorization = vi.fn(authorizationService.authorize.bind(authorizationService));
  const sendFiles = vi.fn(async () => ({ ok: true }));
  const appendAudit = vi.fn();
  app.decorate("sessions", { findById: () => ({ id: "s", projectId: "p" }) } as never);
  app.decorate("projects", { findById: () => ({ workdir: "/tmp" }) } as never);
  app.decorate("plugins", { appendAudit, update: vi.fn(), selectedForSession: () => [] } as never);
  app.decorate("pluginManager", {
    activeForSession: () => options.browserEnabled === false ? [] : ["browser-use"],
    find: () => null,
  } as never);
  app.decorate("processManager", {
    validatePluginToken: () => true,
    isPluginActive: () => true,
  } as never);
  app.decorate("pluginPermissions", { request: permission } as never);
  app.decorate("authorization", { authorize: authorization } as never);
  app.decorate("sessionStates", new Map([["s", { send: vi.fn() }]]) as never);
  app.decorate("browserManager", new BrowserSessionManager({ logger: app.log, sessionRoot: "/tmp/pi-auth-route-tests" }) as never);
  app.decorate("wechatFileTransfers", { sendFiles } as never);
  await app.register(pluginsRoutes);

  const browser = (toolName: string, params: Record<string, unknown>) => app.inject({
    method: "POST",
    url: "/internal/plugins/s/browser-use/action",
    headers: { "x-pi-plugin-token": "token" },
    payload: { action: "authorize", args: { toolCallId: `call-${toolName}`, toolName, params } },
  });
  const sendWechat = (filePaths: string[]) => app.inject({
    method: "POST",
    url: "/internal/plugins/s/wechat-file-transfer/action",
    headers: { "x-pi-plugin-token": "token" },
    payload: { action: "sendFiles", args: { filePaths } },
  });
  return { app, browser, sendWechat, permission, authorization, sendFiles, disconnect: () => responseRaw?.emit("close") };
}

describe("shared plugin authorization boundary", () => {
  it("prompts for normal browser calls in approve_each mode", async () => {
    const f = await fixture({ mode: "approve_each", approve: true });
    try {
      expect((await f.browser("agent_browser_web_search", { args: ["pi.dev"] })).json()).toEqual({ approved: true });
      expect(f.permission).toHaveBeenCalledOnce();
      expect(f.authorization).toHaveBeenCalledWith(expect.objectContaining({
        source: "plugin",
        pluginId: "browser-use",
        toolName: "agent_browser_web_search",
        risk: "normal",
      }));
    } finally {
      await f.app.close();
    }
  });

  it("keeps risk_based confirmation and skips risky prompts in full_access", async () => {
    const riskBased = await fixture({ mode: "risk_based", approve: true });
    try {
      expect((await riskBased.browser("agent_browser", { args: ["fill", "#password", "secret"] })).json()).toEqual({ approved: true });
      expect(riskBased.permission).toHaveBeenCalledOnce();
    } finally {
      await riskBased.app.close();
    }

    const fullAccess = await fixture({ mode: "full_access" });
    try {
      expect((await fullAccess.browser("agent_browser", { args: ["fill", "#password", "secret"] })).json()).toEqual({ approved: true });
      expect(fullAccess.permission).not.toHaveBeenCalled();
    } finally {
      await fullAccess.app.close();
    }
  });

  it("does not make disabled plugins available in full_access", async () => {
    const f = await fixture({ mode: "full_access", browserEnabled: false });
    try {
      expect((await f.browser("agent_browser", { args: ["snapshot"] })).statusCode).toBe(409);
      expect(f.authorization).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });

  it("authorizes WeChat file sending with sensitive risk and filename-only context", async () => {
    const f = await fixture({ mode: "risk_based", approve: true });
    try {
      expect((await f.sendWechat(["/private/home/report.pdf"])).json()).toEqual({ ok: true });
      expect(f.authorization).toHaveBeenCalledWith(expect.objectContaining({
        source: "plugin",
        toolName: "send_file_to_wechat",
        risk: "sensitive",
        context: { files: ["report.pdf"] },
      }));
      expect(f.sendFiles).toHaveBeenCalledOnce();
    } finally {
      await f.app.close();
    }
  });

  it("does not send WeChat files when authorization is denied", async () => {
    const f = await fixture({ mode: "risk_based", approve: false });
    try {
      const response = await f.sendWechat(["/private/home/report.pdf"]);
      expect(response.json()).toMatchObject({ denied: true });
      expect(f.sendFiles).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });

  it("cancels pending WeChat authorization when the response socket closes", async () => {
    const f = await fixture({ mode: "risk_based", waitForDisconnect: true });
    try {
      const pending = f.sendWechat(["/private/home/report.pdf"]);
      await vi.waitFor(() => expect(f.permission).toHaveBeenCalledOnce());
      const signal = f.permission.mock.calls[0]![0].signal!;
      f.disconnect();
      await expect(pending).rejects.toMatchObject({ code: "LIGHT_ECONNRESET" });
      expect(signal.aborted).toBe(true);
      expect(f.sendFiles).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
});
