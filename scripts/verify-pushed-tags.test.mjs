import assert from "node:assert/strict";
import { test } from "node:test";

import { getPushedReleaseTags } from "./verify-pushed-tags.mjs";

test("returns newly pushed release tags and ignores branches and deletions", () => {
  const input = [
    "refs/heads/release/v1.0 abc refs/heads/release/v1.0 def",
    "refs/tags/v1.3.11 abc refs/tags/v1.3.11 0000000000000000000000000000000000000000",
    "refs/tags/v1.3.10 abc refs/tags/v1.3.10 0000000000000000000000000000000000000000",
    "refs/tags/v1.3.9 0000000000000000000000000000000000000000 refs/tags/v1.3.9 abc",
  ].join("\n");

  assert.deepEqual(getPushedReleaseTags(input), ["v1.3.11", "v1.3.10"]);
});
