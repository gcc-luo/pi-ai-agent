#!/usr/bin/env node

/**
 * Download the pinned PortableGit archive that provides the Windows Bash
 * fallback bundled with the desktop installer. The binary itself stays out of
 * git; its SHA-256 is checked before Tauri is allowed to package it.
 */

import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { verifyPortableGitRuntime } from "./portable-git-runtime.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const resourcesDir = resolve(scriptDir, "../resources");
const archivePath = resolve(resourcesDir, "portable-git.exe");
const checksumPath = resolve(resourcesDir, "portable-git.sha256");
const downloadUrl = "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.3/PortableGit-2.55.0.3-64-bit.7z.exe";
const expectedChecksum = "ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d";

if (process.platform !== "win32") {
  console.log("Skipping PortableGit runtime outside Windows.");
  process.exit(0);
}

mkdirSync(resourcesDir, { recursive: true });

if (existsSync(archivePath)) {
  writeFileSync(checksumPath, `${expectedChecksum}\n`);
  try {
    verifyPortableGitRuntime({ archivePath, checksumPath, expectedChecksum });
    console.log(`Using verified PortableGit runtime: ${archivePath}`);
    process.exit(0);
  } catch (error) {
    console.warn(`${error.message}; downloading a clean copy.`);
  }
}

const temporaryPath = `${archivePath}.download-${process.pid}`;
try {
  console.log("Downloading PortableGit 2.55.0.3 for the bundled Bash fallback...");
  const response = await fetch(downloadUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`PortableGit download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath));
  const actualChecksum = checksum(temporaryPath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`PortableGit checksum mismatch: expected ${expectedChecksum}, received ${actualChecksum}`);
  }
  copyFileSync(temporaryPath, archivePath);
  writeFileSync(checksumPath, `${expectedChecksum}\n`);
  verifyPortableGitRuntime({ archivePath, checksumPath, expectedChecksum });
  console.log(`PortableGit runtime is ready: ${archivePath}`);
} finally {
  try {
    // Virus scanners can briefly retain the downloaded executable on Windows.
    // The next build uses a unique temporary path, so cleanup is best-effort.
    rmSync(temporaryPath, { force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}

function checksum(filePath) {
  // createHash accepts buffers; loading this 56 MB archive once keeps the
  // script dependency-free and the resulting checksum deterministic.
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}
