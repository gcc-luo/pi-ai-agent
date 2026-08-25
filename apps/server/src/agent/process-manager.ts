import { ChildProcess, spawn, SpawnOptions as NodeSpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { FastifyBaseLogger } from "fastify";
import { ServerEvent } from "@pi-web-ui/shared";
import { AgentProcess, SpawnOptions } from "./types.js";
import { preparePiSession } from "./pi-session-store.js";

type Spawner = (cmd: string, args: string[], opts: NodeSpawnOptions) => ChildProcess;
type ProcessTreeKiller = (child: ChildProcess) => void;

export interface ProcessManagerOptions {
  spawn?: Spawner;
  killProcessTree?: ProcessTreeKiller;
  command: string;
  args: string[];
  npmRegistry?: string;
  provider?: string;
  model?: string;
  autoCompaction?: boolean;
  sessionRootDir?: string;
  browserExtensionPath?: string;
  browserEndpoint?: string;
  pluginExtensions?: Record<string, string>;
  pluginEndpoint?: string;
  connectorExtensionPath?: string;
  connectorEndpoint?: string;
  isPluginEnabled?: (pluginId: string) => boolean;
  validateWorkdir?: boolean;
  logger: FastifyBaseLogger;
}

export interface ModelConfig {
  provider?: string;
  model?: string;
  modelType?: string;
  apiKey?: string | null;
  apiBaseUrl?: string | null;
}

export const API_KEY_ENV_BY_PROVIDER: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  "ant-ling": "ANT_LING_API_KEY",
  openai: "OPENAI_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  together: "TOGETHER_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  zai: "ZAI_API_KEY",
  "zai-coding-cn": "ZAI_CODING_CN_API_KEY",
  mistral: "MISTRAL_API_KEY",
  minimax: "MINIMAX_API_KEY",
  moonshotai: "MOONSHOT_API_KEY",
  opencode: "OPENCODE_API_KEY",
  "opencode-go": "KIMI_API_KEY",
  "kimi-coding": "KIMI_API_KEY",
  xai: "XAI_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function createCustomModelExtension(config: { provider: string; model: string; apiBaseUrl: string; modelType?: string }): string {
  const extensionPath = path.join(
    os.tmpdir(),
    `pi-web-ui-model-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );
  const provider = JSON.stringify(config.provider);
  const model = JSON.stringify(config.model);
  const baseUrl = JSON.stringify(normalizeBaseUrl(config.apiBaseUrl));
  const inputCapabilities = config.modelType === "multimodal"
    ? "[\"text\", \"image\"]"
    : "[\"text\"]";

  fs.writeFileSync(
    extensionPath,
    [
      "export default function (pi) {",
      `  pi.registerProvider(${provider}, {`,
      `    name: ${provider},`,
      `    baseUrl: ${baseUrl},`,
      "    apiKey: \"$PI_WEB_UI_MODEL_API_KEY\",",
      "    api: \"openai-completions\",",
      "    models: [{",
      `      id: ${model},`,
      `      name: ${model},`,
      "      reasoning: false,",
      `      input: ${inputCapabilities},`,
      "      contextWindow: 128000,",
      "      maxTokens: 16384,",
      "      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },",
      "      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false }",
      "    }]",
      "  });",
      "}",
      "",
    ].join("\n"),
  );

  return extensionPath;
}

function cleanSpawnEnv(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.toLowerCase().startsWith("npm_config_")) continue;
    env[key] = value;
  }
  return env;
}

function isIgnorableStderr(line: string): boolean {
  return /^npm warn Unknown (env|project) config /.test(line)
    || /^npm warn deprecated /.test(line);
}

export function shouldUseWindowsShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return false;

  const extension = path.win32.extname(command).toLowerCase();
  return !path.win32.isAbsolute(command) || extension === ".cmd" || extension === ".bat";
}

export class ProcessManager extends EventEmitter {
  private procs = new Map<string, AgentProcess>();
  private spawn: Spawner;
  private killProcessTree: ProcessTreeKiller;
  private command: string;
  private args: string[];
  private npmRegistry?: string;
  private provider: string;
  private model: string;
  private autoCompaction: boolean;
  private sessionRootDir: string;
  private log: FastifyBaseLogger;
  private browserExtensionPath?: string;
  private browserEndpoint?: string;
  private pluginExtensions: Record<string, string>;
  private pluginEndpoint?: string;
  private connectorExtensionPath?: string;
  private connectorEndpoint?: string;
  private connectorTokens = new Map<string, string>();
  private pluginTokens = new Map<string, Map<string, string>>();
  private isPluginEnabled: (pluginId: string) => boolean;
  private validateWorkdir: boolean;

  constructor(opts: ProcessManagerOptions) {
    super();
    this.spawn = opts.spawn ?? ((c, a, o) => spawn(c, a, o) as ChildProcess);
    this.killProcessTree = opts.killProcessTree ?? (opts.spawn
      ? ((child) => { child.kill("SIGTERM"); })
      : ((child) => {
      if (!child.pid) {
        child.kill("SIGTERM");
        return;
      }
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        killer.once("error", () => child.kill("SIGTERM"));
        return;
      }
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      }));
    this.command = opts.command;
    this.args = opts.args;
    this.npmRegistry = opts.npmRegistry;
    this.provider = opts.provider ?? "";
    this.model = opts.model ?? "";
    this.autoCompaction = opts.autoCompaction ?? true;
    this.sessionRootDir = opts.sessionRootDir ?? path.join(os.tmpdir(), "pi-web-ui-sessions");
    this.log = opts.logger;
    this.browserExtensionPath = opts.browserExtensionPath;
    this.browserEndpoint = opts.browserEndpoint;
    this.pluginExtensions = {
      ...(opts.browserExtensionPath ? { "browser-use": opts.browserExtensionPath } : {}),
      ...(opts.pluginExtensions ?? {}),
    };
    this.pluginEndpoint = opts.pluginEndpoint ?? opts.browserEndpoint;
    this.connectorExtensionPath = opts.connectorExtensionPath;
    this.connectorEndpoint = opts.connectorEndpoint ?? opts.pluginEndpoint ?? opts.browserEndpoint;
    this.isPluginEnabled = opts.isPluginEnabled ?? (() => true);
    this.validateWorkdir = opts.validateWorkdir ?? true;
  }

  async start(input: {
    sessionId: string;
    projectId: string;
    workdir: string;
    modelConfig?: ModelConfig;
    browserEnabled?: boolean;
    activePluginIds?: string[];
  }): Promise<AgentProcess> {
    if (this.validateWorkdir) {
      let workdirStat: fs.Stats;
      try {
        workdirStat = fs.statSync(input.workdir);
      } catch {
        throw new Error(`项目工作目录不存在或不可访问：${input.workdir}`);
      }
      if (!workdirStat.isDirectory()) {
        throw new Error(`项目工作目录不是文件夹：${input.workdir}`);
      }
    }
    const activePluginIds = [...new Set(
      input.activePluginIds ?? (input.browserEnabled ? ["browser-use"] : []),
    )].filter((pluginId) => this.isPluginEnabled(pluginId)).sort();
    const existing = this.procs.get(input.sessionId);
    if (existing && existing.status !== "crashed" && existing.status !== "suspended") {
      const existingPlugins = [...(existing.activePluginIds ?? (
        existing.browserEnabled ? ["browser-use"] : []
      ))].sort();
      if (JSON.stringify(existingPlugins) === JSON.stringify(activePluginIds)) {
        return existing;
      }
      const stopped = await this.stopAndWait(input.sessionId);
      if (!stopped) {
        throw new Error("failed to stop agent process while changing browser capability");
      }
    }
    const cfg = input.modelConfig;
    const provider = cfg?.provider ?? this.provider;
    const model = cfg?.model ?? this.model;

    const extraArgs: string[] = [];
    if (cfg?.apiBaseUrl && provider && provider !== "anthropic" && model) {
      extraArgs.push("--extension", createCustomModelExtension({ provider, model, apiBaseUrl: cfg.apiBaseUrl, modelType: cfg.modelType }));
    }
    for (const pluginId of activePluginIds) {
      const extensionPath = this.pluginExtensions[pluginId];
      if (extensionPath) extraArgs.push("--extension", extensionPath);
    }
    if (this.connectorExtensionPath) extraArgs.push("--extension", this.connectorExtensionPath);
    if (provider) extraArgs.push("--provider", provider);
    if (model) extraArgs.push("--model", model);
    const piSession = preparePiSession(this.sessionRootDir, input.sessionId);

    const env: Record<string, string | undefined> = { ...cleanSpawnEnv(process.env), PI_RPC: "1" };
    if (this.connectorExtensionPath && this.connectorEndpoint) {
      const connectorToken = crypto.randomBytes(32).toString("hex");
      this.connectorTokens.set(input.sessionId, connectorToken);
      env.PI_WEB_UI_CONNECTOR_ENDPOINT = this.connectorEndpoint;
      env.PI_WEB_UI_CONNECTOR_TOKEN = connectorToken;
      env.PI_WEB_UI_SESSION_ID = input.sessionId;
    }
    if (this.npmRegistry) env.npm_config_registry = this.npmRegistry;
    if (cfg?.apiKey) {
      env.PI_WEB_UI_MODEL_API_KEY = cfg.apiKey;
      env[API_KEY_ENV_BY_PROVIDER[provider] ?? "OPENAI_API_KEY"] = cfg.apiKey;
    }
    if (cfg?.apiBaseUrl) {
      if (provider === "anthropic") {
        env.ANTHROPIC_BASE_URL = cfg.apiBaseUrl;
      } else {
        env.OPENAI_BASE_URL = cfg.apiBaseUrl;
      }
    }
    let issuedPluginTokens: Map<string, string> | undefined;
    if (activePluginIds.length > 0) {
      issuedPluginTokens = new Map(
        activePluginIds.map((pluginId) => [pluginId, crypto.randomBytes(32).toString("hex")]),
      );
      this.pluginTokens.set(input.sessionId, issuedPluginTokens);
      env.PI_WEB_UI_PLUGIN_ENDPOINT = this.pluginEndpoint;
      env.PI_WEB_UI_SESSION_ID = input.sessionId;
      // Keep the generic credential only for legacy single-plugin processes.
      // A shared multi-plugin token would let one extension call another
      // selected plugin's runtime.
      if (activePluginIds.length === 1) {
        env.PI_WEB_UI_PLUGIN_TOKEN = issuedPluginTokens.get(activePluginIds[0]!);
      }
      // Compatibility for the existing Browser Use extension protocol.
      if (activePluginIds.includes("browser-use")) {
        const browserToken = issuedPluginTokens.get("browser-use")!;
        env.PI_WEB_UI_BROWSER_PLUGIN_ENDPOINT = this.pluginEndpoint;
        env.PI_WEB_UI_BROWSER_PLUGIN_TOKEN = browserToken;
        env.PI_WEB_UI_BROWSER_SESSION_ID = input.sessionId;
        env.PI_WEB_UI_BROWSER_ENDPOINT = this.browserEndpoint;
        env.PI_WEB_UI_BROWSER_TOKEN = browserToken;
      }
      if (activePluginIds.includes("computer-use")) {
        env.PI_WEB_UI_COMPUTER_PLUGIN_ENDPOINT = this.pluginEndpoint;
        env.PI_WEB_UI_COMPUTER_PLUGIN_TOKEN = issuedPluginTokens.get("computer-use")!;
        env.PI_WEB_UI_COMPUTER_SESSION_ID = input.sessionId;
      }
    } else {
      this.pluginTokens.delete(input.sessionId);
    }

    const envKeys = Object.keys(env).filter(k => k.includes("API_KEY") || k.includes("BASE_URL") || k === "PI_RPC");
    const args = [...this.args, ...extraArgs, ...piSession.args];
    this.log.info({ command: this.command, args, envKeys }, "spawning agent process");

    const child = this.spawn(this.command, args, {
      cwd: input.workdir,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      // Windows resolves bare commands and .cmd/.bat shims through cmd.exe.
      // The bundled node.exe is an absolute path and must bypass cmd.exe so
      // installation directories containing spaces remain a single argument.
      shell: shouldUseWindowsShell(this.command),
      // Give the agent and every command it starts one process group on POSIX,
      // allowing session shutdown to terminate the complete descendant tree.
      detached: process.platform !== "win32",
    });

    let stopRequested = false;
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
      activePluginIds,
      browserEnabled: activePluginIds.includes("browser-use"),
      writeCommand(cmd: object) {
        child.stdin!.write(JSON.stringify(cmd) + "\n");
      },
      kill: () => {
        if (stopRequested) return;
        stopRequested = true;
        this.killProcessTree(child);
      },
    });

    child.stdout!.on("data", () => { proc.lastActivityAt = Date.now(); });
    child.stderr!.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      line
        .split("\n")
        .filter(Boolean)
        .filter((l) => !isIgnorableStderr(l))
        .forEach((l) => (proc as unknown as EventEmitter).emit("stderr", l));
    });
    // Spawn failures (e.g. command not found) emit 'error' instead of
    // 'exit'. Fold them into the normal exit path so the session is marked
    // crashed and the client gets a message, rather than an unhandled 'error'
    // event taking down the whole backend.
    let exited = false;
    const reportExit = (code: number | null) => {
      if (exited) return;
      exited = true;
      proc.status = stopRequested || code === 0 ? "suspended" : "crashed";
      if (issuedPluginTokens && this.pluginTokens.get(input.sessionId) === issuedPluginTokens) {
        this.pluginTokens.delete(input.sessionId);
      }
      this.connectorTokens.delete(input.sessionId);
      (proc as unknown as EventEmitter).emit("exit", code);
    };
    child.on("exit", reportExit);
    child.on("error", (err: NodeJS.ErrnoException) => {
      this.log.error({ err: err.message, code: err.code, syscall: err.syscall }, "agent process spawn failed");
      (proc as unknown as EventEmitter).emit("stderr", `failed to spawn agent process (${this.command}): ${err.message}`);
      reportExit(1);
    });

    this.procs.set(input.sessionId, proc);
    proc.status = "active";
    // Make the Web UI's behavior deterministic even when the user's global Pi
    // settings disable compaction. JSONL commands are processed in order, so
    // this always takes effect before the first prompt written by a caller.
    proc.writeCommand({ type: "set_auto_compaction", enabled: this.autoCompaction });
    return proc;
  }

  get(sessionId: string): AgentProcess | undefined {
    return this.procs.get(sessionId);
  }

  stop(sessionId: string): void {
    const p = this.procs.get(sessionId);
    if (p) p.kill();
  }

  async stopAndWait(sessionId: string, timeoutMs = 2_000): Promise<boolean> {
    const proc = this.procs.get(sessionId);
    if (!proc || proc.status === "suspended" || proc.status === "crashed") return true;
    return new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const onExit = () => done(true);
      const done = (exited: boolean) => {
        if (timer) clearTimeout(timer);
        proc.off("exit", onExit);
        resolve(exited);
      };
      proc.on("exit", onExit);
      timer = setTimeout(() => done(false), timeoutMs);
      proc.kill();
    });
  }

  validateBrowserToken(sessionId: string, token: string | undefined): boolean {
    return this.validatePluginToken(sessionId, "browser-use", token);
  }

  validatePluginToken(sessionId: string, pluginId: string, token: string | undefined): boolean {
    if (!token) return false;
    const expected = this.pluginTokens.get(sessionId)?.get(pluginId);
    if (!expected || expected.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }

  validateConnectorToken(sessionId: string, token: string | undefined): boolean {
    if (!token) return false;
    const expected = this.connectorTokens.get(sessionId);
    if (!expected || expected.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  }

  revokePluginToken(sessionId: string): void {
    this.pluginTokens.delete(sessionId);
    this.connectorTokens.delete(sessionId);
  }

  revokePluginTokens(sessionIds: Iterable<string>): void {
    for (const sessionId of sessionIds) this.pluginTokens.delete(sessionId);
  }

  async shutdown(): Promise<void> {
    for (const p of this.procs.values()) p.kill();
    this.procs.clear();
    this.pluginTokens.clear();
    this.connectorTokens.clear();
  }
}
