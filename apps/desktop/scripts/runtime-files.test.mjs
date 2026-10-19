import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  backupNativeArtifacts,
  copyRuntimeTree,
  restoreNativeArtifacts,
  smokeTestNodePtyRuntime,
} from "./runtime-files.mjs";

test("copies pnpm deployment links into real directories", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-runtime-files-"));
  const output = mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-runtime-output-"));
  try {
    const storePackage = path.join(root, "node_modules", ".pnpm", "demo-package", "node_modules", "demo-package");
    const linkedPackage = path.join(root, "node_modules", "demo-package");
    mkdirSync(storePackage, { recursive: true });
    writeFileSync(path.join(storePackage, "package.json"), "{\"name\":\"demo-package\"}\n");
    const storeDependency = path.join(root, "node_modules", ".pnpm", "demo-dependency", "node_modules", "demo-dependency");
    mkdirSync(storeDependency, { recursive: true });
    writeFileSync(path.join(storeDependency, "index.js"), "export {};\n");
    const linkedDependency = path.join(root, "node_modules", "demo-dependency");
    mkdirSync(path.dirname(linkedDependency), { recursive: true });
    symlinkSync(
      storeDependency,
      linkedDependency,
      process.platform === "win32" ? "junction" : "dir",
    );
    mkdirSync(path.dirname(linkedPackage), { recursive: true });
    symlinkSync(storePackage, linkedPackage, process.platform === "win32" ? "junction" : "dir");

    copyRuntimeTree(root, output);

    const copiedPackage = path.join(output, "node_modules", "demo-package");
    assert.equal(lstatSync(copiedPackage).isSymbolicLink(), false);
    assert.equal(existsSync(path.join(copiedPackage, "package.json")), true);
    assert.equal(existsSync(path.join(output, "node_modules", "demo-dependency", "index.js")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});

test("backs up and restores every native addon from the pnpm virtual store", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-native-runtime-"));
  const backup = mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-native-backup-"));
  try {
    const artifacts = [
      path.join(root, "node_modules", ".pnpm", "node-pty@1", "node_modules", "node-pty", "build", "Release", "pty.node"),
      path.join(root, "node_modules", ".pnpm", "other-native@1", "node_modules", "other-native", "nested", "addon.node"),
    ];
    artifacts.forEach((artifact, index) => {
      mkdirSync(path.dirname(artifact), { recursive: true });
      writeFileSync(artifact, `native-${index}`);
    });

    backupNativeArtifacts(root, backup);
    rmSync(path.join(root, "node_modules", ".pnpm"), { recursive: true, force: true });
    restoreNativeArtifacts(root, backup);

    expectNativeArtifact(root, artifacts[0], "native-0");
    expectNativeArtifact(root, artifacts[1], "native-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(backup, { recursive: true, force: true });
  }
});

test("loads node-pty from the runtime, captures shell output, and kills the PTY", () => {
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server");
  assert.equal(smokeTestNodePtyRuntime(process.execPath, serverDir), "PI_TERMINAL_SMOKE_OK");
});

function expectNativeArtifact(root, artifact, expected) {
  const relative = path.relative(root, artifact);
  assert.equal(readFileSync(path.join(root, relative), "utf8"), expected);
}
