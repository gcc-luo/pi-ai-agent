import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEV_PORTS = [3000, 8080];

function normalizePath(value = "") {
  return String(value ?? "").replaceAll("/", "\\").toLowerCase();
}

export function isProjectProcess(proc, workspacePath) {
  const workspace = normalizePath(workspacePath);
  const commandLine = normalizePath(proc.commandLine);
  const executablePath = normalizePath(proc.executablePath);
  return commandLine.includes(workspace)
    || commandLine.includes("@pi-web-ui\\")
    || executablePath.startsWith(`${workspace}\\`);
}

export function findProjectProcessRoots(processes, workspacePath, currentPid = process.pid) {
  const projectPids = new Set(
    processes
      .filter((proc) => proc.processId !== currentPid && isProjectProcess(proc, workspacePath))
      .map((proc) => proc.processId),
  );

  return processes
    .filter((proc) => projectPids.has(proc.processId) && !projectPids.has(proc.parentProcessId))
    .map((proc) => proc.processId)
    .sort((a, b) => a - b);
}

export function isDirectExecution(moduleUrl, entryPath, cwd = process.cwd()) {
  return Boolean(entryPath) && moduleUrl === pathToFileURL(resolve(cwd, entryPath)).href;
}

export function isIgnorableTaskkillError(error) {
  return /process .* not found/i.test(error instanceof Error ? error.message : String(error));
}

function runPowerShell(command, run) {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function parseJson(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const value = JSON.parse(trimmed);
  return Array.isArray(value) ? value : [value];
}

function listWindowsProcesses(run) {
  return parseJson(runPowerShell(
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    run,
  )).map((proc) => ({
    processId: proc.ProcessId,
    parentProcessId: proc.ParentProcessId,
    name: proc.Name,
    executablePath: proc.ExecutablePath,
    commandLine: proc.CommandLine,
  }));
}

function listListeningPorts(run) {
  return parseJson(runPowerShell(
    `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in ${DEV_PORTS.join(",")} } | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress`,
    run,
  )).map((entry) => ({ port: entry.LocalPort, processId: entry.OwningProcess }));
}

export function stopDevelopmentServices({
  workspacePath = process.cwd(),
  currentPid = process.pid,
  platform = process.platform,
  run = execFileSync,
  log = console.log,
} = {}) {
  if (platform !== "win32") {
    throw new Error("pnpm stop currently supports Windows only.");
  }

  const processes = listWindowsProcesses(run);
  const roots = findProjectProcessRoots(processes, workspacePath, currentPid);
  for (const processId of roots) {
    try {
      run("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      if (!isIgnorableTaskkillError(error)) throw error;
    }
  }

  const remainingProcesses = listWindowsProcesses(run);
  const remainingRoots = findProjectProcessRoots(remainingProcesses, workspacePath, currentPid);
  const remainingPorts = listListeningPorts(run);
  if (remainingRoots.length > 0) {
    throw new Error(`Project processes still running: ${remainingRoots.join(", ")}`);
  }

  log(roots.length ? `Stopped project process trees: ${roots.join(", ")}` : "No project development processes were running.");
  if (remainingPorts.length) {
    log(`Ports still in use by another application: ${remainingPorts.map(({ port, processId }) => `${port} (PID ${processId})`).join(", ")}`);
  } else {
    log(`Released development ports: ${DEV_PORTS.join(", ")}`);
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  stopDevelopmentServices();
}
