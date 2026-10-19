import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client.js";

describe("browser panel API", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("targets the session-scoped browser panel routes", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{"status":"open"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.openBrowserPanel("session / one");
    await api.navigateBrowserPanel("session / one", "https://example.test/path?q=1");
    await api.backBrowserPanel("session / one");
    await api.forwardBrowserPanel("session / one");
    await api.reloadBrowserPanel("session / one");
    await api.closeBrowserPanel("session / one");

    expect(fetchMock.mock.calls.map(([input, init]) => [String(input), init?.method, init?.body])).toEqual([
      ["/api/sessions/session%20%2F%20one/browser-panel/open", "POST", undefined],
      ["/api/sessions/session%20%2F%20one/browser-panel/navigate", "POST", JSON.stringify({ url: "https://example.test/path?q=1" })],
      ["/api/sessions/session%20%2F%20one/browser-panel/back", "POST", undefined],
      ["/api/sessions/session%20%2F%20one/browser-panel/forward", "POST", undefined],
      ["/api/sessions/session%20%2F%20one/browser-panel/reload", "POST", undefined],
      ["/api/sessions/session%20%2F%20one/browser-panel/close", "POST", undefined],
    ]);
  });
});

describe("terminal panel API", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("targets the session-scoped terminal close endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response('{"status":"closed"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.closeTerminalSession("session / one");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session%20%2F%20one/terminal/close", expect.objectContaining({ method: "POST" }));
  });

  it("opens the session terminal through its explicit lifecycle endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response('{"status":"open"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.openTerminalSession("session / one");

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/session%20%2F%20one/terminal/open", expect.objectContaining({ method: "POST" }));
  });
});
