import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { NotificationRepository } from "../../src/db/repositories/notification.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";
import {
  recordAgentTaskSettlement,
  summarizeNotification,
} from "../../src/agent/task-notification.js";

describe("agent task notification", () => {
  let db: Database.Database;
  let projects: ProjectRepository;
  let sessions: SessionRepository;
  let notifications: NotificationRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    projects = new ProjectRepository(db);
    sessions = new SessionRepository(db);
    notifications = new NotificationRepository(db);
  });

  it("normalizes whitespace and truncates the notification summary", () => {
    const summary = summarizeNotification(`  完成\n\n  ${"结果".repeat(120)}  `, 20);
    expect(summary).toBe(`完成 ${"结果".repeat(8)}…`);
    expect(summary.length).toBe(20);
  });

  it("records a successful task using the final persisted assistant message", () => {
    const project = projects.create({ name: "p", workdir: "/tmp/p" });
    const session = sessions.create({ projectId: project.id, title: "处理任务" });

    const event = recordAgentTaskSettlement({
      notifications, sessions,
      taskId: "task-ok", projectId: project.id, sessionId: session.id,
      assistant: { id: "message-1", content: "代码已经完成" },
      completedAt: 100,
    });

    expect(event).toMatchObject({
      type: "agent_task_settled",
      taskId: "task-ok",
      status: "completed",
      messageId: "message-1",
      title: "处理任务",
      summary: "代码已经完成",
      unreadCount: 1,
      completedAt: 100,
    });
  });

  it("records a failed task and suppresses a replay", () => {
    const project = projects.create({ name: "p", workdir: "/tmp/p" });
    const session = sessions.create({ projectId: project.id });
    const input = {
      notifications, sessions,
      taskId: "task-failed", projectId: project.id, sessionId: session.id,
      error: "npm build failed", completedAt: 200,
    };

    const event = recordAgentTaskSettlement(input);
    const replay = recordAgentTaskSettlement(input);

    expect(event).toMatchObject({
      status: "failed",
      summary: "npm build failed",
      unreadCount: 1,
    });
    expect(event).not.toHaveProperty("messageId");
    expect(replay).toBeNull();
  });
});
