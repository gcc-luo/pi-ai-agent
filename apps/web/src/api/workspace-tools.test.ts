import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserSocket, createTerminalSocket, parseTerminalServerMessage, parseBrowserServerMessage, scaleBrowserPoint } from "./workspace-tools.js";

const mockAuthToken = vi.fn<[], string | undefined>(() => "test-token");
const mockWebSocketUrl = vi.fn((path: string) => `ws://localhost${path}`);
const WebSocketMock = vi.fn();

vi.mock("./endpoints.js", () => ({
  authToken: () => mockAuthToken(),
  webSocketUrl: (path: string) => mockWebSocketUrl(path),
}));

describe("workspace browser helpers", () => {
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

  it("ignores all four letterbox edges but accepts an aspect-matched image", () => {
    const wideImage = { left: 0, top: 0, width: 800, height: 600 };
    expect(scaleBrowserPoint(400, 74, wideImage, 1280, 720)).toBeNull();
    expect(scaleBrowserPoint(400, 526, wideImage, 1280, 720)).toBeNull();

    const tallImage = { left: 0, top: 0, width: 800, height: 450 };
    expect(scaleBrowserPoint(99, 225, tallImage, 640, 480)).toBeNull();
    expect(scaleBrowserPoint(701, 225, tallImage, 640, 480)).toBeNull();
    expect(scaleBrowserPoint(400, 225, tallImage, 1280, 720)).toEqual({ x: 640, y: 360 });
  });

  it("accepts only known structured browser stream messages", () => {
    expect(parseBrowserServerMessage(JSON.stringify({ type: "url", url: "https://example.test" })))
      .toEqual({ type: "url", url: "https://example.test" });
    expect(parseBrowserServerMessage("not json")).toBeNull();
    expect(parseBrowserServerMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
    expect(parseBrowserServerMessage(JSON.stringify({ type: "frame", seq: -1, data: "!!!!" }))).toBeNull();
  });
});

describe("workspace terminal helpers", () => {
  beforeEach(() => {
    mockAuthToken.mockReturnValue("test-token");
    mockWebSocketUrl.mockImplementation((path) => `ws://localhost${path}`);
    WebSocketMock.mockClear();
    vi.stubGlobal("WebSocket", WebSocketMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("creates an authenticated socket for the encoded session path", () => {
    createTerminalSocket("session / one");

    expect(mockWebSocketUrl).toHaveBeenCalledWith("/ws/terminal/session%20%2F%20one");
    expect(WebSocketMock).toHaveBeenCalledWith(
      "ws://localhost/ws/terminal/session%20%2F%20one",
      ["pi-web-ui", "test-token"],
    );
  });

  it("parses only terminal exit messages and accepts binary output as a separate frame", () => {
    expect(parseTerminalServerMessage(JSON.stringify({ type: "exit", exitCode: 0, signal: 0 })))
      .toEqual({ type: "exit", exitCode: 0, signal: 0 });
    expect(parseTerminalServerMessage(JSON.stringify({ type: "exit", exitCode: "0", signal: 0 }))).toBeNull();
    expect(parseTerminalServerMessage("not json")).toBeNull();
    expect(parseTerminalServerMessage(new ArrayBuffer(2))).toBeNull();
  });
});
