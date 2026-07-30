import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let sessionRootDir: string;

  beforeEach(() => {
    spawner = vi.fn((_cmd: string, _args: string[], _opts: object) => new FakeProcess()) as any;
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    sessionRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-process-test-"));
    manager = new ProcessManager({
      spawn: spawner as any,
      command: "pi",
      args: ["--rpc"],
      npmRegistry: "https://registry.npmjs.org/",
      sessionRootDir,
      logger: logger as any,
    });
  });

  afterEach(() => fs.rmSync(sessionRootDir, { recursive: true, force: true }));

  it("spawns a process on start", async () => {
    const p = await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    expect(p.sessionId).toBe("s1");
    expect(spawner).toHaveBeenCalledWith("pi", [
      "--rpc", "--session-dir", path.join(sessionRootDir, "s1"), "--name", "pi-web-ui:s1",
    ], expect.objectContaining({ cwd: "/tmp" }));
  });

  it("enables native Pi auto-compaction before callers can send a prompt", async () => {
    const child = new FakeProcess();
    spawner.mockReturnValueOnce(child);
    const writes: string[] = [];
    child.stdin.on("data", (chunk) => writes.push(chunk.toString()));

    await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });

    expect(writes).toEqual([
      JSON.stringify({ type: "set_auto_compaction", enabled: true }) + "\n",
    ]);
  });

  it("continues the isolated Pi JSONL session when one already exists", async () => {
    const sessionDir = path.join(sessionRootDir, "s2");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "previous.jsonl"), "{\"type\":\"session\"}\n");

    await manager.start({ sessionId: "s2", projectId: "p1", workdir: "/tmp" });

    const [, args] = spawner.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["--session-dir", sessionDir, "--continue"]));
    expect(args).not.toContain("--name");
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

  it("registers custom OpenAI-compatible model config with pi when a base URL is provided", async () => {
    await manager.start({
      sessionId: "s1",
      projectId: "p1",
      workdir: "/tmp",
      modelConfig: {
        provider: "openai",
        model: "glm-4.7",
        apiKey: "secret-key",
        apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4/",
      },
    });

    const [, args, opts] = spawner.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["--extension", expect.stringMatching(/pi-web-ui-model-.*\.mjs$/)]));
    expect(args).toEqual(expect.arrayContaining(["--provider", "openai", "--model", "glm-4.7"]));
    expect((opts as any).env.PI_WEB_UI_MODEL_API_KEY).toBe("secret-key");
  });

  it("uses provider-specific API key environment variables for built-in providers", async () => {
    await manager.start({
      sessionId: "s1",
      projectId: "p1",
      workdir: "/tmp",
      modelConfig: {
        provider: "zai",
        model: "glm-4.7",
        apiKey: "secret-key",
      },
    });

    const [, , opts] = spawner.mock.calls[0]!;
    expect((opts as any).env.ZAI_API_KEY).toBe("secret-key");
    expect((opts as any).env.OPENAI_API_KEY).not.toBe("secret-key");
  });

  it("does not register Anthropic base URLs as OpenAI-compatible extensions", async () => {
    await manager.start({
      sessionId: "s1",
      projectId: "p1",
      workdir: "/tmp",
      modelConfig: {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKey: "secret-key",
        apiBaseUrl: "https://anthropic-proxy.example/v1",
      },
    });

    const [, args, opts] = spawner.mock.calls[0]!;
    expect(args).not.toContain("--extension");
    expect((opts as any).env.ANTHROPIC_API_KEY).toBe("secret-key");
    expect((opts as any).env.ANTHROPIC_BASE_URL).toBe("https://anthropic-proxy.example/v1");
  });

  it("does not pass npm config variables through to child processes", async () => {
    const previousWorkspaceConcurrency = process.env.npm_config_workspace_concurrency;
    const previousRegistry = process.env.NPM_CONFIG_REGISTRY;
    process.env.npm_config_workspace_concurrency = "1";
    process.env.NPM_CONFIG_REGISTRY = "https://registry.npmmirror.com/";
    try {
      await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    } finally {
      if (previousWorkspaceConcurrency === undefined) delete process.env.npm_config_workspace_concurrency;
      else process.env.npm_config_workspace_concurrency = previousWorkspaceConcurrency;
      if (previousRegistry === undefined) delete process.env.NPM_CONFIG_REGISTRY;
      else process.env.NPM_CONFIG_REGISTRY = previousRegistry;
    }

    const [, , opts] = spawner.mock.calls[0]!;
    expect((opts as any).env.npm_config_workspace_concurrency).toBeUndefined();
    expect((opts as any).env.NPM_CONFIG_REGISTRY).toBeUndefined();
    expect((opts as any).env.npm_config_registry).toBe("https://registry.npmjs.org/");
  });

  it("filters npm warning noise from stderr but keeps real stderr lines", async () => {
    const child = new FakeProcess();
    spawner.mockReturnValueOnce(child);
    const proc = await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    const onStderr = vi.fn();
    proc.on("stderr", onStderr);

    child.stderr.write('npm warn Unknown env config "stream". This will stop working\n');
    child.stderr.write("npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead\n");
    child.stderr.write("real provider error\n");

    expect(onStderr).toHaveBeenCalledTimes(1);
    expect(onStderr).toHaveBeenCalledWith("real provider error");
  });
});
