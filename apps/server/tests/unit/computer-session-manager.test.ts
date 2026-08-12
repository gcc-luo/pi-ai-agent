import { describe, expect, it } from "vitest";
import {
  ComputerSessionManager,
  computerRisk,
} from "../../src/computer/computer-session-manager.js";
import {
  isComputerPlatformSupported,
  isUnsupportedWindowFocusError,
  parseComputerKeyCombo,
} from "../../src/computer/computer-driver.js";
import { Key } from "@nut-tree-fork/nut-js";

describe("Computer Use risk classification", () => {
  it("supports the three desktop platforms", () => {
    expect(isComputerPlatformSupported("darwin")).toBe(true);
    expect(isComputerPlatformSupported("win32")).toBe(true);
    expect(isComputerPlatformSupported("linux")).toBe(true);
    expect(isComputerPlatformSupported("freebsd")).toBe(false);
  });

  it("normalizes portable keyboard shortcuts", async () => {
    expect(await parseComputerKeyCombo("Cmd+Shift+S")).toEqual([
      Key.LeftSuper,
      Key.LeftShift,
      Key.S,
    ]);
    expect(await parseComputerKeyCombo("Ctrl+Alt+Delete")).toEqual([
      Key.LeftControl,
      Key.LeftAlt,
      Key.Delete,
    ]);
    await expect(parseComputerKeyCombo("HyperKey")).rejects.toThrow("不支持的按键");
  });

  it("recognizes the unimplemented macOS focus capability", () => {
    expect(isUnsupportedWindowFocusError(
      new Error("Method focusWindow is not implemented"),
    )).toBe(true);
    expect(isUnsupportedWindowFocusError(new Error("accessibility permission denied"))).toBe(false);
  });

  it("blocks destructive keyboard and intent operations without confirmation", () => {
    expect(computerRisk("key", { key: "Alt+F4", intent: "关闭未保存文档" })).toMatchObject({
      level: "destructive",
    });
    expect(computerRisk("click", { intent: "提交正式表单" })).toMatchObject({
      level: "sensitive",
    });
  });

  it("keeps ordinary navigation operations normal", () => {
    expect(computerRisk("click", { intent: "切换到 Word 编辑区域" })).toEqual({
      level: "normal",
      reason: null,
    });
  });

  it("requires auditable intent for every desktop input", () => {
    expect(computerRisk("click", {})).toMatchObject({
      level: "sensitive",
    });
    expect(computerRisk("key", { key: "Enter" })).toMatchObject({
      level: "sensitive",
    });
  });

  it("requires a focused target window before desktop input", async () => {
    const manager = new ComputerSessionManager({
      error: () => undefined,
    } as never);

    await expect(manager.execute({
      sessionId: "session-a",
      workdir: ".",
      action: "click",
      args: { x: 10, y: 10, intent: "点击编辑区域" },
    })).rejects.toThrow("必须先调用 computer_focus_window");
  });

  it("invalidates queued work when its session is closed", async () => {
    const manager = new ComputerSessionManager({
      error: () => undefined,
    } as never);
    const first = manager.execute({
      sessionId: "session-a",
      workdir: ".",
      action: "wait",
      args: { timeoutMs: 100 },
    });
    const queued = manager.execute({
      sessionId: "session-a",
      workdir: ".",
      action: "wait",
      args: { timeoutMs: 0 },
    });

    manager.closeSession("session-a");

    const results = await Promise.allSettled([first, queued]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
  });
});
