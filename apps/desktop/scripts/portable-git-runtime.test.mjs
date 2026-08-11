import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { verifyPortableGitRuntime } from "./portable-git-runtime.mjs";

test("rejects an empty PortableGit archive", () => {
  const fixture = createFixture(Buffer.alloc(0));
  try {
    assert.throws(
      () => verifyPortableGitRuntime(fixture),
      /PortableGit archive is empty/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("rejects a PortableGit archive whose checksum does not match", () => {
  const fixture = createFixture(Buffer.from("not-portable-git"), "0".repeat(64));
  try {
    assert.throws(
      () => verifyPortableGitRuntime(fixture),
      /PortableGit checksum mismatch/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("accepts a non-empty PortableGit archive with the expected checksum", () => {
  const archive = Buffer.from("verified-portable-git");
  const expectedChecksum = createHash("sha256").update(archive).digest("hex");
  const fixture = createFixture(archive, expectedChecksum);
  try {
    assert.equal(verifyPortableGitRuntime(fixture), expectedChecksum);
  } finally {
    fixture.cleanup();
  }
});

function createFixture(archive, expectedChecksum = createHash("sha256").update(archive).digest("hex")) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-portable-git-test-"));
  const archivePath = path.join(directory, "portable-git.exe");
  const checksumPath = path.join(directory, "portable-git.sha256");
  writeFileSync(archivePath, archive);
  writeFileSync(checksumPath, `${expectedChecksum}\n`);
  return {
    archivePath,
    checksumPath,
    expectedChecksum,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
