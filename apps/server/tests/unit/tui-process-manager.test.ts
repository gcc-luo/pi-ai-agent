import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTuiLaunch } from "../../src/agent/tui-process-manager.js";

const temporaryDirectories: string[] = [];

function createCommandDirectory(files: string[]): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-tui-launch-"));
  temporaryDirectories.push(directory);
  for (const file of files) fs.writeFileSync(path.join(directory, file), "");
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("resolveTuiLaunch", () => {
  it("runs a Windows command shim through cmd.exe", () => {
    const commandDirectory = createCommandDirectory(["npx", "npx.cmd"]);

    expect(resolveTuiLaunch("npx", ["--version"], {
      platform: "win32",
      searchPath: commandDirectory,
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    })).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", path.join(commandDirectory, "npx.cmd"), "--version"],
    });
  });

  it.each(["linux", "darwin"] as const)("runs %s commands directly", (platform) => {
    const commandDirectory = createCommandDirectory(["npx"]);
    const executable = path.join(commandDirectory, "npx");

    expect(resolveTuiLaunch(executable, ["--version"], { platform })).toEqual({
      command: executable,
      args: ["--version"],
    });
  });

  it("runs a Windows executable directly", () => {
    const commandDirectory = createCommandDirectory(["pi.exe"]);

    expect(resolveTuiLaunch("pi", ["--help"], { platform: "win32", searchPath: commandDirectory })).toEqual({
      command: path.join(commandDirectory, "pi.exe"),
      args: ["--help"],
    });
  });
});
