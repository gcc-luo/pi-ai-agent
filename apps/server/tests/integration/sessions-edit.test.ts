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

describe("sessions edit route", () => {
  let tmp: string;
  let workdir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-sess-edit-"));
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

  async function setupProjectAndSession(title: string | null = null): Promise<{ projectId: string; sessionId: string }> {
    const pres = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "demo", workdir },
    });
    const projectId = pres.json().id;
    const sres = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/sessions`,
      payload: title !== null ? { title } : {},
    });
    return { projectId, sessionId: sres.json().id };
  }

  it("renames a session via PUT", async () => {
    const { sessionId } = await setupProjectAndSession("old");
    const res = await app.inject({
      method: "PUT",
      url: `/api/sessions/${sessionId}`,
      payload: { title: "new-title" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("new-title");
    const got = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}` });
    expect(got.json().title).toBe("new-title");
  });

  it("PUT rejects empty title with 400", async () => {
    const { sessionId } = await setupProjectAndSession();
    const res = await app.inject({
      method: "PUT",
      url: `/api/sessions/${sessionId}`,
      payload: { title: "   " },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/sessions/does-not-exist",
      payload: { title: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});
