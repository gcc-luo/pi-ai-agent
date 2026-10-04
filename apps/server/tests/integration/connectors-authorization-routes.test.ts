import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/authorization/authorization-service.js";
import { connectorsRoutes } from "../../src/routes/connectors.js";
import type { AuthorizationInput } from "../../src/authorization/authorization-service.js";

async function fixture(
  mode: "risk_based" | "approve_each" | "full_access",
  approved = false,
  waitForDisconnect = false,
  waitForApproval = false,
) {
  const app = Fastify();
  let responseRaw: import("node:http").ServerResponse | undefined;
  let tokenActive = true;
  let approvePending: ((approved: boolean) => void) | undefined;
  app.addHook("onRequest", (req, reply, done) => {
    responseRaw = reply.raw;
    done();
  });
  const request = vi.fn((input: AuthorizationInput) => {
    if (waitForApproval) {
      return new Promise<boolean>((resolve) => { approvePending = resolve; });
    }
    if (waitForDisconnect && input.signal) {
      return new Promise<boolean>((resolve) => {
        input.signal!.addEventListener("abort", () => resolve(false), { once: true });
      });
    }
    return Promise.resolve(approved);
  });
  const service = new AuthorizationService({
    getMode: async () => mode,
    request,
  });
  const authorize = vi.fn(service.authorize.bind(service));
  const authorizeWithDecision = vi.fn(service.authorizeWithDecision.bind(service));
  const searchTools = vi.fn(() => [{ name: "read_data" }]);
  const describeTool = vi.fn(() => ({ name: "read_data" }));
  const invoke = vi.fn(async (_name: string, _args: Record<string, unknown>, _context: unknown, authorizeCall: (input: { toolName: string; policy: "allow" | "ask" | "deny"; risk: "normal" | "sensitive" }) => Promise<{ approved: boolean; prompted: boolean }>) =>
    authorizeCall({ toolName: "conn.read_data", policy: "allow", risk: "normal" }));
  app.decorate("processManager", { validateConnectorToken: () => tokenActive } as never);
  app.decorate("sessions", { findById: () => ({ id: "s", projectId: "p" }) } as never);
  app.decorate("projects", { findById: () => ({ id: "p", workdir: "/tmp" }) } as never);
  app.decorate("authorization", { authorize, authorizeWithDecision } as never);
  app.decorate("connectorService", { searchTools, describeTool, invoke } as never);
  await app.register(connectorsRoutes);
  const call = (action: "search" | "describe" | "call") => app.inject({
    method: "POST",
    url: `/internal/connectors/s/${action}`,
    headers: { "x-pi-connector-token": "token" },
    payload: action === "search" ? { query: "find docs" } : action === "describe" ? { tool: "conn.read_data" } : { tool: "conn.read_data", arguments: {} },
  });
  return {
    app, call, request, authorize, authorizeWithDecision, searchTools, describeTool, invoke,
    disconnect: () => responseRaw?.emit("close"),
    revokeToken: () => { tokenActive = false; },
    approvePending: (decision: boolean) => approvePending?.(decision),
  };
}

describe("connector discovery authorization", () => {
  it("prompts for search and describe in approve_each mode", async () => {
    const f = await fixture("approve_each", true);
    try {
      expect((await f.call("search")).statusCode).toBe(200);
      expect((await f.call("describe")).statusCode).toBe(200);
      expect((await f.call("call")).statusCode).toBe(200);
      expect(f.request).toHaveBeenCalledTimes(3);
      expect(f.authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({
        source: "connector",
        toolName: "connector.search",
        risk: "normal",
      }));
      expect(f.authorize).toHaveBeenNthCalledWith(2, expect.objectContaining({
        source: "connector",
        toolName: "connector.describe",
        risk: "normal",
      }));
      expect(f.authorizeWithDecision).toHaveBeenCalledWith(expect.objectContaining({
        source: "connector",
        toolName: "conn.read_data",
        policy: "allow",
        risk: "normal",
      }));
    } finally {
      await f.app.close();
    }
  });

  it("keeps discovery prompt-free in risk_based and full_access modes", async () => {
    for (const mode of ["risk_based", "full_access"] as const) {
      const f = await fixture(mode);
      try {
        expect((await f.call("search")).statusCode).toBe(200);
        expect((await f.call("describe")).statusCode).toBe(200);
        expect((await f.call("call")).statusCode).toBe(200);
        expect(f.request).not.toHaveBeenCalled();
      } finally {
        await f.app.close();
      }
    }
  });

  it("aborts pending authorization on socket close for search, describe, and call", async () => {
    for (const action of ["search", "describe", "call"] as const) {
      const f = await fixture("approve_each", false, true);
      try {
        const pending = f.call(action);
        await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
        const signal = f.request.mock.calls[0]![0].signal!;
        f.disconnect();
        await expect(pending).rejects.toMatchObject({ code: "LIGHT_ECONNRESET" });
        expect(signal.aborted).toBe(true);
      } finally {
        await f.app.close();
      }
    }
  });

  it("does not invoke a connector after its token is revoked during approval", async () => {
    const f = await fixture("approve_each", false, false, true);
    try {
      const pending = f.call("call");
      await vi.waitFor(() => expect(f.request).toHaveBeenCalledOnce());
      f.revokeToken();
      f.approvePending(true);
      expect((await pending).json()).toMatchObject({ approved: false });
    } finally {
      await f.app.close();
    }
  });
});
