import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { projectsRoutes } from "../../src/routes/projects.js";

describe("projects routes", () => {
  let tmp: string;
  let workdir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-routes-"));
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-project-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    app = await buildApp(config, {
      db,
      projects: new ProjectRepository(db),
      sessions: new SessionRepository(db),
    });
    await app.register(projectsRoutes, { prefix: "/api/projects" });
  });
  afterEach(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  it("creates a project", async () => {
    const res = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "demo", workdir } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("demo");
    expect(body.workdir).toBeTruthy();
    expect(require("node:fs").existsSync(body.workdir)).toBe(true);
  });

  it("lists projects", async () => {
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "a", workdir } });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.json().length).toBe(1);
  });

  it("gets one project", async () => {
    const c = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "a", workdir } });
    const id = c.json().id;
    const res = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(res.json().id).toBe(id);
  });

  it("deletes a project", async () => {
    const c = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "a", workdir } });
    const id = c.json().id;
    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/projects/${id}` })).statusCode).toBe(404);
  });
});
