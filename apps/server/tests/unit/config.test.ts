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
    vi.stubEnv("PI_TUI_ARGS", "");

    const config = loadConfig();

    expect(config.piCommand).toBe(process.execPath);
    expect(config.piArgs).toEqual([agentEntry, "--mode", "rpc"]);
    expect(config.piTuiArgs).toEqual([agentEntry]);
  });
});
