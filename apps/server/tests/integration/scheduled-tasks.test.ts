import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { openDatabase } from "../../src/db/sqlite.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { ScheduledTaskRepository } from "../../src/db/repositories/scheduled-task.js";
import { scheduledTasksRoutes } from "../../src/routes/scheduled-tasks.js";

describe("scheduled task capability routes", () => {
  let tmp: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let db: ReturnType<typeof openDatabase>;
  let projectId: string;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-scheduled-routes-"));
    process.env.PI_WEB_UI_ROOT = tmp;
    fs.mkdirSync(path.join(tmp, "logs"), { recursive: true });
    const config = loadConfig();
    db = openDatabase(config.dbPath);
    const projects = new ProjectRepository(db);
    projectId = projects.create({
      name: "scheduled-project",
      workdir: fs.mkdtempSync(path.join(tmp, "workdir-")),
    }).id;
    app = await buildApp(config, {
      db,
      projects,
      scheduledTasks: new ScheduledTaskRepository(db),
      taskScheduler: { upsertTask() {}, removeTask() {}, executeNow: async () => {} },
    });
    await app.register(scheduledTasksRoutes, { prefix: "/api/scheduled-tasks" });
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("persists prompt task capabilities and clears them for reminders", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/scheduled-tasks",
      payload: {
        name: "daily check",
        cronExpression: "0 9 * * *",
        taskType: "prompt",
        payload: JSON.stringify({ prompt: "检查项目" }),
        projectId,
        capabilities: {
          skillNames: ["code-review", "code-review"],
          pluginIds: ["browser-use"],
          connectorIds: ["docs"],
          expertId: "expert-1",
        },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().capabilities).toEqual({
      skillNames: ["code-review"],
      pluginIds: ["browser-use"],
      connectorIds: ["docs"],
      expertId: "expert-1",
    });

    const reminder = await app.inject({
      method: "POST",
      url: "/api/scheduled-tasks",
      payload: {
        name: "reminder",
        cronExpression: "0 10 * * *",
        taskType: "reminder",
        payload: JSON.stringify({ message: "提醒" }),
        capabilities: { pluginIds: ["browser-use"] },
      },
    });
    expect(reminder.statusCode).toBe(201);
    expect(reminder.json().capabilities).toEqual({
      skillNames: [], pluginIds: [], connectorIds: [], expertId: null,
    });
  });

  it("rejects malformed capability snapshots", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/scheduled-tasks",
      payload: {
        name: "invalid",
        cronExpression: "0 9 * * *",
        taskType: "prompt",
        payload: JSON.stringify({ prompt: "检查项目" }),
        projectId,
        capabilities: { pluginIds: "browser-use" },
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
