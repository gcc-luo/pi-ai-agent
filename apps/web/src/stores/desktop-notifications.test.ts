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

const invokeApi = {
  invoke: vi.fn(async () => undefined),
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeApi.invoke,
}));

type ClickListener = (event: { payload?: Record<string, unknown> }) => void | Promise<void>;

const eventApi = {
  listen: vi.fn<[string, ClickListener], Promise<() => void>>(async () => () => undefined),
};

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventApi.listen,
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
}));

describe("desktop task notifications", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
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

    expect(invokeApi.invoke).toHaveBeenCalledWith("show_native_notification", {
      title: "处理任务",
      body: "已经完成",
      target: {
        notificationId: "notification-1",
        projectId: "project-1",
        sessionId: "session-1",
        messageId: "message-1",
      },
    });

    expect(eventApi.listen).toHaveBeenCalledWith("notification-clicked", expect.any(Function));
    const onClick = eventApi.listen.mock.calls[0]?.[1];
    await onClick?.({
      payload: {
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

  it("ignores click events without a valid navigation target", async () => {
    const { useDesktopStore } = await import("./desktop.js");
    const desktop = useDesktopStore();
    const navigate = vi.fn(async () => undefined);
    await desktop.initNotificationNavigation(navigate);

    const onClick = eventApi.listen.mock.calls[0]?.[1];
    await onClick?.({ payload: undefined });
    await onClick?.({ payload: { projectId: "project-1" } });

    expect(windowApi.unminimize).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
