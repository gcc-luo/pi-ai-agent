import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const shellModulePath = path.join(
  process.cwd(),
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "utils",
  "shell.js",
);
const { getShellConfig } = await import(pathToFileURL(shellModulePath).href);

describe("Pi shell selection", () => {
  it.skipIf(process.platform !== "win32")(
    "falls back when a legacy custom shell path no longer exists",
    () => {
      const missingShellPath = path.join(os.tmpdir(), "pi-web-ui-missing-shell", "bash.exe");
      const bundledShellDir = path.join(os.tmpdir(), `pi-web-ui-bundled-shell-${process.pid}`);
      const bundledShellPath = path.join(bundledShellDir, "bash.exe");
      const previousPath = process.env.PATH;
      mkdirSync(bundledShellDir, { recursive: true });
      writeFileSync(bundledShellPath, "");
      chmodSync(bundledShellPath, 0o755);
      process.env.PATH = `${bundledShellDir};${previousPath ?? ""}`;

      try {
        const shell = getShellConfig(missingShellPath);

        expect(shell.shell).toBe(bundledShellPath);
        expect(shell.args).toEqual(["-c"]);
      } finally {
        process.env.PATH = previousPath;
        rmSync(bundledShellDir, { recursive: true, force: true });
      }
    },
  );
});
