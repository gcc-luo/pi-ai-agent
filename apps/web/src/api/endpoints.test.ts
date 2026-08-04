// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(43123),
}));

describe("desktop backend endpoints", () => {
  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses the port supplied by Tauri for HTTP and WebSocket requests", async () => {
    window.__TAURI_INTERNALS__ = {};
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const endpoints = await import("./endpoints.js");

    await endpoints.initializeBackendEndpoint();

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:43123/healthz", {
      cache: "no-store",
    });
    expect(endpoints.apiUrl("/projects")).toBe("http://127.0.0.1:43123/api/projects");
    expect(endpoints.webSocketUrl("/ws/agent")).toBe("ws://127.0.0.1:43123/ws/agent");
  });
});
