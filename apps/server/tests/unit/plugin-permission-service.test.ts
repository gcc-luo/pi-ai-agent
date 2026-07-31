import { describe, expect, it, vi } from "vitest";
import { PluginPermissionService } from "../../src/plugins/plugin-permission-service.js";

describe("PluginPermissionService", () => {
  it("accepts a response only for the matching session and request", async () => {
    const service = new PluginPermissionService();
    const send = vi.fn();
    const pending = service.request({
      sessionId: "session-a",
      pluginId: "computer-use",
      action: "click",
      reason: "sensitive action",
      send,
    });
    const request = send.mock.calls[0]![0];

    expect(service.respond("session-b", request.requestId, true)).toBe(false);
    expect(service.respond("session-a", request.requestId, true)).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(service.respond("session-a", request.requestId, true)).toBe(false);
  });

  it("denies pending requests when the session is cancelled", async () => {
    const service = new PluginPermissionService();
    const pending = service.request({
      sessionId: "session-a",
      pluginId: "browser-use",
      action: "click",
      reason: "external side effect",
      send: vi.fn(),
    });

    service.cancelSession("session-a");

    await expect(pending).resolves.toBe(false);
  });
});
