import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProcessManager, shouldUseWindowsShell } from "../../src/agent/process-manager.js";

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
      killProcessTree: (child) => child.kill(),
      command: "pi",
      args: ["--rpc"],
      npmRegistry: "https://registry.npmjs.org/",
      sessionRootDir,
      browserExtensionPath: "browser-tools.ts",
      browserEndpoint: "http://127.0.0.1:8080/api/internal/browser",
      pluginExtensions: {
        "browser-use": "browser-tools.ts",
        "computer-use": "computer-tools.ts",
      },
      pluginEndpoint: "http://127.0.0.1:8080/api/internal/plugins",
      validateWorkdir: false,
      logger: logger as any,
    });
  });

  afterEach(() => fs.rmSync(sessionRootDir, { recursive: true, force: true }));

  it("does not use cmd.exe for a bundled Node path containing spaces", () => {
    expect(shouldUseWindowsShell("D:\\pi\\PI AI Agent\\pi-node.exe", "win32")).toBe(false);
  });

  it("keeps shell support for Windows npx command shims", () => {
    expect(shouldUseWindowsShell("npx", "win32")).toBe(true);
    expect(shouldUseWindowsShell("C:\\tools\\npx.cmd", "win32")).toBe(true);
  });

  it("spawns a process on start", async () => {
    const p = await manager.start({ sessionId: "s1", projectId: "p1", workdir: "/tmp" });
    expect(p.sessionId).toBe("s1");
    expect(spawner).toHaveBeenCalledWith("pi", [
      "--rpc", "--session-dir", path.join(sessionRootDir, "s1"), "--name", "pi-web-ui:s1",
    ], expect.objectContaining({ cwd: "/tmp" }));
  });

  it("reports a missing project workdir before spawning the agent", async () => {
    const validatingManager = new ProcessManager({
      spawn: spawner as any,
      command: "pi",
      args: ["--rpc"],
      sessionRootDir,
      logger: logger as any,
    });
    const missing = path.join(sessionRootDir, "missing-workdir");

    await expect(validatingManager.start({
      sessionId: "missing",
      projectId: "p1",
      workdir: missing,
    })).rejects.toThrow(`项目工作目录不存在或不可访问：${missing}`);
    expect(spawner).not.toHaveBeenCalled();
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
    expect(manager.get("s1")?.status).toBe("suspended");
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

  it("issues an isolated browser bridge token for each enabled session", async () => {
    await manager.start({
      sessionId: "browser-a", projectId: "p1", workdir: "/tmp", browserEnabled: true,
    });
    await manager.start({
      sessionId: "browser-b", projectId: "p1", workdir: "/tmp", browserEnabled: true,
    });

    const firstEnv = (spawner.mock.calls[0]![2] as {
      env: Record<string, string | undefined>;
    }).env;
    const secondEnv = (spawner.mock.calls[1]![2] as {
      env: Record<string, string | undefined>;
    }).env;
    const firstToken = String(firstEnv.PI_WEB_UI_BROWSER_TOKEN);
    const secondToken = String(secondEnv.PI_WEB_UI_BROWSER_TOKEN);
    expect(firstToken).not.toBe(secondToken);
    expect(manager.validateBrowserToken("browser-a", firstToken)).toBe(true);
    expect(manager.validateBrowserToken("browser-a", secondToken)).toBe(false);
    expect(manager.validateBrowserToken("browser-b", firstToken)).toBe(false);
  });

  it("revokes plugin credentials immediately without waiting for process exit", async () => {
    await manager.start({
      sessionId: "plugins", projectId: "p1", workdir: "/tmp", browserEnabled: true,
    });
    const env = (spawner.mock.calls[0]![2] as {
      env: Record<string, string | undefined>;
    }).env;

    expect(manager.validatePluginToken(
      "plugins", "browser-use", env.PI_WEB_UI_PLUGIN_TOKEN,
    )).toBe(true);
    manager.revokePluginToken("plugins");
    expect(manager.validatePluginToken(
      "plugins", "browser-use", env.PI_WEB_UI_PLUGIN_TOKEN,
    )).toBe(false);
  });

  it("restarts the Pi process when browser tool availability changes", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    spawner.mockReturnValueOnce(first).mockReturnValueOnce(second);
    await manager.start({
      sessionId: "s1", projectId: "p1", workdir: "/tmp", browserEnabled: false,
    });
    const restarted = await manager.start({
      sessionId: "s1", projectId: "p1", workdir: "/tmp", browserEnabled: true,
    });

    expect(first.killed).toBe(true);
    expect(restarted.browserEnabled).toBe(true);
    expect(spawner).toHaveBeenCalledTimes(2);
  });

  it("loads only the extensions selected for the current session", async () => {
    const proc = await manager.start({
      sessionId: "plugins",
      projectId: "p1",
      workdir: "/tmp",
      activePluginIds: ["computer-use"],
    });
    const args = spawner.mock.calls[0]![1] as string[];
    const env = (spawner.mock.calls[0]![2] as {
      env: Record<string, string | undefined>;
    }).env;
    expect(args).toContain("computer-tools.ts");
    expect(args).not.toContain("browser-tools.ts");
    expect(proc.activePluginIds).toEqual(["computer-use"]);
    expect(env.PI_WEB_UI_PLUGIN_ENDPOINT).toContain("/api/internal/plugins");
    expect(manager.validatePluginToken(
      "plugins", "computer-use", env.PI_WEB_UI_PLUGIN_TOKEN,
    )).toBe(true);
  });

  it("issues independent credentials when multiple plugins are selected", async () => {
    await manager.start({
      sessionId: "plugins",
      projectId: "p1",
      workdir: "/tmp",
      activePluginIds: ["browser-use", "computer-use"],
    });
    const env = (spawner.mock.calls[0]![2] as {
      env: Record<string, string | undefined>;
    }).env;

    expect(env.PI_WEB_UI_PLUGIN_TOKEN).toBeUndefined();
    expect(env.PI_WEB_UI_BROWSER_PLUGIN_TOKEN).toBeTruthy();
    expect(env.PI_WEB_UI_COMPUTER_PLUGIN_TOKEN).toBeTruthy();
    expect(env.PI_WEB_UI_BROWSER_PLUGIN_TOKEN).not.toBe(env.PI_WEB_UI_COMPUTER_PLUGIN_TOKEN);
    expect(manager.validatePluginToken(
      "plugins", "browser-use", env.PI_WEB_UI_BROWSER_PLUGIN_TOKEN,
    )).toBe(true);
    expect(manager.validatePluginToken(
      "plugins", "computer-use", env.PI_WEB_UI_COMPUTER_PLUGIN_TOKEN,
    )).toBe(true);
    expect(manager.validatePluginToken(
      "plugins", "computer-use", env.PI_WEB_UI_BROWSER_PLUGIN_TOKEN,
    )).toBe(false);
  });
});
