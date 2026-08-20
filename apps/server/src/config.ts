import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function splitArgs(value: string | undefined): string[] | undefined {
  const args = value?.split(" ").filter(Boolean);
  return args?.length ? args : undefined;
}

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  logLevel: string;
  logFile: string;
  piCommand: string;
  piArgs: string[];
  piNpmRegistry: string;
  piSessionRootDir: string;
  idleTimeoutMs: number;
  suspendedTimeoutMs: number;
  noResponseTimeoutMs: number;
  trashRetentionMs: number;
  piProvider: string;
  piModel: string;
  piAutoCompaction: boolean;
  skillsDir: string;
  skillStoreTimeoutMs: number;
  skillsMpApiKey: string;
  kbFilesDir: string;
  backupDir: string;
  authToken: string;
}

const defaultRoot = path.join(os.homedir(), ".pi-web-ui");

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

export function loadConfig(): Config {
  const root = process.env.PI_WEB_UI_ROOT ?? defaultRoot;
  fs.mkdirSync(root, { recursive: true });
  const bundledRuntimeDir = process.env.PI_BUNDLED_RUNTIME_DIR;
  const bundledAgentEntry = bundledRuntimeDir
    ? path.join(
        bundledRuntimeDir,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "dist",
        "cli.js",
      )
    : undefined;
  const customPiCommand = process.env.PI_COMMAND || undefined;
  const embeddedAgent = Boolean(bundledAgentEntry) && !customPiCommand;
  const configuredPiArgs = splitArgs(process.env.PI_ARGS);
  const defaultNpxArgs = ["-y", "@earendil-works/pi-coding-agent"];
  const piCommand =
    customPiCommand ?? (embeddedAgent ? process.execPath : "npx");
  const piArgs = embeddedAgent
    ? [
        bundledAgentEntry!,
        ...(configuredPiArgs ?? ["--mode", "rpc", "--no-extensions"]),
      ]
    : (configuredPiArgs ?? [
        ...defaultNpxArgs,
        "--mode",
        "rpc",
        "--no-extensions",
      ]);
  return {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "127.0.0.1",
    authToken: process.env.PI_WEB_UI_AUTH_TOKEN ?? "",
    dbPath: path.join(root, "pi-web-ui.sqlite"),
    logLevel: process.env.LOG_LEVEL ?? "info",
    logFile: process.env.LOG_FILE ?? path.join(root, "logs", "server.log"),
    piCommand,
    piArgs,
    piNpmRegistry: process.env.PI_NPM_REGISTRY ?? "https://registry.npmjs.org/",
    piSessionRootDir: process.env.PI_SESSION_ROOT_DIR ?? path.join(root, "sessions"),
    piProvider: process.env.PI_PROVIDER ?? "",
    piModel: process.env.PI_MODEL ?? "",
    piAutoCompaction: process.env.PI_AUTO_COMPACTION !== "false",
    skillsDir: process.env.PI_SKILLS_DIR ?? path.join(os.homedir(), ".pi/agent/skills"),
    skillStoreTimeoutMs: Number(process.env.SKILL_STORE_TIMEOUT_MS ?? 10_000),
    skillsMpApiKey: process.env.SKILLSMP_API_KEY ?? "",
    idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MS ?? 5 * 60 * 1000),
    suspendedTimeoutMs: Number(process.env.SUSPENDED_TIMEOUT_MS ?? 30 * 60 * 1000),
    noResponseTimeoutMs: Number(process.env.NO_RESPONSE_TIMEOUT_MS ?? 30 * 1000),
    // Items in trash are permanently deleted after this retention period.
    trashRetentionMs: Number(process.env.TRASH_RETENTION_DAYS ?? 30) * 24 * 60 * 60 * 1000,
    kbFilesDir: process.env.PI_KB_FILES_DIR ?? path.join(root, "kb-files"),
    backupDir: process.env.PI_BACKUP_DIR?.startsWith("~/")
      ? path.join(os.homedir(), process.env.PI_BACKUP_DIR.slice(2))
      : (process.env.PI_BACKUP_DIR ?? path.join(root, "backups")),
  };
}
