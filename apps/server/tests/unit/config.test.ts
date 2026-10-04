import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig bundled runtime", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the bundled Node runtime without splitting paths containing spaces", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-config-"));
    tempDirs.push(dataDir);
    const runtimeDir = "/Applications/PI AI Agent.app/Contents/Resources/server runtime";
    const agentEntry = path.join(
      runtimeDir,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "cli.js",
    );
    vi.stubEnv("PI_WEB_UI_ROOT", dataDir);
    vi.stubEnv("PI_BUNDLED_RUNTIME_DIR", runtimeDir);
    vi.stubEnv("PI_COMMAND", "");
    vi.stubEnv("PI_ARGS", "");
    const config = loadConfig();

    expect(config.piCommand).toBe(process.execPath);
    expect(config.piArgs).toEqual([
      agentEntry,
      "--mode",
      "rpc",
      "--no-extensions",
    ]);
  });

  it("uses the locked local Pi runtime with extension discovery disabled", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-config-"));
    tempDirs.push(dataDir);
    vi.stubEnv("PI_WEB_UI_ROOT", dataDir);
    vi.stubEnv("PI_BUNDLED_RUNTIME_DIR", "");
    vi.stubEnv("PI_COMMAND", "");
    vi.stubEnv("PI_ARGS", "");
    const config = loadConfig();

    expect(config.piCommand).toBe(process.execPath);
    expect(config.piArgs).toEqual([
      expect.stringContaining("pi-coding-agent/dist/cli.js"),
      "--mode",
      "rpc",
      "--no-extensions",
    ]);
  });

  it("preserves explicitly configured Pi arguments", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-config-"));
    tempDirs.push(dataDir);
    vi.stubEnv("PI_WEB_UI_ROOT", dataDir);
    vi.stubEnv("PI_BUNDLED_RUNTIME_DIR", "");
    vi.stubEnv("PI_COMMAND", "custom-pi");
    vi.stubEnv("PI_ARGS", "--mode rpc --verbose");
    const config = loadConfig();

    expect(config.piCommand).toBe("custom-pi");
    expect(config.piArgs).toEqual(["--mode", "rpc", "--verbose"]);
  });
});
