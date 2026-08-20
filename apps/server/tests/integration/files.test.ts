import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { filesRoutes } from "../../src/routes/files.js";

describe("files routes", () => {
  let tmp: string;
  let workdir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-files-routes-"));
    workdir = path.join(tmp, "project");
    fs.mkdirSync(path.join(workdir, "src"), { recursive: true });
    fs.writeFileSync(path.join(workdir, "README.md"), "hello");
    fs.writeFileSync(path.join(workdir, "src", "index.ts"), "export {};");

    const config = { ...loadConfig(), dbPath: path.join(tmp, "db.sqlite"), logFile: path.join(tmp, "server.log") };
    const db = openDatabase(config.dbPath);
    const projects = new ProjectRepository(db);
    projects.create({ id: "project-1", name: "test", workdir });
    app = await buildApp(config, { db, projects });
    await app.register(filesRoutes, { prefix: "/api" });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  it("lists the project root when the path marker is '/'", async () => {
    const res = await app.inject({ method: "GET", url: "/api/files/project-1/list?path=/" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "README.md", path: "README.md", type: "file" }),
      expect.objectContaining({ name: "src", path: "src", type: "directory" }),
    ]));
  });

  it("still rejects paths outside the project root", async () => {
    const res = await app.inject({ method: "GET", url: "/api/files/project-1/list?path=../" });

    expect(res.statusCode).toBe(400);
  });
});
