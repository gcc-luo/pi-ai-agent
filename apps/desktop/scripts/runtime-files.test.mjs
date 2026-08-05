import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { copyRuntimeTree } from "./runtime-files.mjs";

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
