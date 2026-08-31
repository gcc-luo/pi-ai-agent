import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useDesktopStore } from "./desktop.js";
import { useNotificationStore } from "./notifications.js";
import { useSessionStore } from "./session.js";

const settled = {
  type: "agent_task_settled" as const,
  notificationId: "notification-1",
  taskId: "task-1",
  projectId: "project-1",
  sessionId: "session-1",
  messageId: "message-1",
  title: "处理任务",
  summary: "已经完成",
  status: "completed" as const,
  completedAt: 1,
  unreadCount: 1,
};

function session(unreadCount: number) {
  return {
    id: "session-1", projectId: "project-1", title: "处理任务",
    parentId: null, expertId: null, selectedPluginIds: [], browserEnabled: false,
    status: "active" as const, createdAt: 0, updatedAt: 0, lastActiveAt: null,
    unreadCount, lastReadMessageId: null, deletedAt: null,
  };
}

describe("notification store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("marks a foreground target session read without showing an OS notification", async () => {
    const sessionStore = useSessionStore();
    sessionStore.sessions = [session(0)];
    const desktop = useDesktopStore();
    vi.spyOn(desktop, "getWindowState").mockResolvedValue({ focused: true, visible: true, minimized: false });
    const show = vi.spyOn(desktop, "showTaskNotification").mockResolvedValue();
    vi.spyOn(desktop, "setUnreadBadge").mockResolvedValue();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api/, "");
      if (path === "/sessions/session-1/read" && init?.method === "POST") {
        return new Response(JSON.stringify(session(0)), { status: 200 });
      }
      if (path === "/notifications/unread-count") {
        return new Response(JSON.stringify({ count: 0 }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));

    const store = useNotificationStore();
    store.setViewContext("chat", "project-1", "session-1");
    await store.handleSettled(settled);

    expect(sessionStore.sessions[0]?.unreadCount).toBe(0);
    expect(store.totalUnreadCount).toBe(0);
    expect(show).not.toHaveBeenCalled();
  });

  it("keeps background work unread and shows an OS notification", async () => {
    const sessionStore = useSessionStore();
    sessionStore.sessions = [session(0)];
    const desktop = useDesktopStore();
    vi.spyOn(desktop, "getWindowState").mockResolvedValue({ focused: true, visible: true, minimized: false });
    const show = vi.spyOn(desktop, "showTaskNotification").mockResolvedValue();
    vi.spyOn(desktop, "setUnreadBadge").mockResolvedValue();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ count: 1 }), { status: 200 },
    )));

    const store = useNotificationStore();
    store.setViewContext("chat", "project-1", "session-2");
    await store.handleSettled(settled);

    expect(sessionStore.sessions[0]?.unreadCount).toBe(1);
    expect(store.totalUnreadCount).toBe(1);
    expect(show).toHaveBeenCalledWith(settled);
  });
});
