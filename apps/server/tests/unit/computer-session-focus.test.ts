import { beforeEach, describe, expect, it, vi } from "vitest";

const { runComputerAction } = vi.hoisted(() => ({
  runComputerAction: vi.fn(),
}));

vi.mock("../../src/computer/computer-driver.js", () => ({
  isComputerPlatformSupported: () => true,
  runComputerAction,
}));

import { ComputerSessionManager } from "../../src/computer/computer-session-manager.js";

describe("Computer Use window binding", () => {
  beforeEach(() => {
    runComputerAction.mockReset();
  });

  it("binds the active window returned by focus_window", async () => {
    runComputerAction
      .mockResolvedValueOnce({
        ok: true,
        windowId: "window-active",
        title: "微信",
        activation: "bound_active",
      })
      .mockResolvedValueOnce({ ok: true, x: 20, y: 30 });

    const manager = new ComputerSessionManager({ error: () => undefined } as never);
    await manager.execute({
      sessionId: "session-a",
      workdir: ".",
      action: "focus_window",
      args: { intent: "绑定当前微信窗口" },
    });
    await manager.execute({
      sessionId: "session-a",
      workdir: ".",
      action: "click",
      args: { x: 20, y: 30, intent: "点击微信搜索框" },
    });

    expect(runComputerAction).toHaveBeenNthCalledWith(
      2,
      "click",
      expect.objectContaining({ expectedWindowId: "window-active" }),
      expect.any(AbortSignal),
    );
  });

  it("does not bind a window when focus_window fails", async () => {
    runComputerAction.mockRejectedValueOnce(new Error("请先将该窗口切换到前台"));

    const manager = new ComputerSessionManager({ error: () => undefined } as never);
    await expect(manager.execute({
      sessionId: "session-a",
      workdir: ".",
      action: "focus_window",
      args: { windowId: "window-wechat", intent: "激活微信" },
    })).rejects.toThrow("切换到前台");

    await expect(manager.execute({
      sessionId: "session-a",
      workdir: ".",
      action: "type",
      args: { text: "你好", intent: "输入消息" },
    })).rejects.toThrow("必须先调用 computer_focus_window");
  });
});
