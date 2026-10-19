import { describe, expect, it, vi } from "vitest";
import type { IPty, IPtyForkOptions } from "node-pty";
import { TerminalSessionManager } from "../../src/terminal/terminal-session-manager.js";

type DataHandler = (data: string) => void;
type ExitHandler = (event: { exitCode: number; signal?: number }) => void;

class FakePty {
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  kills = 0;
  dataHandlers: DataHandler[] = [];
  exitHandlers: ExitHandler[] = [];

  write(data: string) { this.writes.push(data); }
  resize(cols: number, rows: number) { this.resizes.push([cols, rows]); }
  kill() { this.kills += 1; }
  onData(handler: DataHandler) {
    this.dataHandlers.push(handler);
    return { dispose: () => { this.dataHandlers = this.dataHandlers.filter((item) => item !== handler); } };
  }
  onExit(handler: ExitHandler) {
    this.exitHandlers.push(handler);
    return { dispose: () => { this.exitHandlers = this.exitHandlers.filter((item) => item !== handler); } };
  }
  emitData(value: string) { for (const handler of this.dataHandlers) handler(value); }
  emitExit(exitCode: number, signal?: number) {
    for (const handler of this.exitHandlers) handler({ exitCode, signal });
  }
}

const logger = { warn: vi.fn(), error: vi.fn() } as never;

function fixture(platform: NodeJS.Platform = "linux", env: NodeJS.ProcessEnv = {}) {
  const processes: FakePty[] = [];
  const spawn = vi.fn((_file: string, _args: string[], _options: IPtyForkOptions) => {
    const pty = new FakePty();
    processes.push(pty);
    return pty as unknown as IPty;
  });
  const manager = new TerminalSessionManager({ logger, platform, env, spawn });
  return { manager, spawn, processes };
}

describe("TerminalSessionManager", () => {
  it("starts one PTY per session with the platform shell and project workdir", async () => {
    const windows = fixture("win32", { COMSPEC: "C:\\Windows\\System32\\cmd.exe" });
    await windows.manager.ensure("session-a", "C:\\projects\\alpha");
    await windows.manager.ensure("session-a", "C:\\projects\\ignored");

    expect(windows.spawn).toHaveBeenCalledTimes(1);
    expect(windows.spawn).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\cmd.exe",
      [],
      expect.objectContaining({
        cwd: "C:\\projects\\alpha",
        cols: 80,
        rows: 24,
        name: "xterm-256color",
        env: expect.objectContaining({ TERM: "xterm-256color" }),
      }),
    );

    const unix = fixture("linux", { SHELL: "/bin/zsh", TERM: "screen" });
    await unix.manager.ensure("session-a", "/projects/alpha");
    await unix.manager.ensure("session-b", "/projects/beta");
    expect(unix.spawn).toHaveBeenNthCalledWith(1, "/bin/zsh", [], expect.objectContaining({ cwd: "/projects/alpha" }));
    expect(unix.spawn).toHaveBeenNthCalledWith(2, "/bin/zsh", [], expect.objectContaining({ cwd: "/projects/beta" }));
    expect(unix.spawn.mock.calls[0]![2].env).toEqual(expect.objectContaining({ TERM: "xterm-256color" }));
  });

  it("replays only the newest 256 KiB before broadcasting live output", async () => {
    const { manager, processes } = fixture();
    await manager.ensure("session-a", "/project");
    const pty = processes[0]!;
    const prior = Buffer.alloc(256 * 1024 + 8, "a").toString();
    pty.emitData(prior);

    const received: Buffer[] = [];
    const disconnect = manager.subscribe("session-a", (data) => received.push(data));
    expect(Buffer.concat(received)).toEqual(Buffer.from(prior).subarray(-256 * 1024));

    received.length = 0;
    pty.emitData("live");
    expect(Buffer.concat(received).toString()).toBe("live");
    disconnect();
    pty.emitData("offline");
    expect(Buffer.concat(received).toString()).toBe("live");
    expect(pty.kills).toBe(0);
  });

  it("starts replay at a complete UTF-8 code point when trimming the output limit", async () => {
    for (const prefix of ["¢", "€", "🙂"]) {
      const { manager, processes } = fixture();
      await manager.ensure("session-a", "/project");
      const pty = processes[0]!;
      const trailing = "a".repeat(256 * 1024 + 1 - Buffer.byteLength(prefix));
      pty.emitData(prefix + trailing);

      const recent = manager.recentOutput("session-a");
      expect(recent.byteLength).toBeLessThanOrEqual(256 * 1024);
      expect(recent.toString("utf8").startsWith("a")).toBe(true);
      expect(recent.byteLength).toBe(trailing.length);
    }
  });

  it("forwards input and validated terminal dimensions to the PTY", async () => {
    const { manager, processes } = fixture();
    await manager.ensure("session-a", "/project");
    manager.write("session-a", "ls\r");
    manager.resize("session-a", 120, 40);
    expect(processes[0]!.writes).toEqual(["ls\r"]);
    expect(processes[0]!.resizes).toEqual([[120, 40]]);
    expect(() => manager.resize("session-a", 10, 40)).toThrow();
    expect(() => manager.resize("session-a", 120, 101)).toThrow();
  });

  it("keeps exited sessions replayable until explicitly closed and never respawns on reconnect", async () => {
    const { manager, spawn, processes } = fixture();
    await manager.ensure("session-a", "/project");
    const pty = processes[0]!;
    pty.emitData("done\r\n");
    pty.emitExit(7, 15);

    const output: Buffer[] = [];
    const exits: unknown[] = [];
    const disconnect = manager.subscribe("session-a", (data) => output.push(data), (exit) => exits.push(exit));
    expect(Buffer.concat(output).toString()).toBe("done\r\n");
    expect(exits).toEqual([{ type: "exit", exitCode: 7, signal: 15 }]);
    await manager.ensure("session-a", "/project");
    expect(spawn).toHaveBeenCalledTimes(1);
    disconnect();
    await manager.close("session-a");
    expect(pty.kills).toBe(0);
    await manager.ensure("session-a", "/project");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("kills all PTYs during shutdown and removes their replay buffers", async () => {
    const { manager, processes } = fixture();
    await manager.ensure("session-a", "/project/a");
    await manager.ensure("session-b", "/project/b");
    processes[0]!.emitData("one");
    processes[1]!.emitData("two");

    await manager.shutdown();

    expect(processes.map((pty) => pty.kills)).toEqual([1, 1]);
    expect(manager.recentOutput("session-a")).toEqual(Buffer.alloc(0));
    expect(() => manager.ensure("session-a", "/project/a")).toThrow("shutting down");
    expect(processes).toHaveLength(2);
  });

  it("notifies attached sockets when a session terminal is closed", async () => {
    const { manager, processes } = fixture();
    await manager.ensure("session-a", "/project");
    const closed = vi.fn();
    manager.subscribe("session-a", vi.fn(), vi.fn(), closed);

    await manager.close("session-a");

    expect(closed).toHaveBeenCalledOnce();
    expect(processes[0]!.kills).toBe(1);
  });
});
