import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  active: null as any,
  windows: [] as any[],
  mouse: {
    config: {},
    scrollUp: vi.fn(),
    scrollDown: vi.fn(),
    setPosition: vi.fn(),
    getPosition: vi.fn(),
  },
}));
vi.mock("@nut-tree-fork/nut-js", () => ({
  Button: {},
  FileType: {},
  Point: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
  getActiveWindow: async () => mock.active,
  getWindows: async () => mock.windows,
  mouse: mock.mouse,
  keyboard: { config: {} },
  screen: { width: async () => 1000, height: async () => 800 },
}));
import { runComputerAction } from "../../src/computer/computer-driver.js";
function window(id: number, title: string) {
  const win = {
    windowHandle: id,
    getTitle: async () => title,
    getRegion: async () => ({ left: 0, top: 0, width: 900, height: 700 }),
    restore: vi.fn(),
    focus: vi.fn(async () => {
      mock.active = win;
      return true;
    }),
  };
  return win;
}
describe("computer driver target handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.active = window(1, "PI AI Agent");
    mock.windows = [mock.active, window(2, "Editor")];
  });
  it("allows switching from PI to an explicitly selected external window", async () => {
    await expect(
      runComputerAction("focus_window", { windowId: "2" }),
    ).resolves.toMatchObject({ windowId: "2" });
  });
  it("still rejects binding PI itself", async () => {
    await expect(runComputerAction("focus_window", {})).rejects.toThrow(
      "自身窗口",
    );
    await expect(
      runComputerAction("focus_window", { windowId: "1" }),
    ).rejects.toThrow("自身窗口");
  });
  it("does not scroll for a zero delta", async () => {
    mock.active = mock.windows[1];
    mock.mouse.getPosition.mockResolvedValue({ x: 20, y: 20 });
    await runComputerAction("scroll", { expectedWindowId: "2", delta: 0 });
    expect(mock.mouse.scrollUp).not.toHaveBeenCalled();
    expect(mock.mouse.scrollDown).not.toHaveBeenCalled();
  });
});
