import Fastify from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent, SessionAuthorizationMode } from "@pi-web-ui/shared";
import { AuthorizationService, type AuthorizationInput } from "../../src/authorization/authorization-service.js";
import { PluginPermissionService } from "../../src/plugins/plugin-permission-service.js";
import { authorizationRoutes } from "../../src/routes/authorization.js";

describe("core tool authorization route", () => {
  let app: ReturnType<typeof Fastify>;
  let workdir: string;
  let mode: SessionAuthorizationMode;
  let events: ServerEvent[];
  let permissions: PluginPermissionService;
  let token = "valid-token";
  let processActive = true;
  let sessionExists = true;
  const requestPermission = vi.fn();

  beforeEach(async () => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-core-auth-"));
    mode = "risk_based";
    events = [];
    token = "valid-token";
    processActive = true;
    sessionExists = true;
    requestPermission.mockReset();
    permissions = new PluginPermissionService();
    const sessionState = { send: (event: ServerEvent) => { events.push(event); } };
    const authorization = new AuthorizationService({
      getMode: async () => mode,
      request: async (input: AuthorizationInput) => {
        requestPermission(input);
        return permissions.request({
          ...input,
          reason: input.reason ?? "tool needs approval",
          send: sessionState.send,
        });
      },
    });
    app = Fastify();
    app.decorate("sessions", {
      findById: () => sessionExists ? ({ id: "session-1", projectId: "project-1" }) : null,
    } as never);
    app.decorate("projects", { findById: () => ({ id: "project-1", workdir }) } as never);
    app.decorate("processManager", {
      get: () => ({ status: processActive ? "active" : "suspended" }),
      validateAuthorizationToken: (_sessionId: string, candidate: string) => candidate === token,
    } as never);
    app.decorate("authorization", authorization as never);
    app.decorate("pluginPermissions", permissions as never);
    app.decorate("sessionStates", new Map([["session-1", sessionState]]) as never);
    await app.register(authorizationRoutes);
  });

  afterEach(async () => {
    permissions.shutdown();
    await app.close();
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  function check(toolName: string, input: Record<string, unknown>, authToken = "valid-token") {
    return app.inject({
      method: "POST",
      url: "/internal/authorization/session-1/check",
      headers: { "x-pi-authorization-token": authToken },
      payload: { toolCallId: `call-${toolName}`, toolName, input },
    });
  }

  it("allows normal project reads and asks before accessing outside files", async () => {
    expect((await check("read", { path: "notes.txt" })).json()).toMatchObject({ approved: true });
    expect(requestPermission).not.toHaveBeenCalled();

    const pending = check("write", { path: "../private.txt", content: "data" });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({
      type: "permission_request",
      source: "core_tool",
      toolName: "write",
      context: { target: "../private.txt" },
    });
    const event = events[0] as Extract<ServerEvent, { type: "permission_request" }>;
    expect(permissions.respond("session-1", event.requestId, true)).toBe(true);
    expect((await pending).json()).toMatchObject({ approved: true });
  });

  it("sends only the command text as a Bash approval target", async () => {
    mode = "approve_each";
    const pending = check("bash", { command: "printf safe" });
    await vi.waitFor(() => expect(events).toHaveLength(1));

    expect(events[0]).toMatchObject({
      type: "permission_request",
      source: "core_tool",
      toolName: "bash",
      context: { target: "printf safe" },
    });
    const event = events[0] as Extract<ServerEvent, { type: "permission_request" }>;
    permissions.respond("session-1", event.requestId, true);
    expect((await pending).json()).toMatchObject({ approved: true });
  });

  it("applies approve_each and full_access to core tools", async () => {
    mode = "full_access";
    expect((await check("bash", { command: "rm -rf ./build" })).json()).toMatchObject({ approved: true });
    expect(requestPermission).not.toHaveBeenCalled();

    mode = "approve_each";
    const pending = check("read", { path: "notes.txt" });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    const event = events[0] as Extract<ServerEvent, { type: "permission_request" }>;
    permissions.respond("session-1", event.requestId, true);
    expect((await pending).json()).toMatchObject({ approved: true });
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("rejects invalid credentials and blocks tools when the session process is gone", async () => {
    expect((await check("bash", { command: "pwd" }, "wrong-token")).statusCode).toBe(403);
    processActive = false;
    expect((await check("bash", { command: "pwd" })).statusCode).toBe(409);
    processActive = true;
    sessionExists = false;
    expect((await check("bash", { command: "pwd" })).statusCode).toBe(404);
  });

  it("does not let approval outlive the Pi process token", async () => {
    const pending = check("write", { path: "../private.txt", content: "data" });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    processActive = false;
    const event = events[0] as Extract<ServerEvent, { type: "permission_request" }>;
    permissions.respond("session-1", event.requestId, true);
    expect((await pending).json()).toMatchObject({
      approved: false,
      reason: "授权已取消或会话进程已停止，工具未执行。",
    });
  });
});
