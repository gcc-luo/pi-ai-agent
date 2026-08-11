import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyReleaseVersion } from "./verify-release-version.mjs";

test("accepts a release tag matching every desktop version", () => {
  assert.equal(
    verifyReleaseVersion({
      tag: "v1.3.7",
      packageVersion: "1.3.7",
      tauriVersion: "1.3.7",
      cargoVersion: "1.3.7",
    }),
    "1.3.7",
  );
});

test("rejects a release tag that does not match the packaged version", () => {
  assert.throws(
    () =>
      verifyReleaseVersion({
        tag: "v1.3.7",
        packageVersion: "1.3.6",
        tauriVersion: "1.3.6",
        cargoVersion: "1.3.6",
      }),
    /Release version mismatch/,
  );
});

test("rejects inconsistent desktop manifests", () => {
  assert.throws(
    () =>
      verifyReleaseVersion({
        tag: "v1.3.7",
        packageVersion: "1.3.7",
        tauriVersion: "1.3.7",
        cargoVersion: "1.3.6",
      }),
    /Release version mismatch/,
  );
});
