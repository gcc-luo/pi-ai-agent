import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const tauriConfigPath = path.resolve(scriptDir, "../src-tauri/tauri.conf.json");
const windowsTauriConfigPath = path.resolve(scriptDir, "../src-tauri/tauri.windows.conf.json");
const packageJsonPath = path.resolve(scriptDir, "../package.json");
const installerHooksPath = path.resolve(scriptDir, "../src-tauri/windows/installer-hooks.nsh");
const stopSidecarScriptPath = path.resolve(scriptDir, "../src-tauri/windows/stop-sidecar.ps1");
const shellRuntimeScriptPath = path.resolve(scriptDir, "prepare-shell-runtime.mjs");
const sidecarRuntimeScriptPath = path.resolve(scriptDir, "prepare-sidecar.mjs");
const releaseWorkflowPath = path.resolve(scriptDir, "../../../.github/workflows/release.yml");
const tauriBuildScriptPath = path.resolve(scriptDir, "../src-tauri/build.rs");
const macOSEntitlementsPath = path.resolve(scriptDir, "../src-tauri/Entitlements.plist");

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
  const releaseWorkflow = readFileSync(releaseWorkflowPath, "utf8");

  assert.match(packageJson.scripts.build, /^pnpm prepare-shell-runtime && pnpm prepare-sidecar && tauri build$/);
  assert.match(packageJson.scripts["build:debug"], /^pnpm prepare-shell-runtime && pnpm prepare-sidecar && tauri build --debug$/);
  assert.doesNotMatch(releaseWorkflow, /pnpm build -- --target/);
  assert.match(
    releaseWorkflow,
    /npx tauri build --target aarch64-apple-darwin --bundles app,dmg/,
  );
  assert.match(
    releaseWorkflow,
    /pnpm prepare-shell-runtime && pnpm prepare-sidecar && npx tauri build --target x86_64-pc-windows-msvc/,
  );
  assert.doesNotMatch(releaseWorkflow, /pnpm verify-release-version --/);
  assert.match(releaseWorkflow, /pnpm verify-release-version "\$\{\{ github\.ref_name \}\}"/);
});

test("signs macOS apps and publishes a verified DMG installer", () => {
  const releaseWorkflow = readFileSync(releaseWorkflowPath, "utf8");
  const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const entitlements = readFileSync(macOSEntitlementsPath, "utf8");

  assert.equal(config.bundle.macOS.entitlements, "./Entitlements.plist");
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
  assert.match(entitlements, /com\.apple\.security\.cs\.disable-library-validation/);
  assert.match(releaseWorkflow, /APPLE_CERTIFICATE:.*secrets\.APPLE_CERTIFICATE/);
  assert.match(releaseWorkflow, /APPLE_ID:.*secrets\.APPLE_ID/);
  assert.match(releaseWorkflow, /unset "\$variable"/);
  assert.match(releaseWorkflow, /Missing required macOS signing secret/);
  assert.match(releaseWorkflow, /export APPLE_SIGNING_IDENTITY="-"/);
  assert.match(releaseWorkflow, /codesign --verify --deep --strict/);
  assert.match(releaseWorkflow, /SIDECAR_ENTITLEMENTS=\$\(codesign -d --entitlements - "\$SIDECAR_PATH"/);
  assert.match(releaseWorkflow, /PI_BUNDLED_RUNTIME_DIR="\$SMOKE_DIR\/runtime"/);
  assert.match(releaseWorkflow, /"\$SIDECAR_PATH" "\$SMOKE_DIR\/runtime\/dist\/index\.js"/);
  assert.match(releaseWorkflow, /healthz/);
  assert.match(releaseWorkflow, /hdiutil verify/);
  assert.match(releaseWorkflow, /name: macos-installer/);
  assert.match(releaseWorkflow, /artifacts\/macos-installer\/\*\.dmg/);
  assert.match(releaseWorkflow, /macOS 手动安装请下载 `\.dmg` 文件/);
  assert.match(releaseWorkflow, /`\.app\.tar\.gz` 是应用自动更新专用文件/);
});

test("bundles a verified PortableGit runtime for the Windows shell fallback", () => {
  const config = JSON.parse(readFileSync(windowsTauriConfigPath, "utf8"));
  const shellRuntimeScript = readFileSync(shellRuntimeScriptPath, "utf8");
  const sidecarRuntimeScript = readFileSync(sidecarRuntimeScriptPath, "utf8");
  const tauriBuildScript = readFileSync(tauriBuildScriptPath, "utf8");

  assert.equal(config.bundle.resources["../resources/portable-git.exe"], "portable-git.exe");
  assert.equal(config.bundle.resources["../resources/portable-git.sha256"], "portable-git.sha256");
  assert.match(shellRuntimeScript, /PortableGit-2\.55\.0\.3-64-bit\.7z\.exe/);
  assert.match(shellRuntimeScript, /ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d/i);
  assert.match(sidecarRuntimeScript, /assertBundledShellFallback/);
  assert.match(sidecarRuntimeScript, /still rejects stale custom shell paths/);
  assert.match(tauriBuildScript, /archive_size > 0/);
  assert.match(tauriBuildScript, /rerun-if-changed=.*portable-git\.exe/);
  assert.doesNotMatch(tauriBuildScript, /File::create/);
});

test("configures an NSIS hook that only stops the sidecar in the install directory", () => {
  const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const hooks = readFileSync(installerHooksPath, "utf8");
  const stopSidecarScript = readFileSync(stopSidecarScriptPath, "utf8");

  assert.equal(
    config.bundle.windows.nsis.installerHooks,
    "./windows/installer-hooks.nsh",
  );
  assert.match(hooks, /NSIS_HOOK_PREINSTALL/);
  assert.match(hooks, /PI_AGENT_INSTALLER_HOOK_DIR/);
  assert.match(hooks, /stop-sidecar\.ps1/);
  assert.match(stopSidecarScript, /Join-Path \$InstallDir "pi-node\.exe"/);
  assert.match(stopSidecarScript, /ExecutablePath/);
  assert.doesNotMatch(hooks, /taskkill/i);
  assert.doesNotMatch(stopSidecarScript, /taskkill|\/IM\s+pi-node\.exe/i);
});
