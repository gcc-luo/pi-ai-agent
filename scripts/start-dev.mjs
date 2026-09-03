import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEVELOPMENT_PACKAGES = [
  { name: "server", args: ["--filter", "@pi-web-ui/server", "dev"] },
  { name: "desktop", args: ["--filter", "@pi-web-ui/desktop", "dev"] },
];

export function pnpmExecutable(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function developmentCommands(platform = process.platform) {
  const command = pnpmExecutable(platform);
  return DEVELOPMENT_PACKAGES.map(({ name, args }) => ({
    name,
    command,
    args: [...args],
  }));
}

export function developmentSpawnSpec(command, args, platform = process.platform, comSpec = process.env.ComSpec ?? "cmd.exe") {
  if (platform !== "win32") {
    return { command, args: [...args] };
  }

  return {
    command: comSpec,
    args: ["/d", "/s", "/c", [command, ...args].join(" ")],
  };
}

export function terminateProcessTree(child, platform = process.platform, run = execFileSync) {
  if (!child || typeof child.pid !== "number") return;

  if (platform === "win32") {
    try {
      run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      // The child may have exited between the event and cleanup.
    }
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // The child may have exited between the event and cleanup.
  }
}

export function startDevelopmentProcesses({
  platform = process.platform,
  cwd = process.cwd(),
  spawnProcess = spawn,
  terminateProcess = (child) => terminateProcessTree(child, platform),
  exit = (code) => process.exit(code),
  signalSource = process,
  comSpec = process.env.ComSpec ?? "cmd.exe",
} = {}) {
  const children = [];
  let stopping = false;

  const stopChild = (child) => {
    try {
      terminateProcess(child);
    } catch {
      // Cleanup is best-effort; the original process result is more useful.
    }
  };

  const stopAll = (code) => {
    if (stopping) return;
    stopping = true;
    children.forEach(stopChild);
    exit(code);
  };

  signalSource.on("SIGINT", () => stopAll(0));
  signalSource.on("SIGTERM", () => stopAll(0));

  try {
    for (const { command, args } of developmentCommands(platform)) {
      const spawnSpec = developmentSpawnSpec(command, args, platform, comSpec);
      const child = spawnProcess(spawnSpec.command, spawnSpec.args, {
        cwd,
        stdio: "inherit",
      });
      children.push(child);
      child.on("exit", (code) => {
        if (stopping) return;
        stopping = true;
        children.forEach((otherChild) => {
          if (otherChild !== child) stopChild(otherChild);
        });
        exit(typeof code === "number" ? code : 1);
      });
    }
  } catch (error) {
    stopping = true;
    children.forEach(stopChild);
    throw error;
  }

  return { children, stopAll };
}

export function isDirectExecution(moduleUrl, entryPath, cwd = process.cwd()) {
  return Boolean(entryPath) && moduleUrl === pathToFileURL(resolve(cwd, entryPath)).href;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  startDevelopmentProcesses();
}
