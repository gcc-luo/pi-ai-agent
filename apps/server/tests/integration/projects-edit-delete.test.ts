import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";
import { ModelRepository } from "../../src/db/repositories/model.js";
import { SessionStateStore } from "../../src/agent/session-state.js";
import { projectsRoutes } from "../../src/routes/projects.js";
import { sessionsRoutes } from "../../src/routes/sessions.js";

describe("projects edit/delete routes", () => {
  let tmp: string;
  let workdir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-edit-del-"));
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wd-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    app = await buildApp(config, {
      db,
      projects: new ProjectRepository(db),
      sessions: new SessionRepository(db),
      messages: new MessageRepository(db),
      models: new ModelRepository(db),
      sessionStates: new SessionStateStore(),
    });
    await app.register(projectsRoutes, { prefix: "/api/projects" });
    await app.register(sessionsRoutes, { prefix: "/api" });
  });
  afterEach(async () => {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  async function createProject(name = "demo"): Promise<{ id: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name, workdir },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it("renames a project via PUT", async () => {
    const { id } = await createProject("old");
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      payload: { name: "new-name" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("new-name");
    const got = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(got.json().name).toBe("new-name");
  });

  it("PUT rejects empty name with 400", async () => {
    const { id } = await createProject();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${id}`,
      payload: { name: "  " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/does-not-exist",
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});
