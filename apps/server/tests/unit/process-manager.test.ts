import { describe, it, expect, beforeEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { ProcessManager } from "../../src/agent/process-manager.js";

class FakeProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 1234;
  killed = false;
  kill() { this.killed = true; this.emit("exit", null); }
}

describe("ProcessManager", () => {
  let spawner: ReturnType<typeof vi.fn>;
  let manager: ProcessManager;

  beforeEach(() => {
    spawner = vi.fn((_cmd: string, _args: string[], _opts: object) => new FakeProcess()) as any;
    manager = new ProcessManager({ spawn: spawner as any, command: "pi", args: ["--rpc"] });
  });

  it("spawns a process on start", async () => {
    const p = await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    expect(p.sessionId).toBe("s1");
    expect(spawner).toHaveBeenCalledWith("pi", ["--rpc"], expect.objectContaining({ cwd: "/tmp" }));
  });

  it("returns the same process on get", async () => {
    const p = await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    expect(manager.get("s1")).toBe(p);
  });

  it("stops the process on stop", async () => {
    const proc = new FakeProcess();
    spawner.mockReturnValueOnce(proc);
    await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    manager.stop("s1");
    expect(proc.killed).toBe(true);
  });

  it("marks the process crashed when exit code != 0", async () => {
    const proc = new FakeProcess();
    spawner.mockReturnValueOnce(proc);
    await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    proc.emit("exit", 1);
    expect(manager.get("s1")?.status).toBe("crashed");
  });

  it("stops all processes on shutdown", async () => {
    const a = new FakeProcess();
    const b = new FakeProcess();
    spawner.mockReturnValueOnce(a).mockReturnValueOnce(b);
    await manager.start({ sessionId: "a", projectId: "p", workdir: "/tmp" });
    await manager.start({ sessionId: "b", projectId: "p", workdir: "/tmp" });
    await manager.shutdown();
    expect(a.killed).toBe(true);
    expect(b.killed).toBe(true);
  });
});
