import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { browserArtifacts } from "../../src/browser/browser-artifacts.js";

it("publishes existing workspace files while excluding spills, credentials and escaping symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-artifacts-"));
  try {
    const workdir = path.join(root, "work");
    await fs.mkdir(workdir);
    await fs.writeFile(path.join(workdir, "page.png"), "fixture");
    await fs.writeFile(path.join(root, "outside.png"), "private");
    await fs.symlink(
      path.join(root, "outside.png"),
      path.join(workdir, "link.png"),
    );
    const artifacts = await browserArtifacts(
      {
        artifacts: [
          { path: "page.png" },
          { path: "page.png" },
          { path: "missing.png" },
          { path: "link.png" },
          { path: "../outside.png" },
          { path: "page.png", command: "state" },
          { path: "page.png", kind: "spill" },
        ],
      },
      workdir,
    );
    expect(artifacts).toEqual([
      {
        path: "page.png",
        name: "page.png",
        mimeType: "image/png",
        source: "agent_browser",
      },
    ]);
    expect(
      await browserArtifacts(
        { artifacts: [{ path: "page.png", command: "state" }] },
        workdir,
      ),
    ).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
