import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    fs.rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
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

  it("DELETE soft-deletes the project (still 404 on GET)", async () => {
    const { id } = await createProject();
    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(204);
    const got = await app.inject({ method: "GET", url: `/api/projects/${id}` });
    expect(got.statusCode).toBe(404);
  });

  it("DELETE kills agent processes for the project's sessions and clears sessionStates", async () => {
    const { id } = await createProject();
    // Create a session via the sessions route
    const s1 = await app.inject({ method: "POST", url: `/api/projects/${id}/sessions` });
    const s2 = await app.inject({ method: "POST", url: `/api/projects/${id}/sessions` });
    const sessionId1 = s1.json().id;
    const sessionId2 = s2.json().id;

    // Inject two fake in-memory agent processes belonging to this project
    const store = (app as any).sessionStates;
    const kill1 = vi.fn();
    const kill2 = vi.fn();
    store.set(sessionId1, { projectId: id, kill: kill1 } as any, {} as any);
    store.set(sessionId2, { projectId: id, kill: kill2 } as any, {} as any);
    // A session belonging to a different project should NOT be touched
    const otherKill = vi.fn();
    store.set("other-session", { projectId: "other", kill: otherKill } as any, {} as any);

    const res = await app.inject({ method: "DELETE", url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(204);
    expect(kill1).toHaveBeenCalledTimes(1);
    expect(kill2).toHaveBeenCalledTimes(1);
    expect(otherKill).not.toHaveBeenCalled();
    expect(store.get(sessionId1)).toBeUndefined();
    expect(store.get(sessionId2)).toBeUndefined();
    expect(store.get("other-session")).toBeDefined();
  });

  it("DELETE returns 404 for unknown id", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/projects/nope" });
    expect(res.statusCode).toBe(404);
  });
});
