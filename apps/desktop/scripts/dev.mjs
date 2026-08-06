import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export function desktopDevEnvironment(env = process.env) {
  return {
    ...env,
    PI_DESKTOP_SERVER_PORT: env.PI_DESKTOP_SERVER_PORT ?? "8080",
  };
}

export function isDirectExecution(moduleUrl, entryPath, cwd = process.cwd()) {
  return Boolean(entryPath) && moduleUrl === pathToFileURL(resolve(cwd, entryPath)).href;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const tauriCli = resolve(scriptDir, "../node_modules/@tauri-apps/cli/tauri.js");
  const child = spawn(process.execPath, [tauriCli, "dev"], {
    env: desktopDevEnvironment(),
    stdio: "inherit",
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
