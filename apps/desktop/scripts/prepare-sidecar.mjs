#!/usr/bin/env node

/**
 * Prepare the desktop server runtime.
 *
 * The packaged app ships a real Node.js executable plus a pnpm production
 * deployment. This deliberately avoids single-file snapshotters: the server
 * depends on native addons, ESM-only packages and runtime-loaded assets that
 * must remain available on disk.
 */

import { spawn, execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../../..");
const serverDir = resolve(root, "apps/server");
const binariesDir = resolve(scriptDir, "../src-tauri/binaries");
const resourcesDir = resolve(scriptDir, "../resources");
const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-runtime-"));
const runtimeArchive = resolve(resourcesDir, "server-runtime.tar.gz");
const runtimeChecksum = resolve(resourcesDir, "server-runtime.sha256");

const targetMap = {
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
};

const platformArch = `${process.platform}-${process.arch}`;
const tauriTarget = targetMap[platformArch];
if (!tauriTarget) {
  throw new Error(`Unsupported desktop target: ${platformArch}`);
}

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 19)) {
  throw new Error(
    `Node.js >= 22.19 is required to package pi-coding-agent; current version is ${process.version}`,
  );
}

const executableExtension = process.platform === "win32" ? ".exe" : "";
const nodeSidecarPath = resolve(
  binariesDir,
  `pi-node-${tauriTarget}${executableExtension}`,
);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

console.log(`\nPreparing desktop runtime for ${platformArch}`);
console.log(`  Node runtime: ${process.execPath} (${process.version})`);
console.log(`  Tauri target: ${tauriTarget}`);

console.log("\nBuilding server...");
execFileSync(pnpmCommand, ["build"], { cwd: serverDir, stdio: "inherit" });

console.log("\nCreating production dependency deployment...");
execFileSync(
  pnpmCommand,
  ["--filter", "@pi-web-ui/server", "deploy", "--prod", runtimeDir],
  { cwd: root, stdio: "inherit" },
);

// pnpm deploy copies the complete workspace package. Only dist, package.json
// and production node_modules are required inside the application bundle.
for (const entry of [
  "src",
  "tests",
  "tsconfig.json",
  "tsconfig.build.json",
  "vitest.config.ts",
]) {
  rmSync(resolve(runtimeDir, entry), { recursive: true, force: true });
}

console.log("\nCopying Node.js sidecar...");
mkdirSync(binariesDir, { recursive: true });
copyFileSync(process.execPath, nodeSidecarPath);
if (process.platform !== "win32") chmodSync(nodeSidecarPath, 0o755);

const serverEntry = resolve(runtimeDir, "dist/index.js");
const agentEntry = resolve(
  runtimeDir,
  "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
);
for (const requiredPath of [serverEntry, agentEntry, nodeSidecarPath]) {
  if (!existsSync(requiredPath))
    throw new Error(`Missing packaged runtime file: ${requiredPath}`);
}

console.log("\nChecking embedded pi-coding-agent...");
execFileSync(nodeSidecarPath, [agentEntry, "--version"], {
  stdio: "inherit",
  timeout: 15_000,
});

console.log("\nStarting packaged server smoke test...");
await smokeTestServer(nodeSidecarPath, serverEntry, runtimeDir);

console.log("\nArchiving server runtime...");
mkdirSync(resourcesDir, { recursive: true });
rmSync(runtimeArchive, { force: true });
execFileSync(
  process.platform === "win32" ? "tar.exe" : "tar",
  ["-czf", runtimeArchive, "-C", runtimeDir, "."],
  {
    stdio: "inherit",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  },
);
const checksum = createHash("sha256")
  .update(readFileSync(runtimeArchive))
  .digest("hex");
writeFileSync(runtimeChecksum, `${checksum}\n`);
rmSync(runtimeDir, { recursive: true, force: true });

console.log("\nDesktop runtime is ready.");
console.log(`  Node sidecar: ${nodeSidecarPath}`);
console.log(`  Server archive: ${runtimeArchive}`);
console.log(`  Runtime checksum: ${checksum}`);
console.log("  Next: pnpm run build");

async function smokeTestServer(nodePath, entryPath, bundledRuntimeDir) {
  const port = await findFreePort();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "pi-web-ui-sidecar-"));
  const output = [];
  const child = spawn(nodePath, [entryPath], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      PI_WEB_UI_ROOT: dataDir,
      PI_BUNDLED_RUNTIME_DIR: bundledRuntimeDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));

  try {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `Packaged server exited with code ${child.exitCode}\n${output.join("")}`,
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`);
        if (response.ok && (await response.json()).ok === true) return;
      } catch {
        // Server is still starting.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
    throw new Error(
      `Packaged server health check timed out\n${output.join("")}`,
    );
  } finally {
    child.kill();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function findFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a smoke-test port"));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(address.port);
      });
    });
  });
}
