import { defineStore } from "pinia";
import type { ServerEvent } from "@pi-web-ui/shared";
import { api } from "../api/client.js";
import { wsClient } from "../api/ws.js";
import { isViewingSettledSession } from "../utils/task-notifications.js";
import { useDesktopStore, type NotificationNavigationTarget } from "./desktop.js";
import { useSessionStore } from "./session.js";

type TaskSettledEvent = Extract<ServerEvent, { type: "agent_task_settled" }>;

export const useNotificationStore = defineStore("notifications", {
  state: () => ({
    initialized: false,
    totalUnreadCount: 0,
    activeNav: "chat",
    activeProjectId: null as string | null,
    activeSessionId: null as string | null,
    latestUnreadMessageIds: {} as Record<string, string | undefined>,
  }),
  actions: {
    setViewContext(activeNav: string, projectId: string | null, sessionId: string | null) {
      this.activeNav = activeNav;
      this.activeProjectId = projectId;
      this.activeSessionId = sessionId;
    },

    async init(
      navigate: (target: NotificationNavigationTarget) => void | Promise<void>,
    ) {
      const desktop = useDesktopStore();
      await desktop.initNotificationNavigation(navigate);
      if (!this.initialized) {
        this.initialized = true;
        wsClient.onEvent((event) => {
          if (event.type === "agent_task_settled") void this.handleSettled(event);
        });
      }
      await this.refreshTotalUnread();
    },

    async refreshTotalUnread() {
      try {
        const result = await api.getUnreadCount();
        this.totalUnreadCount = result.count;
        await useDesktopStore().setUnreadBadge(result.count);
      } catch {
        // Keep the last known count until the local sidecar is reachable again.
      }
    },

    async markSessionRead(sessionId: string, messageId?: string) {
      try {
        await useSessionStore().markRead(
          sessionId,
          messageId ?? this.latestUnreadMessageIds[sessionId],
        );
        delete this.latestUnreadMessageIds[sessionId];
        await this.refreshTotalUnread();
      } catch {
        // A later focus/open event retries the idempotent read operation.
      }
    },

    async markCurrentSessionReadIfViewed(messageId?: string) {
      if (!this.activeProjectId || !this.activeSessionId) return;
      const windowState = await useDesktopStore().getWindowState();
      if (!isViewingSettledSession({
        activeNav: this.activeNav,
        projectId: this.activeProjectId,
        sessionId: this.activeSessionId,
      }, windowState, {
        projectId: this.activeProjectId,
        sessionId: this.activeSessionId,
      })) return;
      const session = useSessionStore().sessions.find(
        (candidate) => candidate.id === this.activeSessionId,
      );
      if ((session?.unreadCount ?? 0) > 0) {
        await this.markSessionRead(this.activeSessionId, messageId);
      }
    },

    async handleSettled(event: TaskSettledEvent) {
      const sessions = useSessionStore();
      sessions.applyUnreadCount(event.sessionId, event.unreadCount);
      if (event.messageId) this.latestUnreadMessageIds[event.sessionId] = event.messageId;
      const desktop = useDesktopStore();
      const windowState = await desktop.getWindowState();
      const viewing = isViewingSettledSession({
        activeNav: this.activeNav,
        projectId: this.activeProjectId,
        sessionId: this.activeSessionId,
      }, windowState, event);

      if (viewing) {
        await this.markSessionRead(event.sessionId, event.messageId);
        return;
      }

      await this.refreshTotalUnread();
      await desktop.showTaskNotification(event);
    },
  },
});
