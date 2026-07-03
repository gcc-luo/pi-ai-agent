import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface Config {
  port: number;
  host: string;
  workdirRoot: string;
  dbPath: string;
  logLevel: string;
  piCommand: string;
  piArgs: string[];
  idleTimeoutMs: number;
  suspendedTimeoutMs: number;
  noResponseTimeoutMs: number;
}

const defaultRoot = path.join(os.homedir(), ".pi-web-ui");

export function loadConfig(): Config {
  const root = process.env.PI_WEB_UI_ROOT ?? defaultRoot;
  fs.mkdirSync(root, { recursive: true });
  return {
    port: Number(process.env.PORT ?? 5174),
    host: process.env.HOST ?? "127.0.0.1",
    workdirRoot: path.join(root, "projects"),
    dbPath: path.join(root, "pi-web-ui.sqlite"),
    logLevel: process.env.LOG_LEVEL ?? "info",
    piCommand: process.env.PI_COMMAND ?? "npx",
    piArgs: (process.env.PI_ARGS ?? "-y @earendil-works/pi-coding-agent --rpc").split(" "),
    idleTimeoutMs: Number(process.env.IDLE_TIMEOUT_MS ?? 5 * 60 * 1000),
    suspendedTimeoutMs: Number(process.env.SUSPENDED_TIMEOUT_MS ?? 30 * 60 * 1000),
    noResponseTimeoutMs: Number(process.env.NO_RESPONSE_TIMEOUT_MS ?? 30 * 1000),
  };
}
