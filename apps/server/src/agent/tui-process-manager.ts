import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as pty from "node-pty";
import type { FastifyBaseLogger } from "fastify";
import { API_KEY_ENV_BY_PROVIDER, createCustomModelExtension, type ModelConfig } from "./process-manager.js";
import { piSessionDirectory, preparePiSession, removePiSession } from "./pi-session-store.js";

export interface TuiProcess extends EventEmitter {
  sessionId: string;
  projectId: string;
  workdir: string;
  pid: number;
  startedAt: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** Terminal bytes emitted before a browser client attaches. */
  history(): string;
}

export interface TuiProcessManagerOptions {
  command: string;
  args: string[];
  provider?: string;
  model?: string;
  /** Isolated Pi session directories, one per Web UI conversation. */
  sessionRootDir: string;
  logger: FastifyBaseLogger;
}

const MAX_TERMINAL_HISTORY_BYTES = 1_500_000;

function cleanEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("npm_config_") || key === "PI_RPC" || value === undefined) continue;
    env[key] = value;
  }
  return env;
}

function dimensions(cols: number, rows: number) {
  return {
    cols: Math.max(20, Math.min(400, Math.floor(cols) || 120)),
    rows: Math.max(5, Math.min(200, Math.floor(rows) || 36)),
  };
}

function resolveExecutable(command: string, searchPath: string | undefined): string {
  if (path.isAbsolute(command) || command.includes(path.sep)) return command;
  for (const directory of (searchPath ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    if (fs.existsSync(candidate)) return candidate;
  }
  return command;
}

function redactSensitiveTerminalOutput(data: string, apiKey?: string | null): string {
  let safe = data;
  if (apiKey) safe = safe.split(apiKey).join("[REDACTED_API_KEY]");
  // Some providers echo only a prefix followed by masking characters.
  return safe
    .replace(/sk-[A-Za-z0-9_-]+\*{3,}/g, "sk-***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "$1[REDACTED]");
}

/**
 * Keeps Pi's native interactive TUI in a PTY. The browser only transports
 * terminal bytes, so Pi retains ownership of shortcuts, rendering and state.
 */
export class TuiProcessManager {
  private readonly procs = new Map<string, TuiProcess>();

  constructor(private readonly options: TuiProcessManagerOptions) {}

  start(input: {
    sessionId: string;
    projectId: string;
    workdir: string;
    cols: number;
    rows: number;
    modelConfig?: ModelConfig;
  }): TuiProcess {
    const existing = this.procs.get(input.sessionId);
    if (existing) return existing;

    const modelConfig = input.modelConfig;
    const provider = modelConfig?.provider ?? this.options.provider;
    const model = modelConfig?.model ?? this.options.model;
    const extraArgs: string[] = [];
    // Pi's built-in OpenAI catalog does not know every OpenAI-compatible
    // model. Register the stored model and endpoint exactly as RPC mode does.
    if (modelConfig?.apiBaseUrl && provider && provider !== "anthropic" && model) {
      extraArgs.push("--extension", createCustomModelExtension({
        provider,
        model,
        apiBaseUrl: modelConfig.apiBaseUrl,
        modelType: modelConfig.modelType,
      }));
    }
    const piSession = preparePiSession(this.options.sessionRootDir, input.sessionId);
    const args = [...this.options.args, ...extraArgs, ...piSession.args];
    if (provider) args.push("--provider", provider);
    if (model) args.push("--model", model);

    const env = cleanEnv(process.env);
    if (modelConfig?.apiKey) {
      env.PI_WEB_UI_MODEL_API_KEY = modelConfig.apiKey;
      env[API_KEY_ENV_BY_PROVIDER[provider ?? ""] ?? "OPENAI_API_KEY"] = modelConfig.apiKey;
    }
    if (modelConfig?.apiBaseUrl) {
      env[provider === "anthropic" ? "ANTHROPIC_BASE_URL" : "OPENAI_BASE_URL"] = modelConfig.apiBaseUrl;
    }

    const size = dimensions(input.cols, input.rows);
    const command = resolveExecutable(this.options.command, env.PATH);
    const proc = new EventEmitter() as unknown as TuiProcess;
    let outputHistory = "";
    const emitOutput = (data: string) => {
      outputHistory += data;
      if (Buffer.byteLength(outputHistory) > MAX_TERMINAL_HISTORY_BYTES) {
        // Keep a bounded amount of raw terminal output so a reconnect can
        // reconstruct the current Pi screen without growing server memory.
        outputHistory = outputHistory.slice(-MAX_TERMINAL_HISTORY_BYTES);
      }
      proc.emit("data", data);
    };
    const assign = (pid: number, write: (data: string) => void, resize: (cols: number, rows: number) => void, kill: () => void) => {
      Object.assign(proc, {
        sessionId: input.sessionId,
        projectId: input.projectId,
        workdir: input.workdir,
        pid,
        startedAt: Date.now(),
        write,
        resize,
        kill,
        history: () => outputHistory,
      });
    };

    try {
      const terminal = pty.spawn(command, args, {
        name: process.platform === "win32" ? "xterm" : "xterm-256color",
        cols: size.cols,
        rows: size.rows,
        cwd: input.workdir,
        env,
        useConpty: process.platform === "win32",
      });
      assign(
        terminal.pid,
        (data) => terminal.write(data),
        (cols, rows) => {
          const next = dimensions(cols, rows);
          terminal.resize(next.cols, next.rows);
        },
        () => terminal.kill(),
      );
      terminal.onData((data) => emitOutput(redactSensitiveTerminalOutput(data, modelConfig?.apiKey)));
      terminal.onExit(({ exitCode, signal }) => {
        this.procs.delete(input.sessionId);
        proc.emit("exit", exitCode, signal);
      });
    } catch (error) {
      // The macOS sandbox used by some desktop launchers blocks openpty(),
      // while the system `script` utility is still permitted to allocate one.
      // Pi receives a real terminal either way; resize is fixed at launch for
      // this fallback, using COLUMNS and LINES as its initial dimensions.
      if (process.platform !== "darwin") throw error;
      const fallbackEnv = { ...env, TERM: "xterm-256color", COLUMNS: String(size.cols), LINES: String(size.rows) };
      const child = spawn("/usr/bin/script", ["-q", "/dev/null", command, ...args], {
        cwd: input.workdir,
        env: fallbackEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (!child.stdin || !child.stdout) throw error;
      assign(
        child.pid ?? -1,
        (data) => child.stdin!.write(data),
        () => {},
        () => child.kill("SIGTERM"),
      );
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data: string) => emitOutput(redactSensitiveTerminalOutput(data, modelConfig?.apiKey)));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (data: string) => emitOutput(`\x1b[31m${redactSensitiveTerminalOutput(data, modelConfig?.apiKey)}\x1b[0m`));
      child.once("exit", (exitCode, signal) => {
        this.procs.delete(input.sessionId);
        proc.emit("exit", exitCode ?? 1, typeof signal === "string" ? undefined : signal ?? undefined);
      });
      child.once("error", (spawnError) => {
        this.procs.delete(input.sessionId);
        emitOutput(`\x1b[31m${spawnError.message}\x1b[0m`);
        proc.emit("exit", 1);
      });
      this.options.logger.warn({ err: error, sessionId: input.sessionId }, "node-pty unavailable; using script PTY fallback");
    }
    this.procs.set(input.sessionId, proc);
    this.options.logger.info({ sessionId: input.sessionId, pid: proc.pid, command, args }, "spawned Pi TUI process");
    return proc;
  }

  get(sessionId: string): TuiProcess | undefined {
    return this.procs.get(sessionId);
  }

  values(): IterableIterator<TuiProcess> {
    return this.procs.values();
  }

  stop(sessionId: string): void {
    this.procs.get(sessionId)?.kill();
  }

  async stopAndWait(sessionId: string, timeoutMs = 2_000): Promise<void> {
    const proc = this.procs.get(sessionId);
    if (!proc) return;
    await new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const onExit = () => done();
      const done = () => {
        if (timer) clearTimeout(timer);
        proc.off("exit", onExit);
        resolve();
      };
      proc.on("exit", onExit);
      timer = setTimeout(done, timeoutMs);
      proc.kill();
    });
  }

  removeSessionHistory(sessionId: string): void {
    removePiSession(this.options.sessionRootDir, sessionId);
  }

  sessionDirectory(sessionId: string): string {
    return piSessionDirectory(this.options.sessionRootDir, sessionId);
  }

  async shutdown(): Promise<void> {
    for (const proc of this.procs.values()) proc.kill();
    this.procs.clear();
  }
}
