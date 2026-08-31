import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import { MessageRepository } from "../../src/db/repositories/message.js";
import { NotificationRepository } from "../../src/db/repositories/notification.js";
import { ProcessManager } from "../../src/agent/process-manager.js";
import { SessionStateStore } from "../../src/agent/session-state.js";
import { sessionsRoutes } from "../../src/routes/sessions.js";

describe("sessions routes", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: ReturnType<typeof openDatabase>;
  let projectId: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-sess-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    const config = loadConfig();
    db = openDatabase(config.dbPath);
    const projects = new ProjectRepository(db);
    const workdir = fs.mkdtempSync(path.join(tmp, "workdir-"));
    const p = projects.create({ name: "p", workdir });
    projectId = p.id;
    const sessions = new SessionRepository(db);
    const messages = new MessageRepository(db);
    const notifications = new NotificationRepository(db);
    app = await buildApp(config, {
      db, projects, sessions, messages, notifications,
      processManager: new ProcessManager({ command: "pi", args: [], logger: { info() {}, warn() {}, error() {} } as any }),
      sessionStates: new SessionStateStore(),
      config,
    });
    await app.register(sessionsRoutes, { prefix: "/api" });
  });
  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

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

  it("marks a session read and reports the cross-project unread total", async () => {
    const created = await app.inject({ method: "POST", url: `/api/projects/${projectId}/sessions`, payload: {} });
    const sessionId = created.json().id;
    app.notifications.recordSettlement({
      taskId: "task-1", projectId, sessionId, messageId: "message-1",
      type: "task_completed", title: "任务", body: "完成",
    });

    const before = await app.inject({ method: "GET", url: "/api/notifications/unread-count" });
    expect(before.json()).toEqual({ count: 1 });

    const read = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/read`,
      payload: { messageId: "message-1" },
    });
    expect(read.json()).toMatchObject({ unreadCount: 0, lastReadMessageId: "message-1" });

    const after = await app.inject({ method: "GET", url: "/api/notifications/unread-count" });
    expect(after.json()).toEqual({ count: 0 });
  });
});
