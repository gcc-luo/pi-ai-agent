import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import WorkspaceTerminal from "./WorkspaceTerminal.vue";
import { closeTerminalSession, createTerminalSocket } from "../api/workspace-tools.js";

vi.mock("../i18n/index.js", () => ({ useI18n: () => ({ t: (key: string, args?: Record<string, unknown>) => args ? `${key}:${args.exitCode}` : key }) }));
vi.mock("../api/workspace-tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/workspace-tools.js")>();
  return { ...actual, closeTerminalSession: vi.fn(), createTerminalSocket: vi.fn() };
});

class FakeSocket {
  readyState: number = WebSocket.OPEN;
  binaryType = "";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  receive(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

const sockets: FakeSocket[] = [];
const terminalMocks = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    cols = 80;
    rows = 24;
    writes: unknown[] = [];
    open = vi.fn();
    write = vi.fn((data: unknown) => this.writes.push(data));
    reset = vi.fn(() => { this.writes.length = 0; });
    dispose = vi.fn();
    loadAddon = vi.fn();
    onData = vi.fn((callback: (data: string) => void) => { this.onDataCallback = callback; return { dispose: vi.fn() }; });
    focus = vi.fn();
    onDataCallback?: (data: string) => void;
    constructor(options: Record<string, unknown>) { this.options = options; terminalMocks.instances.push(this); }
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); dispose = vi.fn(); } }));

function mountTerminal(active = true) {
  return mount(WorkspaceTerminal, { props: { sessionId: "session-1", projectId: "project-1", active } });
}

describe("workspace terminal", () => {
  beforeEach(() => {
    sockets.length = 0;
    terminalMocks.instances.length = 0;
    vi.mocked(closeTerminalSession).mockReset().mockResolvedValue({ status: "closed" });
    vi.mocked(createTerminalSocket).mockReset().mockImplementation(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); disconnect = vi.fn(); constructor(private callback: ResizeObserverCallback) {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("replays binary output and sends terminal input and bounded dimensions", async () => {
    const wrapper = mountTerminal();
    await flushPromises();
    expect(createTerminalSocket).toHaveBeenCalledWith("session-1");
    expect(terminalMocks.instances).toHaveLength(1);
    expect(terminalMocks.instances[0]!.options).toMatchObject({ convertEol: true, cursorBlink: true });
    const socket = sockets[0]!;
    socket.onopen?.(new Event("open"));
    expect(JSON.parse(String(socket.send.mock.calls.find(([value]) => String(value).includes('"type":"resize"'))?.[0])))
      .toEqual({ type: "resize", cols: 80, rows: 24 });
    socket.receive(new Uint8Array([111, 107]).buffer);
    expect(terminalMocks.instances[0]!.write).toHaveBeenCalledWith(expect.any(Uint8Array));
    terminalMocks.instances[0]!.onDataCallback?.("echo hi\r");
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "echo hi\r" }));
    wrapper.unmount();
  });

  it("keeps the terminal instance and socket when switched away", async () => {
    const wrapper = mountTerminal();
    await flushPromises();
    await wrapper.setProps({ active: false });
    expect(sockets[0]!.close).not.toHaveBeenCalled();
    expect(closeTerminalSession).not.toHaveBeenCalled();
    await wrapper.setProps({ active: true });
    await flushPromises();
    expect(createTerminalSocket).toHaveBeenCalledTimes(1);
    expect(terminalMocks.instances).toHaveLength(1);
    wrapper.unmount();
  });

  it("offers restart after a natural exit and closes the old PTY before reconnecting", async () => {
    const wrapper = mountTerminal();
    await flushPromises();
    sockets[0]!.receive(JSON.stringify({ type: "exit", exitCode: 7, signal: 0 }));
    await flushPromises();
    expect(wrapper.text()).toContain("workspaceTools.terminalExited:7");
    await wrapper.get('[data-test="terminal-restart"]').trigger("click");
    await flushPromises();
    expect(closeTerminalSession).toHaveBeenCalledWith("session-1");
    expect(createTerminalSocket).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("offers reconnect after a socket failure without replacing the terminal screen", async () => {
    const wrapper = mountTerminal();
    await flushPromises();
    sockets[0]!.onerror?.(new Event("error"));
    await flushPromises();
    expect(wrapper.find('[data-test="terminal-retry"]').exists()).toBe(true);
    await wrapper.get('[data-test="terminal-retry"]').trigger("click");
    await flushPromises();
    expect(createTerminalSocket).toHaveBeenCalledTimes(2);
    expect(terminalMocks.instances).toHaveLength(1);
    wrapper.unmount();
  });

  it("clears old screen output before reconnect replay to avoid duplicates", async () => {
    const wrapper = mountTerminal();
    await flushPromises();
    const original = sockets[0]!;
    original.onopen?.(new Event("open"));
    original.receive(new Uint8Array([104, 105, 13, 10]).buffer);
    expect(terminalMocks.instances[0]!.writes).toHaveLength(1);

    original.onclose?.({ code: 1006, reason: "connection lost" } as CloseEvent);
    await flushPromises();
    await wrapper.get('[data-test="terminal-retry"]').trigger("click");
    await flushPromises();
    const reconnected = sockets[1]!;
    reconnected.onopen?.(new Event("open"));
    reconnected.receive(new Uint8Array([104, 105, 13, 10]).buffer);

    expect(terminalMocks.instances[0]!.reset).toHaveBeenCalledTimes(1);
    expect(terminalMocks.instances[0]!.writes).toHaveLength(1);
    wrapper.unmount();
  });

  it("uses the close endpoint even when explicit disposal races a connecting socket", async () => {
    const wrapper = mountTerminal();
    await flushPromises();
    sockets[0]!.readyState = WebSocket.CONNECTING;
    await (wrapper.vm as unknown as { dispose: () => Promise<void> }).dispose();
    expect(closeTerminalSession).toHaveBeenCalledWith("session-1");
    wrapper.unmount();
  });
});
