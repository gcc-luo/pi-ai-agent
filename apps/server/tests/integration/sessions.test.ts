import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";
import { WorkdirManager } from "../../src/workdir/manager.js";
import { ProcessManager } from "../../src/agent/process-manager.js";
import { SessionStateStore } from "../../src/agent/session-state.js";
import { sessionsRoutes } from "../../src/routes/sessions.js";

describe("sessions routes", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let projectId: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-sess-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    const db = openDatabase(config.dbPath);
    const workdirs = new WorkdirManager({ root: config.workdirRoot });
    const projects = new ProjectRepository(db);
    const p = projects.create({ name: "p", workdir: config.workdirRoot + "/x" });
    workdirs.create(p.id);
    db.prepare("UPDATE projects SET workdir = ? WHERE id = ?").run(workdirs.path(p.id), p.id);
    projectId = p.id;
    const sessions = new SessionRepository(db);
    const messages = new MessageRepository(db);
    app = await buildApp(config, {
      db, projects, sessions, messages, workdirs,
      processManager: new ProcessManager({ command: "pi", args: [] }),
      sessionStates: new SessionStateStore(),
    });
    await app.register(sessionsRoutes, { prefix: "/api" });
  });
  afterEach(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it("creates a session", async () => {
    const res = await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    expect(res.statusCode).toBe(201);
    expect(res.json().projectId).toBe(projectId);
  });

  it("lists sessions by project", async () => {
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/sessions` });
    expect(res.json().length).toBe(2);
  });

  it("fetches messages for a session", async () => {
    const c = await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    const sid = c.json().id;
    app.messages.append({ sessionId: sid, role: "user", content: "hi" });
    const res = await app.inject({ method: "GET", url: `/api/sessions/${sid}/messages` });
    expect(res.json()[0].content).toBe("hi");
  });
});
