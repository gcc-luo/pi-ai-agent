import { defineStore } from "pinia";
import { ref } from "vue";
import type { ServerEvent } from "@pi-web-ui/shared";
import { isTauri } from "../utils/platform.js";
import type { DesktopWindowState } from "../utils/task-notifications.js";

type TaskSettledEvent = Extract<ServerEvent, { type: "agent_task_settled" }>;

export interface NotificationNavigationTarget {
  notificationId: string;
  projectId: string;
  sessionId: string;
  messageId?: string;
}

let notificationListenerRegistered = false;
let navigationHandler: ((target: NotificationNavigationTarget) => void | Promise<void>) | null = null;

function navigationTarget(extra: Record<string, unknown> | undefined): NotificationNavigationTarget | null {
  if (!extra) return null;
  const notificationId = extra.notificationId;
  const projectId = extra.projectId;
  const sessionId = extra.sessionId;
  const messageId = extra.messageId;
  if (typeof notificationId !== "string" || typeof projectId !== "string" || typeof sessionId !== "string") {
    return null;
  }
  return {
    notificationId,
    projectId,
    sessionId,
    ...(typeof messageId === "string" && messageId ? { messageId } : {}),
  };
}

async function overlayIconBytes(count: number): Promise<Uint8Array | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, 32, 32);
  context.fillStyle = "#ef4444";
  context.beginPath();
  context.arc(16, 16, 15, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `bold ${count > 99 ? 10 : count > 9 ? 14 : 18}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(count > 99 ? "99+" : String(count), 16, 17);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export const useDesktopStore = defineStore("desktop", () => {
  const running = ref(isTauri());

  async function getWindowState(): Promise<DesktopWindowState> {
    if (!isTauri()) {
      return {
        focused: typeof document.hasFocus === "function" ? document.hasFocus() : true,
        visible: document.visibilityState !== "hidden",
        minimized: false,
      };
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      const [focused, visible, minimized] = await Promise.all([
        window.isFocused(), window.isVisible(), window.isMinimized(),
      ]);
      return { focused, visible, minimized };
    } catch {
      return { focused: false, visible: true, minimized: false };
    }
  }

  async function focusWindow() {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      if (await window.isMinimized()) await window.unminimize();
      if (!(await window.isVisible())) await window.show();
      await window.setFocus();
    } catch {
      // Navigation still proceeds when a platform cannot restore the window.
    }
  }

  async function initNotificationNavigation(
    handler: (target: NotificationNavigationTarget) => void | Promise<void>,
  ) {
    navigationHandler = handler;
    if (!isTauri() || notificationListenerRegistered) return;
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen<Record<string, unknown> | undefined>("notification-clicked", async (event) => {
        const target = navigationTarget(event.payload ?? undefined);
        if (!target) return;
        await focusWindow();
        await navigationHandler?.(target);
      });
      notificationListenerRegistered = true;
    } catch {
      // Sidebar unread badges remain available when action callbacks are unsupported.
    }
  }

  async function showTaskNotification(event: TaskSettledEvent) {
    if (!isTauri()) return;
    try {
      const { isPermissionGranted, requestPermission } = await import(
        "@tauri-apps/plugin-notification"
      );
      const { invoke } = await import("@tauri-apps/api/core");
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (!granted) return;
      const target: NotificationNavigationTarget = {
        notificationId: event.notificationId,
        projectId: event.projectId,
        sessionId: event.sessionId,
        ...(event.messageId ? { messageId: event.messageId } : {}),
      };
      // 通过自定义命令调用 notify_rust 原生通知：Windows 下 toast 归属 PI 应用，
      // 且点击回调由 Rust 侧 wait_for_action 处理并广播 notification-clicked 事件。
      void invoke("show_native_notification", {
        title: event.title,
        body: event.summary,
        target,
      });
    } catch {
      // Persistent unread state is the fallback when OS notifications fail.
    }
  }

  async function setUnreadBadge(count: number) {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      if (/Macintosh|Mac OS X/i.test(navigator.userAgent)) {
        await window.setBadgeCount(count > 0 ? count : undefined);
        return;
      }
      if (/Windows/i.test(navigator.userAgent)) {
        if (count <= 0) {
          await window.setOverlayIcon();
          return;
        }
        const icon = await overlayIconBytes(count);
        if (icon) await window.setOverlayIcon(icon);
      }
    } catch {
      // Not every desktop platform supports an application badge.
    }
  }

  async function openInBrowser(url: string) {
    if (!isTauri()) {
      window.open(url, "_blank");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  }

  return {
    running,
    getWindowState,
    initNotificationNavigation,
    showTaskNotification,
    setUnreadBadge,
    openInBrowser,
  };
});
