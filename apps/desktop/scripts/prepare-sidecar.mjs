#!/usr/bin/env node

/**
 * Sidecar 准备脚本
 *
 * 将 apps/server 构建产物打包为 Tauri sidecar 二进制。
 * 使用 @yao-pkg/pkg 将 Node.js 应用打包为独立可执行文件，
 * 然后复制到 src-tauri/binaries/ 目录。
 *
 * 用法:
 *   pnpm run prepare-sidecar
 *
 * 前提:
 *   1. 先运行 `cd apps/server && pnpm build` 构建 server
 *   2. 脚本会通过 npx 使用 @yao-pkg/pkg
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');
const serverDir = resolve(root, 'apps/server');
const binariesDir = resolve(__dirname, '../src-tauri/binaries');

const platform = process.platform;
const arch = process.arch;

const targetMap = {
  'darwin-x64': 'node22-macos-x64',
  'darwin-arm64': 'node22-macos-arm64',
  'linux-x64': 'node22-linux-x64',
  'linux-arm64': 'node22-linux-arm64',
  'win32-x64': 'node22-win-x64',
  'win32-arm64': 'node22-win-arm64',
};

const triple = `${platform}-${arch}`;
const pkgTarget = targetMap[triple];

if (!pkgTarget) {
  console.error(`Unsupported platform: ${triple}`);
  process.exit(1);
}

// Tauri sidecar naming convention: <name>-<target-triple>
const tauriTargetMap = {
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
};
const tauriTarget = tauriTargetMap[triple];
const ext = platform === 'win32' ? '.exe' : '';
const sidecarName = `pi-server-${tauriTarget}${ext}`;

console.log(`\n📦 Preparing sidecar for ${triple}`);
console.log(`   pkg target: ${pkgTarget}`);
console.log(`   sidecar name: ${sidecarName}`);

// Ensure server is built
console.log('\n🔨 Building server...');
execSync('pnpm build', { cwd: serverDir, stdio: 'inherit' });

// Ensure binaries directory exists
mkdirSync(binariesDir, { recursive: true });

// Package with @yao-pkg/pkg
console.log('\n📦 Packaging server with @yao-pkg/pkg...');
const pkgOutput = resolve(binariesDir, sidecarName);

try {
  execSync(
    `npx @yao-pkg/pkg@6.22.0 . --target ${pkgTarget} --output "${pkgOutput}" --compress GZip --fallback-to-source --no-signature`,
    { cwd: serverDir, stdio: 'inherit' }
  );
} catch {
  console.error('\n⚠️  @yao-pkg/pkg failed. Check the build output above.');
  console.error('   Or run: npx @yao-pkg/pkg@6.22.0');
  process.exit(1);
}

// Make executable on Unix
if (platform !== 'win32') {
  chmodSync(pkgOutput, 0o755);
}

console.log(`\n✅ Sidecar ready: ${pkgOutput}`);
console.log(`   You can now run: pnpm run build (tauri build)`);
