import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkdirManager } from "../../src/workdir/manager.js";

describe("WorkdirManager", () => {
  let root: string;
  let mgr: WorkdirManager;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-test-"));
    mgr = new WorkdirManager({ root });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("creates a project workdir with .pi-web/ inside", () => {
    const wd = mgr.create("p1");
    expect(fs.existsSync(wd)).toBe(true);
    expect(fs.existsSync(path.join(wd, ".pi-web"))).toBe(true);
    expect(fs.existsSync(path.join(wd, ".pi-web", "config.json"))).toBe(true);
  });

  it("rejects duplicate project ids", () => {
    mgr.create("p1");
    expect(() => mgr.create("p1")).toThrow();
  });

  it("deletes a workdir", () => {
    const wd = mgr.create("p2");
    mgr.delete("p2");
    expect(fs.existsSync(wd)).toBe(false);
  });

  it("checks existence", () => {
    const wd = mgr.create("p3");
    expect(mgr.exists("p3")).toBe(true);
    fs.rmSync(wd, { recursive: true, force: true });
    expect(mgr.exists("p3")).toBe(false);
  });
});
