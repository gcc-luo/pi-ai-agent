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
  idleTimeoutMs: number;
  suspendedTimeoutMs: number;
  noResponseTimeoutMs: number;
  piProvider: string;
  piModel: string;
  skillsDir: string;
  skillStoreTimeoutMs: number;
  skillsMpApiKey: string;
}

const defaultRoot = path.join(os.homedir(), ".pi-web-ui");

export function loadConfig(): Config {
  const root = process.env.PI_WEB_UI_ROOT ?? defaultRoot;
  fs.mkdirSync(root, { recursive: true });
  return {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "127.0.0.1",
    dbPath: path.join(root, "pi-web-ui.sqlite"),
    logLevel: process.env.LOG_LEVEL ?? "info",
    logFile: process.env.LOG_FILE ?? path.join(root, "logs", "server.log"),
    piCommand: process.env.PI_COMMAND ?? "npx",
    piArgs: (process.env.PI_ARGS ?? "-y @earendil-works/pi-coding-agent --mode rpc").split(" "),
    piProvider: process.env.PI_PROVIDER ?? "",
    piModel: process.env.PI_MODEL ?? "",
    skillsDir: process.env.PI_SKILLS_DIR ?? path.join(os.homedir(), ".pi/agent/skills"),
    skillStoreTimeoutMs: Number(process.env.SKILL_STORE_TIMEOUT_MS ?? 10_000),
    skillsMpApiKey: process.env.SKILLSMP_API_KEY ?? "",
    idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MS ?? 5 * 60 * 1000),
    suspendedTimeoutMs: Number(process.env.SUSPENDED_TIMEOUT_MS ?? 30 * 60 * 1000),
    noResponseTimeoutMs: Number(process.env.NO_RESPONSE_TIMEOUT_MS ?? 30 * 1000),
  };
}
