import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const windowApi = {
  isMinimized: vi.fn(async () => true),
  unminimize: vi.fn(async () => undefined),
  isVisible: vi.fn(async () => false),
  show: vi.fn(async () => undefined),
  setFocus: vi.fn(async () => undefined),
};

vi.mock("../utils/platform.js", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
  onAction: vi.fn(async () => ({ unregister: vi.fn() })),
}));

class MockNotification {
  static instances: MockNotification[] = [];
  onclick: (() => void | Promise<void>) | null = null;
  close = vi.fn();

  constructor(public title: string, public options?: NotificationOptions) {
    MockNotification.instances.push(this);
  }
}

describe("desktop task notifications", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    MockNotification.instances = [];
    vi.stubGlobal("Notification", MockNotification);
    vi.clearAllMocks();
  });

  it("restores the window and routes a clicked notification to its message", async () => {
    const { useDesktopStore } = await import("./desktop.js");
    const desktop = useDesktopStore();
    const navigate = vi.fn(async () => undefined);
    await desktop.initNotificationNavigation(navigate);
    await desktop.showTaskNotification({
      type: "agent_task_settled",
      notificationId: "notification-1",
      taskId: "task-1",
      projectId: "project-1",
      sessionId: "session-1",
      messageId: "message-1",
      title: "处理任务",
      summary: "已经完成",
      status: "completed",
      completedAt: 1,
      unreadCount: 1,
    });

    expect(MockNotification.instances).toHaveLength(1);
    await MockNotification.instances[0]!.onclick?.();

    expect(windowApi.unminimize).toHaveBeenCalled();
    expect(windowApi.show).toHaveBeenCalled();
    expect(windowApi.setFocus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({
      notificationId: "notification-1",
      projectId: "project-1",
      sessionId: "session-1",
      messageId: "message-1",
    });
  });
});
