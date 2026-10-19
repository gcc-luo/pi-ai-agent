import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import WorkspaceBrowser from "./WorkspaceBrowser.vue";
import {
  backBrowserPanel,
  closeBrowserPanel,
  createBrowserSocket,
  forwardBrowserPanel,
  navigateBrowserPanel,
  openBrowserPanel,
  reloadBrowserPanel,
} from "../api/workspace-tools.js";

vi.mock("../i18n/index.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../api/workspace-tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/workspace-tools.js")>();
  return {
    ...actual,
    closeBrowserPanel: vi.fn(),
    createBrowserSocket: vi.fn(),
    navigateBrowserPanel: vi.fn(),
    openBrowserPanel: vi.fn(),
    backBrowserPanel: vi.fn(),
    forwardBrowserPanel: vi.fn(),
    reloadBrowserPanel: vi.fn(),
  };
});

class FakeBrowserSocket {
  readyState = WebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

const sockets: FakeBrowserSocket[] = [];

afterEach(() => { vi.unstubAllGlobals(); });

function mountBrowser(active = true) {
  return mount(WorkspaceBrowser, {
    props: { sessionId: "session-1", projectId: "project-1", active },
  });
}

describe("workspace browser", () => {
  beforeEach(() => {
    sockets.length = 0;
    vi.mocked(openBrowserPanel).mockReset().mockResolvedValue({ status: "open" });
    vi.mocked(closeBrowserPanel).mockReset().mockResolvedValue({ status: "closed" });
    vi.mocked(navigateBrowserPanel).mockReset().mockResolvedValue({ status: "open" });
    vi.mocked(backBrowserPanel).mockReset().mockResolvedValue({ status: "open" });
    vi.mocked(forwardBrowserPanel).mockReset().mockResolvedValue({ status: "open" });
    vi.mocked(reloadBrowserPanel).mockReset().mockResolvedValue({ status: "open" });
    vi.mocked(createBrowserSocket).mockReset().mockImplementation(() => {
      const socket = new FakeBrowserSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
  });

  it("opens the shared session page, requests paced frames, and acknowledges decoded frames", async () => {
    const imageDecode = vi.fn().mockResolvedValue(undefined);
    const paintCallbacks: FrameRequestCallback[] = [];
    class DecodedImage {
      src = "";
      naturalWidth = 1280;
      naturalHeight = 720;
      decode = imageDecode;
    }
    vi.stubGlobal("Image", DecodedImage);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      paintCallbacks.push(callback);
      return 1;
    });

    const wrapper = mountBrowser();
    await flushPromises();
    expect(openBrowserPanel).toHaveBeenCalledWith("session-1", "browser");
    expect(createBrowserSocket).toHaveBeenCalledWith("session-1", "browser");

    const socket = sockets[0]!;
    socket.onopen?.(new Event("open"));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      type: "config",
      pacing: "ack",
      maxFps: 10,
    }));
    socket.receive({ type: "status", screencasting: true, engine: "chromium" });
    await flushPromises();
    expect(wrapper.get(".browser-connection-dot").classes()).toContain("connected");

    socket.receive({ type: "url", url: "https://example.test/page" });
    await flushPromises();
    expect((wrapper.get('[data-test="browser-url"]').element as HTMLInputElement).value)
      .toBe("https://example.test/page");

    socket.receive({
      type: "frame",
      seq: 17,
      data: "aGVsbG8=",
      metadata: { deviceWidth: 1280, deviceHeight: 720 },
    });
    await flushPromises();
    expect(imageDecode).toHaveBeenCalledTimes(1);
    expect(socket.send).not.toHaveBeenLastCalledWith(JSON.stringify({ type: "ack", seq: 17 }));
    paintCallbacks.shift()?.(0);
    await flushPromises();
    expect(socket.send).not.toHaveBeenLastCalledWith(JSON.stringify({ type: "ack", seq: 17 }));
    paintCallbacks.shift()?.(0);
    await flushPromises();
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: "ack", seq: 17 }));
    expect(wrapper.get('[data-test="browser-frame"]').attributes("src"))
      .toBe("data:image/jpeg;base64,aGVsbG8=");

    await wrapper.setProps({ active: false });
    expect(socket.close).toHaveBeenCalled();
    expect(closeBrowserPanel).not.toHaveBeenCalled();

    await (wrapper.vm as unknown as { dispose: () => Promise<void> }).dispose();
    expect(closeBrowserPanel).toHaveBeenCalledWith("session-1", "browser");
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("navigates the shared page through its session control endpoint", async () => {
    const wrapper = mountBrowser();
    await flushPromises();

    await wrapper.get('[data-test="browser-url"]').setValue("https://example.test/next");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(navigateBrowserPanel).toHaveBeenCalledWith("session-1", "https://example.test/next", "browser");
    await wrapper.get('[data-test="browser-back"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-test="browser-forward"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-test="browser-reload"]').trigger("click");
    await flushPromises();
    expect(backBrowserPanel).toHaveBeenCalledWith("session-1", "browser");
    expect(forwardBrowserPanel).toHaveBeenCalledWith("session-1", "browser");
    expect(reloadBrowserPanel).toHaveBeenCalledWith("session-1", "browser");
    wrapper.unmount();
  });

  it("converts pointer, touch, and keyboard input to the shared page coordinates", async () => {
    class DecodedImage {
      src = "";
      naturalWidth = 1280;
      naturalHeight = 720;
      decode = vi.fn().mockResolvedValue(undefined);
    }
    vi.stubGlobal("Image", DecodedImage);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const wrapper = mountBrowser();
    await flushPromises();
    const socket = sockets[0]!;
    socket.onopen?.(new Event("open"));
    socket.receive({ type: "frame", seq: 1, data: "aGVsbG8=", metadata: { deviceWidth: 1280, deviceHeight: 720 } });
    await flushPromises();
    socket.send.mockClear();

    const viewport = wrapper.get('[data-test="browser-viewport"]').element;
    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => ({ left: 100, top: 100, width: 800, height: 600 }),
    });
    const dispatch = (type: string, fields: Record<string, unknown>) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, fields);
      viewport.dispatchEvent(event);
    };

    dispatch("pointerdown", { clientX: 250, clientY: 120, pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, detail: 1 });
    expect(socket.send).not.toHaveBeenCalled();

    dispatch("pointerdown", { clientX: 250, clientY: 220, pointerType: "mouse", pointerId: 1, button: 0, buttons: 1, detail: 1 });
    expect(JSON.parse(String(socket.send.mock.calls.at(-1)?.[0]))).toMatchObject({
      type: "input_mouse",
      eventType: "mousePressed",
      x: 240,
      y: 72,
      button: "left",
    });

    dispatch("keydown", { key: "a", code: "KeyA", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
    expect(JSON.parse(String(socket.send.mock.calls.at(-1)?.[0]))).toMatchObject({
      type: "input_keyboard",
      eventType: "keyDown",
      key: "a",
      code: "KeyA",
      text: "a",
    });

    dispatch("pointerdown", { clientX: 250, clientY: 220, pointerType: "touch", pointerId: 7, pressure: 0.5 });
    expect(JSON.parse(String(socket.send.mock.calls.at(-1)?.[0]))).toMatchObject({
      type: "input_touch",
      eventType: "touchStart",
      touchPoints: [{ id: 7, x: 240, y: 72, force: 0.5 }],
    });
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("offers a manual reconnect after a stream failure", async () => {
    const wrapper = mountBrowser();
    await flushPromises();
    expect(createBrowserSocket).toHaveBeenCalledTimes(1);

    sockets[0]!.onerror?.(new Event("error"));
    await flushPromises();
    expect(createBrowserSocket).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="browser-retry"]').exists()).toBe(true);

    await wrapper.get('[data-test="browser-retry"]').trigger("click");
    await flushPromises();
    expect(openBrowserPanel).toHaveBeenCalledTimes(2);
    expect(createBrowserSocket).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("offers a manual reconnect when a frame cannot be decoded", async () => {
    class BrokenImage {
      src = "";
      decode = vi.fn().mockRejectedValue(new Error("invalid jpeg"));
    }
    vi.stubGlobal("Image", BrokenImage);

    const wrapper = mountBrowser();
    await flushPromises();
    sockets[0]!.receive({ type: "frame", seq: 2, data: "aGVsbG8=" });
    await flushPromises();

    expect(wrapper.text()).toContain("workspaceTools.browserFrameDecodeFailed");
    expect(wrapper.find('[data-test="browser-retry"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("offers recovery when the server rejects a malformed frame", async () => {
    const wrapper = mountBrowser();
    await flushPromises();
    sockets[0]!.receive({ type: "frame", seq: -1, data: "aGVsbG8=" });
    await flushPromises();

    expect(wrapper.text()).toContain("workspaceTools.browserFrameDecodeFailed");
    expect(wrapper.find('[data-test="browser-retry"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("treats other policy close reasons as recoverable stream errors", async () => {
    const wrapper = mountBrowser();
    await flushPromises();
    sockets[0]!.onclose?.({ code: 1008, reason: "unsupported browser input" } as CloseEvent);
    await flushPromises();

    expect(wrapper.text()).not.toContain("workspaceTools.browserSessionMissing");
    expect(wrapper.find('[data-test="browser-retry"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("asks the user to reopen the tab when the browser session is missing", async () => {
    const wrapper = mountBrowser();
    await flushPromises();
    await vi.waitFor(() => expect(sockets[0]?.onclose).toBeTypeOf("function"));
    sockets[0]!.onclose?.({ code: 1008, reason: "session not found" } as CloseEvent);
    await flushPromises();

    expect(wrapper.text()).toContain("workspaceTools.browserSessionMissing");
    expect(wrapper.find('[data-test="browser-retry"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
