import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createDeploymentDirectory } from "./deployment-directory.mjs";

test("creates the pnpm deployment directory inside the server workspace", () => {
  const serverDir = mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-deployment-test-"));
  try {
    const deployDir = createDeploymentDirectory(serverDir);

    assert.equal(path.dirname(deployDir), path.join(serverDir, "node_modules"));
    assert.equal(path.isAbsolute(path.relative(serverDir, deployDir)), false);
  } finally {
    rmSync(serverDir, { recursive: true, force: true });
  }
});
