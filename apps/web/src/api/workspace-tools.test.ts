import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserSocket, parseBrowserServerMessage, scaleBrowserPoint } from "./workspace-tools.js";

const mockAuthToken = vi.fn<[], string | undefined>(() => "test-token");
const mockWebSocketUrl = vi.fn((path: string) => `ws://localhost${path}`);

vi.mock("./endpoints.js", () => ({
  authToken: () => mockAuthToken(),
  webSocketUrl: (path: string) => mockWebSocketUrl(path),
}));

describe("workspace browser helpers", () => {
  const WebSocketMock = vi.fn();

  beforeEach(() => {
    mockAuthToken.mockReturnValue("test-token");
    mockWebSocketUrl.mockImplementation((path) => `ws://localhost${path}`);
    WebSocketMock.mockClear();
    vi.stubGlobal("WebSocket", WebSocketMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("creates an authenticated socket for the encoded session path", () => {
    createBrowserSocket("session / one");

    expect(mockWebSocketUrl).toHaveBeenCalledWith("/ws/browser/session%20%2F%20one");
    expect(WebSocketMock).toHaveBeenCalledWith(
      "ws://localhost/ws/browser/session%20%2F%20one",
      ["pi-web-ui", "test-token"],
    );
  });

  it("uses the browser panel protocol marker when no auth token is configured", () => {
    mockAuthToken.mockReturnValue(undefined);
    createBrowserSocket("session-2");

    expect(WebSocketMock).toHaveBeenCalledWith(
      "ws://localhost/ws/browser/session-2",
      ["pi-web-ui"],
    );
  });

  it("maps pointer coordinates through a contained viewport image", () => {
    const point = scaleBrowserPoint(250, 220, {
      left: 100,
      top: 100,
      width: 800,
      height: 600,
    }, 1280, 720);

    expect(point).toEqual({ x: 240, y: 72 });
  });

  it("accepts only known structured browser stream messages", () => {
    expect(parseBrowserServerMessage(JSON.stringify({ type: "url", url: "https://example.test" })))
      .toEqual({ type: "url", url: "https://example.test" });
    expect(parseBrowserServerMessage("not json")).toBeNull();
    expect(parseBrowserServerMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
    expect(parseBrowserServerMessage(JSON.stringify({ type: "frame", seq: -1, data: "!!!!" }))).toBeNull();
  });
});
