import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildReleaseNotesDraft,
  hasPlaceholderNotes,
  normalizeReleaseVersion,
  updateReleaseVersionFiles,
} from "./prepare-release-version.mjs";

test("normalizes release versions with or without a v prefix", () => {
  assert.equal(normalizeReleaseVersion("1.3.11"), "1.3.11");
  assert.equal(normalizeReleaseVersion("v1.3.11"), "1.3.11");
});

test("updates npm, Tauri, and Cargo version files together", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-release-version-"));
  const paths = {
    packageJsonPath: path.join(tempDir, "package.json"),
    tauriConfigPath: path.join(tempDir, "tauri.conf.json"),
    cargoManifestPath: path.join(tempDir, "Cargo.toml"),
  };

  await writeFile(paths.packageJsonPath, '{\n  "version": "1.3.10"\n}\n');
  await writeFile(paths.tauriConfigPath, '{\n  "version": "1.3.10"\n}\n');
  await writeFile(paths.cargoManifestPath, '[package]\nversion = "1.3.10"\n');

  await updateReleaseVersionFiles(paths, "v1.3.11");

  assert.match(await readFile(paths.packageJsonPath, "utf8"), /"version": "1\.3\.11"/);
  assert.match(await readFile(paths.tauriConfigPath, "utf8"), /"version": "1\.3\.11"/);
  assert.match(await readFile(paths.cargoManifestPath, "utf8"), /^version = "1\.3\.11"/m);
});

test("rejects non-semver release versions", () => {
  assert.throws(() => normalizeReleaseVersion("1.3"), /Invalid release version/);
});

test("buildReleaseNotesDraft embeds commits as a placeholder draft", () => {
  const draft = buildReleaseNotesDraft([
    "a1b2c3d feat: 新增技能商店",
    "e4f5g6h fix: 修复会话切换重复消息",
  ]);
  assert.match(draft, /## 更新内容/);
  assert.match(draft, /原始提交（2 条，待整理）/);
  assert.match(draft, /- a1b2c3d feat: 新增技能商店/);
  assert.ok(hasPlaceholderNotes(draft));
});

test("hasPlaceholderNotes rejects raw drafts and accepts curated lists", () => {
  const draft = buildReleaseNotesDraft(["a1b2c3d feat: 新增技能商店"]);
  assert.equal(hasPlaceholderNotes(draft), true);
  assert.equal(hasPlaceholderNotes("## 更新内容\n\n1. 新增技能商店。\n2. 修复消息重复。\n"), false);
  assert.equal(hasPlaceholderNotes("## 更新内容\n\n- 没有编号列表\n"), true);
});