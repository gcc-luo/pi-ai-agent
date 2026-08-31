import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const windowApi = {
  isMinimized: vi.fn(async () => true),
  unminimize: vi.fn(async () => undefined),
  isVisible: vi.fn(async () => false),
  show: vi.fn(async () => undefined),
  setFocus: vi.fn(async () => undefined),
};

type NotificationAction = (notification: {
  extra?: Record<string, unknown>;
}) => void | Promise<void>;

vi.mock("../utils/platform.js", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

const notificationApi = {
  onAction: vi.fn<[NotificationAction], Promise<{ unregister: () => void }>>(
    async () => ({ unregister: () => undefined }),
  ),
  sendNotification: vi.fn(),
};

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: notificationApi.sendNotification,
  onAction: notificationApi.onAction,
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

  it("sends a native PI notification and routes a click to its message", async () => {
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

    expect(MockNotification.instances).toHaveLength(0);
    expect(notificationApi.sendNotification).toHaveBeenCalledWith({
      title: "处理任务",
      body: "已经完成",
      autoCancel: true,
      extra: {
        notificationId: "notification-1",
        projectId: "project-1",
        sessionId: "session-1",
        messageId: "message-1",
      },
    });

    const onAction = notificationApi.onAction.mock.calls[0]?.[0];
    expect(onAction).toBeDefined();
    await onAction?.({
      extra: {
        notificationId: "notification-1",
        projectId: "project-1",
        sessionId: "session-1",
        messageId: "message-1",
      },
    });

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
