import { describe, it, expect, vi } from "vitest";
import { IdleSweeper } from "../../src/agent/idle-sweeper.js";

describe("IdleSweeper", () => {
  it("marks a session idle after idleTimeout", async () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const onSuspend = vi.fn();
    const sweeper = new IdleSweeper({
      idleTimeoutMs: 1000,
      suspendedTimeoutMs: 2000,
      onIdle, onSuspend,
    });
    sweeper.track("s1", { lastActivityAt: Date.now() });
    vi.advanceTimersByTime(1500);
    expect(onIdle).toHaveBeenCalledWith("s1");
    vi.advanceTimersByTime(1000);
    expect(onSuspend).toHaveBeenCalledWith("s1");
    sweeper.stop();
    vi.useRealTimers();
  });
});
