import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  logLevel: string;
  logFile: string;
  piCommand: string;
  piArgs: string[];
  piTuiArgs: string[];
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
  libreOfficeBinary: string;
  loConvertTimeoutMs: number;
  loCacheDir: string;
  loMaxCacheFiles: number;
  loMaxCacheBytes: number;
}

const defaultRoot = path.join(os.homedir(), ".pi-web-ui");

function withoutRpcMode(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode" && args[i + 1] === "rpc") {
      i++;
      continue;
    }
    result.push(args[i]!);
  }
  return result;
}

export function loadConfig(): Config {
  const root = process.env.PI_WEB_UI_ROOT ?? defaultRoot;
  fs.mkdirSync(root, { recursive: true });
  const piArgs = (process.env.PI_ARGS ?? "-y @earendil-works/pi-coding-agent --mode rpc").split(" ");
  return {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "127.0.0.1",
    dbPath: path.join(root, "pi-web-ui.sqlite"),
    logLevel: process.env.LOG_LEVEL ?? "info",
    logFile: process.env.LOG_FILE ?? path.join(root, "logs", "server.log"),
    piCommand: process.env.PI_COMMAND ?? "npx",
    piArgs,
    // The web terminal runs Pi's normal interactive interface, not its JSON-RPC mode.
    // Set PI_TUI_ARGS explicitly when a custom Pi launcher needs different arguments.
    piTuiArgs: (process.env.PI_TUI_ARGS?.split(" ") ?? withoutRpcMode(piArgs)),
    piNpmRegistry: process.env.PI_NPM_REGISTRY ?? "https://registry.npmjs.org/",
    // One private Pi JSONL directory per Web UI session. Keep the original
    // tui-sessions location so existing Coding conversations remain usable.
    piSessionRootDir: process.env.PI_SESSION_ROOT_DIR ?? path.join(root, "tui-sessions"),
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
    libreOfficeBinary: process.env.LIBREOFFICE_BINARY ?? "",
    loConvertTimeoutMs: Number(process.env.LO_CONVERT_TIMEOUT_MS ?? 60_000),
    loCacheDir: process.env.LO_CACHE_DIR ?? path.join(root, "lo-cache"),
    loMaxCacheFiles: Number(process.env.LO_MAX_CACHE_FILES ?? 200),
    loMaxCacheBytes: Number(process.env.LO_MAX_CACHE_BYTES ?? 500 * 1024 * 1024),
  };
}
