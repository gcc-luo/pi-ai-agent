import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../../src/authorization/authorization-service.js";
import { connectorsRoutes } from "../../src/routes/connectors.js";

async function fixture(mode: "risk_based" | "approve_each" | "full_access", approved = false) {
  const app = Fastify();
  const request = vi.fn(async () => approved);
  const service = new AuthorizationService({
    getMode: async () => mode,
    request,
  });
  const authorize = vi.fn(service.authorize.bind(service));
  const searchTools = vi.fn(() => [{ name: "read_data" }]);
  const describeTool = vi.fn(() => ({ name: "read_data" }));
  app.decorate("processManager", { validateConnectorToken: () => true } as never);
  app.decorate("sessions", { findById: () => ({ id: "s", projectId: "p" }) } as never);
  app.decorate("projects", { findById: () => ({ id: "p", workdir: "/tmp" }) } as never);
  app.decorate("authorization", { authorize } as never);
  app.decorate("connectorService", { searchTools, describeTool } as never);
  await app.register(connectorsRoutes);
  const call = (action: "search" | "describe") => app.inject({
    method: "POST",
    url: `/internal/connectors/s/${action}`,
    headers: { "x-pi-connector-token": "token" },
    payload: action === "search" ? { query: "find docs" } : { tool: "conn.read_data" },
  });
  return { app, call, request, authorize, searchTools, describeTool };
}

describe("connector discovery authorization", () => {
  it("prompts for search and describe in approve_each mode", async () => {
    const f = await fixture("approve_each", true);
    try {
      expect((await f.call("search")).statusCode).toBe(200);
      expect((await f.call("describe")).statusCode).toBe(200);
      expect(f.request).toHaveBeenCalledTimes(2);
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
        expect(f.request).not.toHaveBeenCalled();
      } finally {
        await f.app.close();
      }
    }
  });
});
