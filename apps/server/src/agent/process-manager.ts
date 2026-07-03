import { ChildProcess, spawn, SpawnOptions as NodeSpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { ServerEvent } from "@pi-web-ui/shared";
import { AgentProcess, SpawnOptions } from "./types.js";

type Spawner = (cmd: string, args: string[], opts: NodeSpawnOptions) => ChildProcess;

export interface ProcessManagerOptions {
  spawn?: Spawner;
  command: string;
  args: string[];
}

export class ProcessManager extends EventEmitter {
  private procs = new Map<string, AgentProcess>();
  private spawn: Spawner;
  private command: string;
  private args: string[];

  constructor(opts: ProcessManagerOptions) {
    super();
    this.spawn = opts.spawn ?? ((c, a, o) => spawn(c, a, o) as ChildProcess);
    this.command = opts.command;
    this.args = opts.args;
  }

  async start(input: { sessionId: string; projectId: string; workdir: string }): Promise<AgentProcess> {
    const existing = this.procs.get(input.sessionId);
    if (existing && existing.status !== "crashed" && existing.status !== "suspended") {
      return existing;
    }
    const child = this.spawn(this.command, this.args, {
      cwd: input.workdir,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PI_RPC: "1" },
    });

    const proc: AgentProcess = new EventEmitter() as unknown as AgentProcess;
    Object.assign(proc, {
      sessionId: input.sessionId,
      projectId: input.projectId,
      workdir: input.workdir,
      stdin: child.stdin!,
      stdout: child.stdout!,
      pid: child.pid,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      status: "starting" as const,
      writeCommand(cmd: object) {
        child.stdin!.write(JSON.stringify(cmd) + "\n");
      },
      kill() { child.kill("SIGTERM"); },
    });

    child.stdout!.on("data", () => { proc.lastActivityAt = Date.now(); });
    child.stderr!.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      line.split("\n").filter(Boolean).forEach((l) => (proc as unknown as EventEmitter).emit("stderr", l));
    });
    child.on("exit", (code: number | null) => {
      proc.status = code === 0 ? "suspended" : "crashed";
      (proc as unknown as EventEmitter).emit("exit", code);
    });

    this.procs.set(input.sessionId, proc);
    proc.status = "active";
    return proc;
  }

  get(sessionId: string): AgentProcess | undefined {
    return this.procs.get(sessionId);
  }

  stop(sessionId: string): void {
    const p = this.procs.get(sessionId);
    if (p) p.kill();
  }

  async shutdown(): Promise<void> {
    for (const p of this.procs.values()) p.kill();
    this.procs.clear();
  }
}
