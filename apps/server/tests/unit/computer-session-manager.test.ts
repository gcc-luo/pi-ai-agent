import { describe, expect, it } from "vitest";
import {
  ComputerSessionManager,
  computerRisk,
} from "../../src/computer/computer-session-manager.js";

describe("Computer Use risk classification", () => {
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
