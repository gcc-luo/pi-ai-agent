import { describe, expect, it, vi } from "vitest";
import { removeSessionAfterWorkspaceCleanup } from "./session-deletion.js";

describe("session deletion workspace cleanup", () => {
  it("waits for cleanup failure, reports it, and still removes the session", async () => {
    const steps: string[] = [];
    let rejectCleanup: ((error: Error) => void) | undefined;
    const disposeAll = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectCleanup = reject;
      steps.push("dispose");
    }));
    const removeSession = vi.fn(async () => { steps.push("remove"); });
    const reportCleanupFailure = vi.fn(() => { steps.push("report"); });

    const deletion = removeSessionAfterWorkspaceCleanup(disposeAll, removeSession, reportCleanupFailure);
    await Promise.resolve();
    expect(removeSession).not.toHaveBeenCalled();

    rejectCleanup?.(new Error("panel cleanup failed"));
    await deletion;

    expect(disposeAll).toHaveBeenCalledOnce();
    expect(reportCleanupFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "panel cleanup failed" }));
    expect(removeSession).toHaveBeenCalledOnce();
    expect(steps).toEqual(["dispose", "report", "remove"]);
  });
});
