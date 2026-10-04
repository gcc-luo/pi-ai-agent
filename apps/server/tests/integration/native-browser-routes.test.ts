import Fastify from "fastify";
import { describe, it, expect, vi } from "vitest";
import { pluginsRoutes } from "../../src/routes/plugins.js";
import { BrowserSessionManager } from "../../src/browser/browser-session-manager.js";

async function fixture(approve = false) {
  const app = Fastify();
  const audit = vi.fn();
  const validate = vi.fn(() => true);
  const permission = vi.fn(async () => approve);
  app.decorate("sessions", {
    findById: () => ({ id: "s", projectId: "p" }),
  } as never);
  app.decorate("projects", { findById: () => ({ workdir: "/tmp" }) } as never);
  app.decorate("plugins", { appendAudit: audit } as never);
  app.decorate("pluginManager", {
    activeForSession: () => ["browser-use"],
    find: () => null,
  } as never);
  app.decorate("processManager", { validatePluginToken: validate } as never);
  app.decorate("pluginPermissions", { request: permission } as never);
  app.decorate("authorization", {
    authorize: async (input: { risk: string }) => input.risk === "normal" || permission(),
  } as never);
  app.decorate("sessionStates", new Map([["s", { send: vi.fn() }]]) as never);
  app.decorate(
    "browserManager",
    new BrowserSessionManager({
      logger: app.log,
      sessionRoot: "/tmp/pi-browser-route-tests",
    }),
  );
  await app.register(pluginsRoutes);
  const call = (action: string, args: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: "/internal/plugins/s/browser-use/action",
      headers: { "x-pi-plugin-token": "test" },
      payload: { action, args },
    });
  return { app, call, audit, validate, permission };
}

const params = {
  toolCallId: "call-1",
  toolName: "agent_browser",
  params: { args: ["fill", "#password", "private"] },
};

describe("native browser host boundary", () => {
  it("denies unconfirmed actions and rejects completion without an authorization", async () => {
    const f = await fixture();
    try {
      expect((await f.call("authorize", params)).json()).toEqual({
        approved: false,
      });
      expect(
        (await f.call("complete", { toolCallId: "call-1" })).statusCode,
      ).toBe(409);
      expect(JSON.stringify(f.audit.mock.calls)).not.toContain("private");
    } finally {
      await f.app.close();
    }
  });

  it("preserves the approved risk through completion and consumes it only once", async () => {
    const f = await fixture(true);
    try {
      expect((await f.call("authorize", params)).json()).toEqual({
        approved: true,
      });
      expect(
        (
          await f.call("complete", {
            toolCallId: "call-1",
            isError: false,
            details: { data: { url: "https://example.com" } },
          })
        ).statusCode,
      ).toBe(200);
      expect(f.audit).toHaveBeenLastCalledWith(
        expect.objectContaining({ risk: "sensitive", success: true }),
      );
      expect(f.app.browserManager.status("s", true).currentUrl).toBe(
        "https://example.com",
      );
      expect(
        (await f.call("complete", { toolCallId: "call-1" })).statusCode,
      ).toBe(409);
    } finally {
      await f.app.close();
    }
  });

  it("rechecks revoked credentials after the permission dialog resolves", async () => {
    const f = await fixture(true);
    try {
      f.validate.mockReturnValueOnce(true).mockReturnValue(false);
      expect((await f.call("authorize", params)).json()).toEqual({
        approved: false,
      });
      expect(f.app.browserManager.status("s", true).status).toBe("closed");
    } finally {
      await f.app.close();
    }
  });

  it("allows observations without a dialog, and rejects old execution commands", async () => {
    const f = await fixture();
    try {
      expect(
        (
          await f.call("authorize", {
            ...params,
            params: { args: ["snapshot", "-i"] },
          })
        ).json(),
      ).toEqual({ approved: true });
      expect(f.permission).not.toHaveBeenCalled();
      expect(
        (await f.call("navigate", { url: "https://example.com" })).statusCode,
      ).toBe(410);
    } finally {
      await f.app.close();
    }
  });
});
