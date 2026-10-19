import * as nodePty from "node-pty";
import type { IPty, IPtyForkOptions } from "node-pty";
import type { FastifyBaseLogger } from "fastify";

const MAX_REPLAY_BYTES = 256 * 1024;
const MIN_COLS = 20;
const MAX_COLS = 300;
const MIN_ROWS = 5;
const MAX_ROWS = 100;

function trimUtf8ToByteLimit(output: Buffer, maxBytes: number): Buffer {
  if (output.byteLength <= maxBytes) return output;

  let start = output.byteLength - maxBytes;
  while (start < output.byteLength && (output[start]! & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return output.subarray(start);
}

export type TerminalExitMessage = {
  type: "exit";
  exitCode: number;
  signal: number;
};

export type TerminalDataSubscriber = (data: Buffer) => void;
export type TerminalExitSubscriber = (event: TerminalExitMessage) => void;
export type TerminalCloseSubscriber = () => void;

type SpawnPty = (file: string, args: string[], options: IPtyForkOptions) => IPty;

type TerminalSession = {
  pty: IPty;
  output: Buffer;
  exited: TerminalExitMessage | null;
  closed: boolean;
  subscribers: Set<{
    data: TerminalDataSubscriber;
    exit: TerminalExitSubscriber;
    close: TerminalCloseSubscriber;
  }>;
  dataSubscription: { dispose(): void };
  exitSubscription: { dispose(): void };
};

export type TerminalSessionManagerOptions = {
  logger: FastifyBaseLogger;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnPty;
};

/** Owns one interactive terminal process per chat session. */
export class TerminalSessionManager {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly spawnPty: SpawnPty;
  private shuttingDown = false;

  constructor(private readonly options: TerminalSessionManagerOptions) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.spawnPty = options.spawn ?? nodePty.spawn;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  ensure(sessionId: string, projectWorkdir: string): void {
    if (this.shuttingDown) throw new Error("terminal manager is shutting down");
    if (this.sessions.has(sessionId)) return;

    const shell = this.platform === "win32"
      ? this.env.COMSPEC || "cmd.exe"
      : this.env.SHELL || "/bin/sh";
    const pty = this.spawnPty(shell, [], {
      cwd: projectWorkdir,
      cols: 80,
      rows: 24,
      name: "xterm-256color",
      env: { ...process.env, ...this.env, TERM: "xterm-256color" },
    });
    const session: TerminalSession = {
      pty,
      output: Buffer.alloc(0),
      exited: null,
      closed: false,
      subscribers: new Set(),
      dataSubscription: { dispose() {} },
      exitSubscription: { dispose() {} },
    };
    session.dataSubscription = pty.onData((data) => {
      if (session.closed || this.sessions.get(sessionId) !== session) return;
      const bytes = Buffer.from(data, "utf8");
      session.output = trimUtf8ToByteLimit(Buffer.concat([session.output, bytes]), MAX_REPLAY_BYTES);
      for (const subscriber of session.subscribers) {
        try { subscriber.data(bytes); }
        catch (error) { this.options.logger.warn({ err: error, sessionId }, "terminal output subscriber failed"); }
      }
    });
    session.exitSubscription = pty.onExit((event) => {
      if (session.closed || session.exited) return;
      session.exited = {
        type: "exit",
        exitCode: Number.isFinite(event.exitCode) ? event.exitCode : 1,
        signal: Number.isFinite(event.signal) ? event.signal! : 0,
      };
      for (const subscriber of session.subscribers) {
        try { subscriber.exit(session.exited); }
        catch (error) { this.options.logger.warn({ err: error, sessionId }, "terminal exit subscriber failed"); }
      }
    });
    this.sessions.set(sessionId, session);
  }

  /** Attach a live socket and synchronously replay the bounded output first. */
  subscribe(
    sessionId: string,
    data: TerminalDataSubscriber,
    exit: TerminalExitSubscriber = () => undefined,
    close: TerminalCloseSubscriber = () => undefined,
  ): () => void {
    const session = this.requireSession(sessionId);
    const subscriber = { data, exit, close };
    if (session.output.byteLength > 0) data(Buffer.from(session.output));
    session.subscribers.add(subscriber);
    if (session.exited) exit(session.exited);
    return () => session.subscribers.delete(subscriber);
  }

  write(sessionId: string, data: string): void {
    const session = this.requireSession(sessionId);
    if (session.exited) return;
    session.pty.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.requireSession(sessionId);
    if (!Number.isInteger(cols) || cols < MIN_COLS || cols > MAX_COLS
      || !Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
      throw new RangeError("terminal dimensions are outside the allowed range");
    }
    if (!session.exited) session.pty.resize(cols, rows);
  }

  recentOutput(sessionId: string): Buffer {
    const output = this.sessions.get(sessionId)?.output;
    return output ? Buffer.from(output) : Buffer.alloc(0);
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.closed = true;
    this.sessions.delete(sessionId);
    session.dataSubscription.dispose();
    session.exitSubscription.dispose();
    for (const subscriber of [...session.subscribers]) {
      try { subscriber.close(); }
      catch (error) { this.options.logger.warn({ err: error, sessionId }, "terminal close subscriber failed"); }
    }
    session.subscribers.clear();
    session.output = Buffer.alloc(0);
    if (!session.exited) {
      try { session.pty.kill(); }
      catch (error) { this.options.logger.warn({ err: error, sessionId }, "failed to stop terminal PTY"); }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.close(sessionId)));
  }

  private requireSession(sessionId: string): TerminalSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) throw new Error("terminal session is not running");
    return session;
  }
}
