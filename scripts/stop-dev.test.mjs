import assert from "node:assert/strict";
import test from "node:test";

import { findProjectProcessRoots, isDirectExecution, isIgnorableTaskkillError, isProjectProcess } from "./stop-dev.mjs";

const workspace = "D:\\ai-agent\\pi-web-ui";

test("recognizes processes launched from this workspace", () => {
  assert.equal(isProjectProcess({
    processId: 100,
    name: "node.exe",
    commandLine: "node D:\\ai-agent\\pi-web-ui\\apps\\server\\src\\index.ts",
  }, workspace), true);
});

test("recognizes this workspace's Tauri executable without touching another project", () => {
  assert.equal(isProjectProcess({
    processId: 101,
    name: "pi-agent.exe",
    executablePath: "D:\\ai-agent\\pi-web-ui\\apps\\desktop\\src-tauri\\target\\debug\\pi-agent.exe",
  }, workspace), true);
  assert.equal(isProjectProcess({
    processId: 102,
    name: "pi-agent.exe",
    executablePath: "D:\\other-project\\apps\\desktop\\src-tauri\\target\\debug\\pi-agent.exe",
  }, workspace), false);
  assert.equal(isProjectProcess({ processId: 103, name: "System", commandLine: null, executablePath: null }, workspace), false);
});

test("returns only top-level project processes for tree termination", () => {
  const roots = findProjectProcessRoots([
    { processId: 10, parentProcessId: 1, name: "node.exe", commandLine: "pnpm --filter @pi-web-ui/server run dev" },
    { processId: 11, parentProcessId: 10, name: "node.exe", commandLine: "D:\\ai-agent\\pi-web-ui\\apps\\server\\src\\index.ts" },
    { processId: 12, parentProcessId: 1, name: "node.exe", commandLine: "D:\\other-project\\server.js" },
  ], workspace);

  assert.deepEqual(roots, [10]);
});

test("recognizes a relative script path when invoked by pnpm", () => {
  assert.equal(
    isDirectExecution("file:///D:/ai-agent/pi-web-ui/scripts/stop-dev.mjs", "scripts/stop-dev.mjs", "D:/ai-agent/pi-web-ui"),
    true,
  );
});

test("treats an already-terminated process as a successful stop", () => {
  assert.equal(isIgnorableTaskkillError(new Error('ERROR: The process "32248" not found.')), true);
  assert.equal(isIgnorableTaskkillError(new Error("Access is denied.")), false);
});
