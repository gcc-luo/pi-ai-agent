import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopDevEnvironment } from "./dev.mjs";

test("points the desktop development window at the source server", () => {
  assert.equal(desktopDevEnvironment({}).PI_DESKTOP_SERVER_PORT, "8080");
  assert.equal(
    desktopDevEnvironment({ PI_DESKTOP_SERVER_PORT: "43123" }).PI_DESKTOP_SERVER_PORT,
    "43123",
  );
});
