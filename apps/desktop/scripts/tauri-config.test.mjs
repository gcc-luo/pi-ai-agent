import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tauriConfigPath = path.resolve(scriptDir, "../src-tauri/tauri.conf.json");
const packageJsonPath = path.resolve(scriptDir, "../package.json");

test("uses a space-free product name for generated install artifacts", () => {
  const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.equal(config.productName, "PI-AI-Agent");
  assert.equal(packageJson.productName, "PI-AI-Agent");
  assert.equal(/\s/.test(config.productName), false);
  assert.equal(config.app.windows[0].title, "PI AI Agent");
});

test("refreshes the bundled server runtime before packaging", () => {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  assert.match(packageJson.scripts.build, /^pnpm prepare-sidecar && tauri build$/);
  assert.match(packageJson.scripts["build:debug"], /^pnpm prepare-sidecar && tauri build --debug$/);
});
