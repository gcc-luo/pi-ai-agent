import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
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
