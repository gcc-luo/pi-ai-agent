import { ChildProcess, spawn, SpawnOptions as NodeSpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FastifyBaseLogger } from "fastify";
import { ServerEvent } from "@pi-web-ui/shared";
import { AgentProcess, SpawnOptions } from "./types.js";

type Spawner = (cmd: string, args: string[], opts: NodeSpawnOptions) => ChildProcess;

export interface ProcessManagerOptions {
  spawn?: Spawner;
  command: string;
  args: string[];
  provider?: string;
  model?: string;
  logger: FastifyBaseLogger;
}

export interface ModelConfig {
  provider?: string;
  model?: string;
  modelType?: string;
  apiKey?: string | null;
  apiBaseUrl?: string | null;
}

const API_KEY_ENV_BY_PROVIDER: Record<string, string> = {
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

function createCustomModelExtension(config: { provider: string; model: string; apiBaseUrl: string; modelType?: string }): string {
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
    if (key.startsWith("npm_config_")) continue;
    env[key] = value;
  }
  return env;
}

function isIgnorableStderr(line: string): boolean {
  return /^npm warn Unknown (env|project) config /.test(line);
}

export class ProcessManager extends EventEmitter {
  private procs = new Map<string, AgentProcess>();
  private spawn: Spawner;
  private command: string;
  private args: string[];
  private provider: string;
  private model: string;
  private log: FastifyBaseLogger;

  constructor(opts: ProcessManagerOptions) {
    super();
    this.spawn = opts.spawn ?? ((c, a, o) => spawn(c, a, o) as ChildProcess);
    this.command = opts.command;
    this.args = opts.args;
    this.provider = opts.provider ?? "";
    this.model = opts.model ?? "";
    this.log = opts.logger;
  }

  async start(input: { sessionId: string; projectId: string; workdir: string; modelConfig?: ModelConfig }): Promise<AgentProcess> {
    const existing = this.procs.get(input.sessionId);
    if (existing && existing.status !== "crashed" && existing.status !== "suspended") {
      return existing;
    }
    const cfg = input.modelConfig;
    const provider = cfg?.provider ?? this.provider;
    const model = cfg?.model ?? this.model;

    const extraArgs: string[] = [];
    if (cfg?.apiBaseUrl && provider && provider !== "anthropic" && model) {
      extraArgs.push("--extension", createCustomModelExtension({ provider, model, apiBaseUrl: cfg.apiBaseUrl, modelType: cfg.modelType }));
    }
    if (provider) extraArgs.push("--provider", provider);
    if (model) extraArgs.push("--model", model);

    const env: Record<string, string | undefined> = { ...cleanSpawnEnv(process.env), PI_RPC: "1" };
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

    const envKeys = Object.keys(env).filter(k => k.includes("API_KEY") || k.includes("BASE_URL") || k === "PI_RPC");
    this.log.info({ command: this.command, args: [...this.args, ...extraArgs], envKeys }, "spawning agent process");

    const child = this.spawn(this.command, [...this.args, ...extraArgs], {
      cwd: input.workdir,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      // Windows resolves `npx`/`pnpm` as .cmd shims that spawn() cannot open
      // without a shell; enabling it here avoids `spawn npx ENOENT`.
      shell: process.platform === "win32",
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
      proc.status = code === 0 ? "suspended" : "crashed";
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
