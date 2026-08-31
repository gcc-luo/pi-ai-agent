import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../src/db/migrations.js";
import { NotificationRepository } from "../../src/db/repositories/notification.js";
import { ProjectRepository } from "../../src/db/repositories/project.js";
import { SessionRepository } from "../../src/db/repositories/session.js";

describe("NotificationRepository", () => {
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

  it("persists a settled task and increments unread only once", () => {
    const project = projects.create({ name: "p", workdir: "/tmp/p" });
    const session = sessions.create({ projectId: project.id, title: "修复问题" });
    const input = {
      taskId: "task-1",
      projectId: project.id,
      sessionId: session.id,
      messageId: "message-1",
      type: "task_completed" as const,
      title: "修复问题",
      body: "已经修复",
      createdAt: 123,
    };

    const first = notifications.recordSettlement(input);
    const replay = notifications.recordSettlement(input);

    expect(first.created).toBe(true);
    expect(first.unreadCount).toBe(1);
    expect(replay.created).toBe(false);
    expect(replay.notification.id).toBe(first.notification.id);
    expect(replay.unreadCount).toBe(1);
    expect(sessions.findById(session.id)).toMatchObject({
      unreadCount: 1,
      lastReadMessageId: null,
    });
  });

  it("marks every notification in one session read without touching another", () => {
    const project = projects.create({ name: "p", workdir: "/tmp/p" });
    const first = sessions.create({ projectId: project.id });
    const second = sessions.create({ projectId: project.id });
    notifications.recordSettlement({
      taskId: "task-1", projectId: project.id, sessionId: first.id,
      messageId: "message-1", type: "task_completed", title: "one", body: "done",
    });
    notifications.recordSettlement({
      taskId: "task-2", projectId: project.id, sessionId: first.id,
      messageId: "message-2", type: "task_completed", title: "one", body: "done again",
    });
    notifications.recordSettlement({
      taskId: "task-3", projectId: project.id, sessionId: second.id,
      type: "task_failed", title: "two", body: "failed",
    });

    notifications.markSessionRead(first.id, "message-2");

    expect(sessions.findById(first.id)).toMatchObject({
      unreadCount: 0,
      lastReadMessageId: "message-2",
    });
    expect(sessions.findById(second.id)?.unreadCount).toBe(1);
    expect(notifications.totalUnreadCount()).toBe(1);
  });

  it("counts unread sessions across projects and excludes deleted sessions", () => {
    const p1 = projects.create({ name: "p1", workdir: "/tmp/p1" });
    const p2 = projects.create({ name: "p2", workdir: "/tmp/p2" });
    const s1 = sessions.create({ projectId: p1.id });
    const s2 = sessions.create({ projectId: p2.id });
    notifications.recordSettlement({ taskId: "t1", projectId: p1.id, sessionId: s1.id, type: "task_completed", title: "1", body: "1" });
    notifications.recordSettlement({ taskId: "t2", projectId: p2.id, sessionId: s2.id, type: "task_completed", title: "2", body: "2" });
    sessions.delete(s2.id);

    expect(notifications.totalUnreadCount()).toBe(1);
  });
});
